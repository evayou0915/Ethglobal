/**
 * Admin endpoints. Behind `requireAdmin` (JWT.role === "admin").
 *
 * Role assignment is currently manual — promote a user with:
 *   UPDATE "User" SET role='admin' WHERE wallet='0x…';
 * (Then the user must re-login so the new role lands in their JWT claims.)
 */
import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../lib/db.js";
import { ok, parseJson } from "../lib/http.js";
import { requireAdmin } from "../lib/auth.js";
import { asBytes32, deriveNonce, reasonTag, signRefund } from "../lib/eip712.js";

export const adminRouter = new Hono();

// POST /api/admin/intents/:id/refund-all
//
// Signs an EIP-712 Refund for every patron with a positive net balance on
// this intent. Returns the array of signed tuples; the caller broadcasts
// each one via `escrow.refund(...)` on-chain (admin pays gas).
//
// Idempotent: per-patron unconsumed SignedNonce rows are reused.
adminRouter.post("/intents/:id/refund-all", requireAdmin, async (c) => {
  const intentId = c.req.param("id");
  if (!/^0x[0-9a-fA-F]{64}$/.test(intentId)) {
    throw new HTTPException(400, { message: "intent id must be 32-byte hex" });
  }

  const intent = await prisma.intent.findUnique({
    where: { intentId },
    select: {
      intentId: true,
      status: true,
      totalRaisedUsdc: true,
      totalReleasedUsdc: true,
    },
  });
  if (!intent) throw new HTTPException(404, { message: "intent not found" });

  let escrowRemaining = intent.totalRaisedUsdc - intent.totalReleasedUsdc;
  if (escrowRemaining <= 0n) {
    throw new HTTPException(409, { message: "escrow vault is empty — nothing to refund" });
  }

  // Aggregate per-patron net balance via two groupBys (sum + refunded). Same
  // pattern as /api/leaderboard.
  const sums = await prisma.patronage.groupBy({
    by: ["patronWallet"],
    where: { intentId },
    _sum: { amountUsdc: true, refundedAmount: true },
  });

  const intentIdBytes = asBytes32(intentId);
  const refunds: Array<{
    patron: `0x${string}`;
    amount: string;
    nonce: `0x${string}`;
    reason: `0x${string}`;
    signature: `0x${string}`;
  }> = [];

  for (const row of sums) {
    const deposited = row._sum.amountUsdc ?? 0n;
    const refunded  = row._sum.refundedAmount ?? 0n;
    const available = deposited - refunded;
    if (available <= 0n) continue;
    if (escrowRemaining <= 0n) break;

    // Per-patron cap at remaining vault balance. Earlier patrons in the sort
    // get first dibs if escrow can't cover everyone.
    const amount = available < escrowRemaining ? available : escrowRemaining;
    escrowRemaining -= amount;

    const patron = row.patronWallet as `0x${string}`;
    const nonce = deriveNonce({
      purpose: "refund",
      intentId: intentIdBytes,
      target: patron,
      index: 0,
      salt: refunded.toString() + ":admin",
    });
    const reason = reasonTag("admin-refund-all");

    const existing = await prisma.signedNonce.findUnique({ where: { nonce } });
    if (existing && !existing.consumed) {
      refunds.push({
        patron,
        amount: existing.amountUsdc.toString(),
        nonce,
        reason,
        signature: existing.signature as `0x${string}`,
      });
      continue;
    }

    const { signature } = await signRefund({ intentId: intentIdBytes, patron, amount, nonce });
    await prisma.signedNonce.upsert({
      where: { nonce },
      update: { signature, amountUsdc: amount },
      create: {
        nonce,
        purpose: "refund",
        intentId,
        amountUsdc: amount,
        recipient: patron,
        signature,
      },
    });
    refunds.push({ patron, amount: amount.toString(), nonce, reason, signature: signature as `0x${string}` });
  }

  return ok(c, { intentId, count: refunds.length, refunds });
});

// ─── Aura: season + grant management ────────────────────────────────────

const SeasonSchema = z.object({
  name:              z.string().min(2).max(40),
  startsAt:          z.string().datetime(),
  endsAt:            z.string().datetime(),
  budgetPerPatron:   z.number().int().min(1).max(1_000_000).optional(),
  yieldPerMilestone: z.number().int().min(0).max(1_000_000).optional(),
  activate:          z.boolean().optional(),    // if true, deactivate any other active season
});

// POST /api/admin/aura/seasons — create a new season; optionally activate it.
adminRouter.post("/aura/seasons", requireAdmin, async (c) => {
  const body = await parseJson(c, SeasonSchema);
  const created = await prisma.$transaction(async (tx) => {
    if (body.activate) {
      await tx.auraSeason.updateMany({ where: { active: true }, data: { active: false } });
    }
    return tx.auraSeason.create({
      data: {
        name: body.name,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        budgetPerPatron: body.budgetPerPatron ?? 100,
        yieldPerMilestone: body.yieldPerMilestone ?? 20,
        active: !!body.activate,
      },
    });
  });
  return ok(c, created, 201);
});

// POST /api/admin/aura/seasons/:id/activate — make this the active season.
adminRouter.post("/aura/seasons/:id/activate", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const season = await prisma.auraSeason.findUnique({ where: { id } });
  if (!season) throw new HTTPException(404, { message: "season not found" });
  await prisma.$transaction([
    prisma.auraSeason.updateMany({ where: { active: true }, data: { active: false } }),
    prisma.auraSeason.update({ where: { id }, data: { active: true } }),
  ]);
  return ok(c, { ...season, active: true });
});

// GET /api/admin/aura/seasons — list all seasons.
adminRouter.get("/aura/seasons", requireAdmin, async (c) => {
  const items = await prisma.auraSeason.findMany({ orderBy: { startsAt: "desc" } });
  return ok(c, { items });
});

const GrantSchema = z.object({
  wallet:       z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amount:       z.number().int().min(1).max(1_000_000),
  source:       z.string().min(1).max(30).default("admin_grant"),
  intentId:     z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  milestoneIdx: z.number().int().min(0).max(2).optional(),
});

// POST /api/admin/aura/grants — manually credit Aura to a wallet on the
// active season. Use sparingly — milestone yield is the primary distribution
// mechanism (see indexer's handleReleased path).
adminRouter.post("/aura/grants", requireAdmin, async (c) => {
  const body = await parseJson(c, GrantSchema);
  const season = await prisma.auraSeason.findFirst({ where: { active: true } });
  if (!season) throw new HTTPException(503, { message: "no active season" });

  // Synthetic txHash so the (wallet, source, txHash) unique constraint
  // doesn't conflict across admin grants.
  const txHash = "admin-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

  const grant = await prisma.auraYield.create({
    data: {
      wallet: body.wallet.toLowerCase(),
      intentId: body.intentId,
      seasonId: season.id,
      amount: body.amount,
      source: body.source ?? "admin_grant",
      milestoneIdx: body.milestoneIdx,
      txHash,
    },
  });
  return ok(c, grant, 201);
});
