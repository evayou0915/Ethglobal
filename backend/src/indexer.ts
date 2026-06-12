/**
 * AuraSci on-chain event indexer.
 *
 * Watches the AuraSciEscrow contract for Deposited / Released / Refunded
 * events and mirrors them into Postgres. Resumes from `IndexerCheckpoint`
 * after restart so we never replay or skip a block.
 *
 *   npm run dev:indexer    # foreground, watch-mode
 *   npm run start:indexer  # built, production
 *   pm2 start dist/indexer.js --name aurasci-indexer
 */

import { prisma } from "./lib/db.js";
import { publicClient, ESCROW_ADDRESS } from "./lib/chain.js";
import { AURASCI_ESCROW_ABI } from "./lib/escrow-abi.js";
import { ENV } from "./lib/env.js";
import { distributeMilestoneYield } from "./lib/aura.js";
import { keccak256, toBytes, type Log } from "viem";

/** Recompute the on-chain `reason` tag the claim flow uses
 *  (keccak256("milestone-<idx>"), see src/client/hooks.ts) so we can map a
 *  Released event back to its exact milestone. */
const reasonTag = (s: string): `0x${string}` => keccak256(toBytes(s));

const POLL_INTERVAL_MS = ENV.INDEXER_POLL_MS;
const CONFIRMATIONS = ENV.INDEXER_CONFIRMATIONS;
// (touched 2026-05-28T11:00Z to force tsx-watch reload after checkpoint reset)

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const err = (...a: unknown[]) => console.error(new Date().toISOString(), ...a);

// Max lag (in blocks) we'll let the checkpoint be behind tip on startup before
// auto-fast-forwarding. Catching up a million blocks at 1000/tick × 4s/tick
// takes ~70 minutes — pointless for an empty/new escrow contract. Set above
// the contract's deploy block if you ever need to genuinely back-fill.
const MAX_STARTUP_LAG = BigInt(process.env.INDEXER_MAX_LAG_BLOCKS ?? 50_000);

async function getOrInitCheckpoint(): Promise<bigint> {
  const cp = await prisma.indexerCheckpoint.findUnique({ where: { id: 1 } });
  const tip = await publicClient.getBlockNumber();
  const safeStart = tip > 10n ? tip - 10n : 0n;

  if (!cp) {
    await prisma.indexerCheckpoint.create({ data: { id: 1, lastBlock: safeStart } });
    log("initialized checkpoint at block", safeStart);
    return safeStart;
  }
  // Auto-jump if the checkpoint is hopelessly behind. The escrow contract
  // didn't exist before its deploy block, so nothing of value sits in the
  // skipped range.
  if (tip - cp.lastBlock > MAX_STARTUP_LAG) {
    log(`checkpoint lag ${tip - cp.lastBlock} blocks > ${MAX_STARTUP_LAG} — fast-forwarding to ${safeStart}`);
    await prisma.indexerCheckpoint.update({ where: { id: 1 }, data: { lastBlock: safeStart } });
    return safeStart;
  }
  return cp.lastBlock;
}

async function setCheckpoint(block: bigint) {
  await prisma.indexerCheckpoint.update({ where: { id: 1 }, data: { lastBlock: block } });
}

// ─── handlers ───────────────────────────────────────────────────────────

async function handleDeposited(l: Log & {
  args: { intentId: `0x${string}`; patron: `0x${string}`; amount: bigint };
}) {
  const { intentId, patron, amount } = l.args;
  const txHash = l.transactionHash!;
  const blockNumber = l.blockNumber!;

  try {
    // Idempotency: a Deposited event can be redelivered (page-replay on crash,
    // RPC double-emit, reorg). The Patronage upsert dedups on txHash, but the
    // ActivityLog insert and the `totalRaisedUsdc` increment are NOT naturally
    // idempotent — so we only run them on the FIRST sight of this txHash,
    // otherwise a replay double-counts funding (and would inflate the refund
    // headroom in routes/refunds.ts).
    const already = await prisma.patronage.findUnique({
      where: { txHash },
      select: { txHash: true },
    });

    // Patronage + ActivityLog must succeed atomically. Intent update is
    // best-effort (an event for an unknown intentId — someone funded via the
    // raw contract — shouldn't poison the whole transaction).
    await prisma.$transaction([
      prisma.patronage.upsert({
        where: { txHash },
        update: {},
        create: {
          intentId,
          patronWallet: patron.toLowerCase(),
          amountUsdc: amount,
          txHash,
          blockNumber,
        },
      }),
      ...(already
        ? []
        : [
            prisma.activityLog.create({
              data: {
                kind: "deposited",
                intentId,
                actorWallet: patron.toLowerCase(),
                amountUsdc: amount,
                txHash,
                blockNumber,
              },
            }),
          ]),
    ]);
    // Outside the transaction so a missing Intent row doesn't roll the rest
    // back. Only on first sight — never on a replay.
    if (!already) {
      await prisma.intent
        .update({ where: { intentId }, data: { totalRaisedUsdc: { increment: amount } } })
        .catch(() => undefined);
    }
    log("⊕ Deposited", intentId, patron, amount.toString(), already ? "(dup, skipped)" : "");
  } catch (e) {
    err("handleDeposited failed:", e);
  }
}

