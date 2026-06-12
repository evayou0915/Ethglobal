/**
 * Refund signing — patron self-service.
 *
 * Triggers (`intent.status === 'rejected'` OR any milestone in `rejected`):
 * a patron can request an EIP-712 Refund signature for their remaining net
 * contribution. They then submit `escrow.refund(...)` on-chain themselves.
 *
 * Authorization: only the patron themselves can request a refund for their
 * own wallet. There is no admin-on-behalf path here — add it later if/when
 * governance lands a "refund all patrons of intent X" workflow.
 *
 * The amount is computed server-side from the indexed Patronage table; the
 * client cannot ask for more than its net deposit. We also cap at the
 * intent's remaining escrow (totalRaised - totalReleased) as a defensive
 * second bound, even though the contract enforces this too.
 */
import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../lib/db.js";
import { ok, parseJson } from "../lib/http.js";
import { requireAuth, walletFrom } from "../lib/auth.js";
import { asBytes32, deriveNonce, reasonTag, signRefund } from "../lib/eip712.js";

export const refundsRouter = new Hono();

const Body = z.object({
  intentId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

// POST /api/refunds — issue a Refund signature for the caller's remaining deposit
refundsRouter.post("/", requireAuth, async (c) => {
  const wallet = walletFrom(c);
  const { intentId } = await parseJson(c, Body);

  const intent = await prisma.intent.findUnique({
    where: { intentId },
    include: { milestones: { orderBy: { idx: "asc" }, select: { idx: true, status: true } } },
  });
  if (!intent) throw new HTTPException(404, { message: "intent not found" });

  // Eligibility window: intent rejected OR any milestone rejected.
  const rejectedMilestone = intent.milestones.find((m) => m.status === "rejected");
  const eligible = intent.status === "rejected" || !!rejectedMilestone;
  if (!eligible) {
    throw new HTTPException(409, {
      message: `intent is ${intent.status}; refunds are only signable for rejected intents/milestones`,
    });
  }

  // Sum the patron's net contribution.
  const myDeposits = await prisma.patronage.findMany({
    where: { intentId, patronWallet: wallet },
  });
  if (myDeposits.length === 0) {
    throw new HTTPException(404, { message: "no deposits on record for this wallet" });
  }
  const totalDeposited = myDeposits.reduce((s, p) => s + p.amountUsdc, 0n);
  const totalRefunded  = myDeposits.reduce((s, p) => s + p.refundedAmount, 0n);
  const available = totalDeposited - totalRefunded;
  if (available <= 0n) {
    throw new HTTPException(409, { message: "no refundable balance remaining for this wallet" });
  }

  // Cap at the intent's remaining escrow. If patron's share exceeds this
  // (because milestones already drained the vault), only sign up to what
  // the contract actually holds.
  const escrowRemaining = intent.totalRaisedUsdc - intent.totalReleasedUsdc;
  if (escrowRemaining <= 0n) {
    throw new HTTPException(409, { message: "escrow vault has no remaining balance" });
  }
  const amount = available < escrowRemaining ? available : escrowRemaining;

  const intentIdBytes = asBytes32(intentId);
  const patronAddr = wallet as `0x${string}`;

  // Salt the nonce with cumulative refunded so each refund cycle gets a
  // fresh, non-replayable nonce.
  const nonce = deriveNonce({
    purpose: "refund",
    intentId: intentIdBytes,
    target: patronAddr,
    index: rejectedMilestone?.idx ?? 0,
    salt: totalRefunded.toString(),
  });
  const reason = reasonTag(
    rejectedMilestone ? `refund-milestone-${rejectedMilestone.idx}` : "refund-intent",
  );

  // Idempotency: if we already signed this exact tuple and the user hasn't
  // submitted on-chain yet, return the existing signature instead of burning
  // another signer-key call. After the indexer observes the Refunded event
  // it will flip `consumed=true` and the next call gets a fresh signature.
  const existing = await prisma.signedNonce.findUnique({ where: { nonce } });
  if (existing && !existing.consumed) {
    return ok(c, {
      refund: {
        intentId,
        patron: patronAddr,
        amount: existing.amountUsdc.toString(),
        nonce,
        reason,
        signature: existing.signature,
      },
    });
  }

  const { signature } = await signRefund({
    intentId: intentIdBytes,
    patron: patronAddr,
    amount,
    nonce,
  });

  await prisma.signedNonce.upsert({
    where: { nonce },
    update: { signature, amountUsdc: amount },
    create: {
      nonce,
      purpose: "refund",
      intentId,
      amountUsdc: amount,
      recipient: patronAddr,
      signature,
    },
  });

  return ok(c, {
    refund: {
      intentId,
      patron: patronAddr,
      amount: amount.toString(),
      nonce,
      reason,
      signature,
    },
  });
});

// GET /api/refunds/eligibility?intentId=0x... — preview without burning a signature
refundsRouter.get("/eligibility", requireAuth, async (c) => {
  const wallet = walletFrom(c);
  const intentId = c.req.query("intentId") ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(intentId)) {
    throw new HTTPException(400, { message: "intentId must be a 32-byte hex string" });
  }
  const intent = await prisma.intent.findUnique({
    where: { intentId },
    select: {
      status: true,
      totalRaisedUsdc: true,
      totalReleasedUsdc: true,
      milestones: { select: { idx: true, status: true } },
    },
  });
  if (!intent) throw new HTTPException(404, { message: "intent not found" });

  const rejectedMilestone = intent.milestones.find((m) => m.status === "rejected");
  const eligibleByStatus = intent.status === "rejected" || !!rejectedMilestone;

  const myDeposits = await prisma.patronage.findMany({
    where: { intentId, patronWallet: wallet },
  });
  const totalDeposited = myDeposits.reduce((s, p) => s + p.amountUsdc, 0n);
  const totalRefunded  = myDeposits.reduce((s, p) => s + p.refundedAmount, 0n);
  const available = totalDeposited - totalRefunded;
  const escrowRemaining = intent.totalRaisedUsdc - intent.totalReleasedUsdc;
  const refundable = available < escrowRemaining ? available : escrowRemaining;

  return ok(c, {
    eligible: eligibleByStatus && available > 0n && escrowRemaining > 0n,
    intentStatus: intent.status,
    rejectedMilestoneIdx: rejectedMilestone?.idx ?? null,
    totalDepositedUsdc: totalDeposited.toString(),
    totalRefundedUsdc: totalRefunded.toString(),
    availableUsdc: available.toString(),
    escrowRemainingUsdc: escrowRemaining.toString(),
    refundableUsdc: refundable > 0n ? refundable.toString() : "0",
  });
});
