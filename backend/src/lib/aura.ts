/**
 * Aura — season-scoped social-points ledger.
 *
 * Conventions:
 * - Exactly one AuraSeason has `active=true` at any given moment. Helpers
 *   default to "the active season" but accept an explicit seasonId for
 *   admin/audit reads.
 * - Balances aren't materialized. They're derived as
 *     `budgetPerPatron + sum(yield) - sum(spend)`
 *   on demand. Cheap enough at our scale; switch to a balance row if it
 *   ever shows up in slow logs.
 * - Wallets are stored lowercase everywhere by convention.
 */
import { HTTPException } from "hono/http-exception";
import { prisma } from "./db.js";

export type SeasonContext = Awaited<ReturnType<typeof getActiveSeason>>;

/** Return the currently-active season, or 404 if the operator hasn't
 *  bootstrapped one yet. */
export async function getActiveSeason() {
  const s = await prisma.auraSeason.findFirst({ where: { active: true } });
  if (!s) {
    throw new HTTPException(503, {
      message: "no active Aura season — operator must POST /api/admin/aura/seasons",
    });
  }
  return s;
}

/** Aggregate spend / yield for a wallet within a season. */
export async function balanceFor(wallet: string, seasonId?: string) {
  const w = wallet.toLowerCase();
  const season = seasonId
    ? await prisma.auraSeason.findUnique({ where: { id: seasonId } })
    : await getActiveSeason();
  if (!season) throw new HTTPException(404, { message: "season not found" });

  const [spends, yields] = await Promise.all([
    prisma.auraSpend.aggregate({
      where: { wallet: w, seasonId: season.id },
      _sum: { amount: true },
    }),
    prisma.auraYield.aggregate({
      where: { wallet: w, seasonId: season.id },
      _sum: { amount: true },
    }),
  ]);

  const used  = spends._sum.amount ?? 0;
  const bonus = yields._sum.amount ?? 0;
  const total = season.budgetPerPatron + bonus;
  return {
    season,
    budgetPerPatron: season.budgetPerPatron,
    bonus,
    used,
    total,
    remaining: total - used,
  };
}

/** Heat = total spend on an intent. Optionally constrained to a season;
 *  when seasonId omitted, sums across all seasons (lifetime heat). */
export async function heatFor(intentId: string, seasonId?: string) {
  const agg = await prisma.auraSpend.aggregate({
    where: { intentId, ...(seasonId ? { seasonId } : {}) },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}

/** Atomic boost — debits the wallet's balance and writes the spend row.
 *  Throws 409 if balance is insufficient or amount invalid. */
export async function recordSpend(args: { wallet: string; intentId: string; amount: number }) {
  const wallet = args.wallet.toLowerCase();
  if (!Number.isInteger(args.amount) || args.amount <= 0) {
    throw new HTTPException(400, { message: "amount must be a positive integer" });
  }

  // Confirm the intent exists and is in a state that accepts boosts. Rejected
  // / completed intents shouldn't accept new boosts — there's no point.
  const intent = await prisma.intent.findUnique({
    where: { intentId: args.intentId },
    select: { intentId: true, status: true },
  });
  if (!intent) throw new HTTPException(404, { message: "intent not found" });
  if (intent.status === "rejected" || intent.status === "completed") {
    throw new HTTPException(409, {
      message: `intent is ${intent.status} — boosts are not accepted in this state`,
    });
  }

  const season = await getActiveSeason();

  // Compute remaining inside a transaction so two concurrent boost requests
  // can't both pass the balance check.
  return prisma.$transaction(async (tx) => {
    const [usedAgg, yieldAgg] = await Promise.all([
      tx.auraSpend.aggregate({ where: { wallet, seasonId: season.id }, _sum: { amount: true } }),
      tx.auraYield.aggregate({ where: { wallet, seasonId: season.id }, _sum: { amount: true } }),
    ]);
    const used  = usedAgg._sum.amount ?? 0;
    const bonus = yieldAgg._sum.amount ?? 0;
    const remaining = season.budgetPerPatron + bonus - used;
    if (args.amount > remaining) {
      throw new HTTPException(409, {
        message: `insufficient Aura: have ${remaining}, need ${args.amount}`,
      });
    }
    const spend = await tx.auraSpend.create({
      data: { wallet, intentId: args.intentId, seasonId: season.id, amount: args.amount },
    });
    return { spend, newRemaining: remaining - args.amount, season };
  });
}

/** Pro-rata distribute a yield pool to every patron of an intent, weighted
 *  by their net contribution. Called by the indexer on a Released event.
 *  Idempotent via the (wallet, source, txHash) unique key. */
export async function distributeMilestoneYield(args: {
  intentId: string;
  milestoneIdx: number;
  txHash: string;
  poolOverride?: number;          // for testing
}) {
  const season = await prisma.auraSeason.findFirst({ where: { active: true } });
  if (!season) return { distributed: 0, reason: "no active season" };

  const pool = args.poolOverride ?? season.yieldPerMilestone;
  if (pool <= 0) return { distributed: 0, reason: "yield pool is 0" };

  // Per-patron net contribution to this intent.
  const sums = await prisma.patronage.groupBy({
    by: ["patronWallet"],
    where: { intentId: args.intentId },
    _sum: { amountUsdc: true, refundedAmount: true },
  });
  const totalNet = sums.reduce((acc, s) => {
    const n = (s._sum.amountUsdc ?? 0n) - (s._sum.refundedAmount ?? 0n);
    return acc + (n > 0n ? n : 0n);
  }, 0n);
  if (totalNet === 0n) return { distributed: 0, reason: "no positive net contributions" };

  let distributed = 0;
  for (const row of sums) {
    const net = (row._sum.amountUsdc ?? 0n) - (row._sum.refundedAmount ?? 0n);
    if (net <= 0n) continue;
    // Integer math: round down, but guarantee at least 1 for any positive contributor.
    const share = Number((BigInt(pool) * net) / totalNet);
    const amount = Math.max(share, 1);
    try {
      await prisma.auraYield.create({
        data: {
          wallet: row.patronWallet.toLowerCase(),
          intentId: args.intentId,
          seasonId: season.id,
          amount,
          source: "milestone_released",
          milestoneIdx: args.milestoneIdx,
          txHash: args.txHash,
        },
      });
      distributed += amount;
    } catch (e: any) {
      // Unique violation = already distributed for this (wallet, source, txHash).
      // Safe to swallow — this is the idempotency guard.
      if (e?.code !== "P2002") throw e;
    }
  }
  return { distributed, recipients: sums.length, seasonId: season.id };
}