async function handleReleased(l: Log & {
  args: { intentId: `0x${string}`; to: `0x${string}`; amount: bigint; reason: `0x${string}` };
}) {
  const { intentId, to, amount, reason } = l.args;
  const txHash = l.transactionHash!;
  const blockNumber = l.blockNumber!;

  try {
    // Replay safety: if this Released tx is already indexed (`release.txHash`
    // is unique), everything below — status transition, milestone promotion,
    // totalReleased increment, scientist counters, Aura yield — has already
    // run. Bail so a redelivered event can't double-promote / double-count.
    const alreadyIndexed = await prisma.release.findUnique({
      where: { txHash },
      select: { txHash: true },
    });
    if (alreadyIndexed) {
      log("⊖ Released (dup, skipped)", intentId, txHash);
      return;
    }

    // Locate the milestone by decoding the on-chain `reason`, which the claim
    // flow sets to keccak256("milestone-<idx>") (src/client/hooks.ts). Matching
    // on reason is exact even when several milestones of one intent are
    // concurrently `ai_verifying` — the old "oldest ai_verifying" heuristic
    // would mis-attribute the release. Fall back to that heuristic only for a
    // legacy/manual release whose reason doesn't match the scheme.
    const matchedIdx = [0, 1, 2].find((i) => reasonTag(`milestone-${i}`) === reason);
    const milestone =
      matchedIdx !== undefined
        ? await prisma.milestone.findFirst({ where: { intentId, idx: matchedIdx } })
        : await prisma.milestone.findFirst({
            where: { intentId, status: "ai_verifying" },
            orderBy: { idx: "asc" },
          });

    await prisma.$transaction([
      milestone
        ? prisma.release.upsert({
            where: { txHash },
            update: {},
            create: {
              intentId,
              milestoneId: milestone.id,
              to: to.toLowerCase(),
              amountUsdc: amount,
              nonce: milestone.releaseNonce ?? "0x" + "0".repeat(64),
              reason,
              txHash,
              blockNumber,
            },
          })
        : (prisma.activityLog.create({ data: { kind: "milestone_verified", intentId, txHash, blockNumber, payload: { warning: "no milestone in ai_verifying state" } } }) as any),
      milestone
        ? prisma.milestone.update({
            where: { id: milestone.id },
            data: { status: "released", verifiedAt: new Date(), releaseTxHash: txHash },
          })
        : (prisma.activityLog.create({ data: { kind: "milestone_verified", intentId, txHash, blockNumber } }) as any),
      // intent.update lifted out below the transaction (see handleDeposited).
      prisma.activityLog.create({
        data: {
          kind: "milestone_verified",
          intentId,
          actorWallet: to.toLowerCase(),
          amountUsdc: amount,
          milestoneIdx: milestone?.idx ?? null,
          txHash,
          blockNumber,
        },
      }),
    ]);

    // Best-effort intent totals update (outside the transaction).
    await prisma.intent
      .update({ where: { intentId }, data: { totalReleasedUsdc: { increment: amount } } })
      .catch(() => undefined);

    // Bump scientist counters. We early-returned on replay above, so this
    // runs exactly once. Look the scientist wallet up via Intent; best-effort
    // (a missing Scientist row shouldn't roll back the release accounting).
    if (milestone) {
      const intentRow = await prisma.intent.findUnique({
        where: { intentId },
        select: { scientistWallet: true },
      });
      if (intentRow?.scientistWallet) {
        await prisma.scientist
          .update({
            where: { wallet: intentRow.scientistWallet.toLowerCase() },
            data: {
              milestonesVerified: { increment: 1 },
              reputation: { increment: 10 },
            },
          })
          .catch(() => undefined);
      }
    }

    // Promote next milestone, if any.
    if (milestone && milestone.idx < 2) {
      await prisma.milestone.updateMany({
        where: { intentId, idx: milestone.idx + 1, status: "locked" },
        data: { status: "in_progress" },
      });
    }
    if (milestone && milestone.idx === 2) {
      await prisma.intent.update({ where: { intentId }, data: { status: "completed" } });
    }

    log("⊖ Released", intentId, to, amount.toString());

    // Pro-rata Aura yield to patrons of this intent. Idempotent — uniqueness
    // on (wallet, source, txHash) means re-indexing the same Released event
    // doesn't double-distribute.
    if (milestone) {
      try {
        const r = await distributeMilestoneYield({
          intentId,
          milestoneIdx: milestone.idx,
          txHash,
        });
        if (r.distributed > 0) log("✦ Aura yield distributed", r.distributed, "across", (r as any).recipients ?? 0);
      } catch (e) {
        err("aura yield distribution failed (non-fatal):", e);
      }
    }
  } catch (e) {
    err("handleReleased failed:", e);
  }
}

