/**
 * Aura endpoints (patron-facing).
 *
 * Auth model: reads are public, the boost write requires a JWT. Boosting on
 * behalf of someone else is impossible — `walletFrom(c)` is the spender.
 */
import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../lib/db.js";
import { ok, parseJson } from "../lib/http.js";
import { optionalAuth, requireAuth, walletFrom } from "../lib/auth.js";
import { balanceFor, getActiveSeason, heatFor, recordSpend } from "../lib/aura.js";

export const auraRouter = new Hono();

// GET /api/aura/season — active season + caller's balance (when authed).
auraRouter.get("/season", optionalAuth, async (c) => {
  const season = await getActiveSeason();
  const wallet = c.get("wallet");
  const balance = wallet ? await balanceFor(wallet, season.id) : null;
  return ok(c, {
    season,
    you: balance ? {
      budgetPerPatron: balance.budgetPerPatron,
      bonus: balance.bonus,
      used: balance.used,
      total: balance.total,
      remaining: balance.remaining,
    } : null,
  });
});

// GET /api/aura/balance — caller's balance only. 401 if no auth.
auraRouter.get("/balance", requireAuth, async (c) => {
  const wallet = walletFrom(c);
  const balance = await balanceFor(wallet);
  return ok(c, balance);
});

// GET /api/aura/heat?intentIds=0x..,0x.. — batch heat lookup for market grid
// Falls back to lifetime heat if no season filter is provided.
auraRouter.get("/heat", async (c) => {
  const idsParam = c.req.query("intentIds") ?? "";
  const seasonFilter = c.req.query("season");                 // "active" | "all" | <seasonId>
  const intentIds = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
  if (intentIds.length === 0) return ok(c, {});

  let seasonId: string | undefined = undefined;
  if (seasonFilter === "active" || seasonFilter == null) {
    seasonId = (await getActiveSeason()).id;
  } else if (seasonFilter !== "all") {
    seasonId = seasonFilter;
  }
  const agg = await prisma.auraSpend.groupBy({
    by: ["intentId"],
    where: { intentId: { in: intentIds }, ...(seasonId ? { seasonId } : {}) },
    _sum: { amount: true },
  });
  const out: Record<string, number> = {};
  for (const id of intentIds) out[id] = 0;
  for (const row of agg) out[row.intentId] = row._sum.amount ?? 0;
  return ok(c, out);
});

// GET /api/aura/spends — caller's spends for the active season (for portfolio).
auraRouter.get("/spends", requireAuth, async (c) => {
  const wallet = walletFrom(c);
  const season = await getActiveSeason();
  const rows = await prisma.auraSpend.findMany({
    where: { wallet, seasonId: season.id },
    orderBy: { createdAt: "desc" },
    include: { intent: { select: { intentId: true, ticker: true, title: true } } },
  });
  return ok(c, { items: rows, seasonId: season.id });
});

// GET /api/aura/yields — caller's yields for the active season.
auraRouter.get("/yields", requireAuth, async (c) => {
  const wallet = walletFrom(c);
  const season = await getActiveSeason();
  const rows = await prisma.auraYield.findMany({
    where: { wallet, seasonId: season.id },
    orderBy: { createdAt: "desc" },
    include: { intent: { select: { intentId: true, ticker: true, title: true } } },
  });
  return ok(c, { items: rows, seasonId: season.id });
});

const BoostSchema = z.object({
  intentId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  amount:   z.number().int().min(1).max(100_000),
});

// POST /api/aura/boost — spend Aura on an intent.
auraRouter.post("/boost", requireAuth, async (c) => {
  const wallet = walletFrom(c);
  const body = await parseJson(c, BoostSchema);
  const result = await recordSpend({ wallet, intentId: body.intentId, amount: body.amount });
  // Heat snapshot helps the UI update without a separate roundtrip.
  const heat = await heatFor(body.intentId, result.season.id);
  return ok(c, {
    spend: result.spend,
    remaining: result.newRemaining,
    heat,
  });
});

// GET /api/aura/leaderboard?limit=50 — intents ranked by heat in active season.
auraRouter.get("/leaderboard", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const seasonParam = c.req.query("season");
  const seasonId = seasonParam === "all"
    ? undefined
    : seasonParam ?? (await getActiveSeason()).id;

  const agg = await prisma.auraSpend.groupBy({
    by: ["intentId"],
    where: seasonId ? { seasonId } : {},
    _sum: { amount: true },
    orderBy: { _sum: { amount: "desc" } },
    take: limit,
  });
  const intents = agg.length
    ? await prisma.intent.findMany({
        where: { intentId: { in: agg.map((r) => r.intentId) } },
        select: { intentId: true, ticker: true, title: true, status: true, category: true },
      })
    : [];
  const byId = new Map(intents.map((i) => [i.intentId, i]));
  const items = agg.map((r, i) => ({
    rank: i + 1,
    intentId: r.intentId,
    heat: r._sum.amount ?? 0,
    intent: byId.get(r.intentId) ?? null,
  }));
  return ok(c, { items, seasonId: seasonId ?? null });
});