async function handleRefunded(l: Log & {
  args: { intentId: `0x${string}`; patron: `0x${string}`; amount: bigint; reason: `0x${string}` };
}) {
  const { intentId, patron, amount, reason } = l.args;
  const patronWallet = patron.toLowerCase();
  const txHash = l.transactionHash!;
  const blockNumber = l.blockNumber!;

  try {
    // Replay safety: the RefundRecord is unique on txHash, but the FIFO
    // `Patronage.refundedAmount` writes below are absolute and would re-apply
    // (over-reducing net contribution) on a redelivered event. Bail if we've
    // already processed this refund tx.
    const alreadyRefunded = await prisma.refundRecord.findUnique({
      where: { txHash },
      select: { txHash: true },
    });
    if (alreadyRefunded) {
      log("↩ Refunded (dup, skipped)", intentId, txHash);
      return;
    }

    // The Refunded event doesn't carry the nonce. Match an unconsumed
    // SignedNonce(purpose='refund') by the (intentId, recipient, amount)
    // tuple — collisions are practically impossible because the salt-based
    // nonce derivation produces distinct rows per refund cycle.
    const matchedNonce = await prisma.signedNonce.findFirst({
      where: { intentId, recipient: patronWallet, amountUsdc: amount, purpose: "refund", consumed: false },
      orderBy: { createdAt: "asc" },
    });

    // Spread the refunded amount across the patron's oldest deposits FIFO,
    // bumping refundedAmount. This keeps `net = sum(amount) - sum(refunded)`
    // consistent for the leaderboard aggregator.
    const myDeposits = await prisma.patronage.findMany({
      where: { intentId, patronWallet },
      orderBy: { createdAt: "asc" },
    });
    const depositUpdates: { id: string; refundedAmount: bigint; refundTxHash: string; refundedAt: Date }[] = [];
    let remaining = amount;
    for (const d of myDeposits) {
      if (remaining <= 0n) break;
      const headroom = d.amountUsdc - d.refundedAmount;
      if (headroom <= 0n) continue;
      const take = headroom < remaining ? headroom : remaining;
      depositUpdates.push({
        id: d.id,
        refundedAmount: d.refundedAmount + take,
        refundTxHash: txHash,
        refundedAt: new Date(),
      });
      remaining -= take;
    }
    if (remaining > 0n) {
      // Shouldn't happen in normal flow — backend caps the signed amount at
      // the patron's net deposit. Log it so the operator notices.
      err(`Refunded ${amount} for ${patron}@${intentId} exceeds tracked deposits by ${remaining}`);
    }

    await prisma.$transaction([
      prisma.refundRecord.upsert({
        where: { txHash },
        update: {},
        create: {
          intentId,
          patronWallet,
          amountUsdc: amount,
          nonce: matchedNonce?.nonce ?? "0x" + "0".repeat(64),
          reason,
          txHash,
          blockNumber,
        },
      }),
      ...(matchedNonce
        ? [
            prisma.signedNonce.update({
              where: { nonce: matchedNonce.nonce },
              data: { consumed: true, consumedAt: new Date() },
            }),
          ]
        : []),
      ...depositUpdates.map((u) =>
        prisma.patronage.update({
          where: { id: u.id },
          data: { refundedAmount: u.refundedAmount, refundTxHash: u.refundTxHash, refundedAt: u.refundedAt },
        }),
      ),
      prisma.activityLog.create({
        data: {
          kind: "refunded",
          intentId,
          actorWallet: patronWallet,
          amountUsdc: amount,
          txHash,
          blockNumber,
        },
      }),
    ]);
    log("↩ Refunded", intentId, patron, amount.toString(), matchedNonce ? `(nonce ✓)` : `(nonce ?)`);
  } catch (e) {
    err("handleRefunded failed:", e);
  }
}

async function handleAdminWithdrawn(l: Log & {
  args: { intentId: `0x${string}`; to: `0x${string}`; amount: bigint; reason: `0x${string}` };
}) {
  const { intentId, to, amount, reason } = l.args;
  const txHash = l.transactionHash!;
  const blockNumber = l.blockNumber!;
  try {
    // Replay safety: there's no dedicated dedup table for admin withdrawals,
    // but this tx is the only writer of an ActivityLog row with this txHash,
    // so its presence means we've already applied the decrement. Bail to avoid
    // double-decrementing totalRaisedUsdc on a redelivered event.
    const already = await prisma.activityLog.findFirst({
      where: { txHash },
      select: { id: true },
    });
    if (already) {
      log("⚠ AdminWithdrawn (dup, skipped)", intentId, txHash);
      return;
    }

    await prisma.activityLog.create({
      data: {
        kind: "refunded",                 // closest existing ActivityKind — no separate "admin_withdrawn" enum value yet
        intentId,
        actorWallet: to.toLowerCase(),
        amountUsdc: amount,
        txHash,
        blockNumber,
        payload: { source: "adminWithdraw", reason },
      },
    });
    // Best-effort: decrement Intent.totalRaisedUsdc so the UI funding bar
    // reflects the withdrawal. (totalReleased semantically doesn't fit; this
    // is closer to "money left the escrow".)
    await prisma.intent
      .update({ where: { intentId }, data: { totalRaisedUsdc: { decrement: amount } } })
      .catch(() => undefined);
    log("⚠ AdminWithdrawn", intentId, to, amount.toString(), reason);
  } catch (e) {
    err("handleAdminWithdrawn failed:", e);
  }
}

async function handleAdminTransferred(l: Log & {
  args: { previousAdmin: `0x${string}`; newAdmin: `0x${string}` };
}) {
  const { previousAdmin, newAdmin } = l.args;
  log("👑 AdminTransferred", previousAdmin, "→", newAdmin, "block", l.blockNumber);
  // No DB mirror — admin identity isn't surfaced anywhere yet. Logs only.
}

async function handleAdminTransferStarted(l: Log & {
  args: { currentAdmin: `0x${string}`; pendingAdmin: `0x${string}` };
}) {
  const { currentAdmin, pendingAdmin } = l.args;
  if (pendingAdmin === "0x0000000000000000000000000000000000000000") {
    log("👑 admin transfer cancelled by", currentAdmin);
  } else {
    log("👑 AdminTransferStarted", currentAdmin, "→ pending", pendingAdmin);
  }
}

// ─── main loop ──────────────────────────────────────────────────────────

async function main() {
  if (ESCROW_ADDRESS === "0x0000000000000000000000000000000000000000") {
    err("NEXT_PUBLIC_ESCROW_ADDRESS not set — refusing to start.");
    process.exit(1);
  }

  log("indexer starting · chain:", (await publicClient.getChainId()), "· escrow:", ESCROW_ADDRESS);
  let from = await getOrInitCheckpoint();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const tip = (await publicClient.getBlockNumber()) - BigInt(CONFIRMATIONS);
      if (tip <= from) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      const to = from + 1_000n < tip ? from + 1_000n : tip; // page in 1000-block chunks

      const logs = await publicClient.getContractEvents({
        address: ESCROW_ADDRESS,
        abi: AURASCI_ESCROW_ABI,
        fromBlock: from + 1n,
        toBlock: to,
      });

      for (const l of logs) {
        switch (l.eventName) {
          case "Deposited":            await handleDeposited(l as any); break;
          case "Released":             await handleReleased(l as any);  break;
          case "Refunded":             await handleRefunded(l as any);  break;
          case "AdminWithdrawn":       await handleAdminWithdrawn(l as any); break;
          case "AdminTransferred":     await handleAdminTransferred(l as any); break;
          case "AdminTransferStarted": await handleAdminTransferStarted(l as any); break;
        }
      }

      await setCheckpoint(to);
      from = to;
    } catch (e) {
      err("loop error:", e);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

main().catch((e) => {
  err("fatal:", e);
  process.exit(1);
});
