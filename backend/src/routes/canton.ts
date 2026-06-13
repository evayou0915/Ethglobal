import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../lib/db.js";
import { ok, parseJson } from "../lib/http.js";
import { requireAuth, optionalAuth, walletFrom } from "../lib/auth.js";
import * as canton from "../lib/canton.js";

export const cantonRouter = new Hono();

/** 503 guard — the Canton rail is optional; without a sandbox configured
 *  the rest of AuraSci is unaffected. */
cantonRouter.use("*", async (c, next) => {
  if (!canton.CANTON_ENABLED) {
    throw new HTTPException(503, { message: "Canton rail disabled (set CANTON_JSON_API_URL)" });
  }
  await next();
});

/** Public-ish summary: aggregate total + patron count (privacy-preserving
 *  by construction — individual rows never leave the operator query).
 *  When the caller is signed in, their own private patronages are included. */
cantonRouter.get("/intents/:id", optionalAuth, async (c) => {
  const intentId = c.req.param("id").toLowerCase();
  const wallet = c.get("wallet") as string | undefined;
  const summary = await canton.intentSummary(intentId, wallet);
  return ok(c, summary);
});

const FundSchema = z.object({
  intentId: z.string().regex(/^0x[0-9a-f]{64}$/i),
  amountUsd: z.number().positive().max(10_000_000),
});

/** Fund an intent on the private rail. Mirrors the DB intent onto the
 *  ledger on first touch, then exercises Fund as patron + operator. */
cantonRouter.post("/fund", requireAuth, async (c) => {
  const body = await parseJson(c, FundSchema);
  const wallet = walletFrom(c);

  const intent = await prisma.intent.findUnique({
    where: { intentId: body.intentId.toLowerCase() },
    include: { milestones: { orderBy: { idx: "asc" } } },
  });
  if (!intent) throw new HTTPException(404, { message: "intent not found" });

  const onLedger = await canton.ensureIntent({
    intentId: intent.intentId,
    title: intent.title,
    fundingGoalUsdc: intent.fundingGoalUsdc.toString(),
    scientistWallet: intent.scientistWallet,
    milestones: intent.milestones.map((m) => ({
      idx: m.idx, title: m.title, releaseAmountUsdc: m.releaseAmountUsdc.toString(), status: m.status,
    })),
  });

  const patronageCid = await canton.fund(onLedger.contractId, wallet, body.amountUsd);
  const summary = await canton.intentSummary(intent.intentId, wallet);
  return ok(c, { patronageCid, ...summary });
});

const ReleaseSchema = z.object({
  intentId: z.string().regex(/^0x[0-9a-f]{64}$/i),
  milestoneIdx: z.number().int().min(0).max(50),
});

/** Release a milestone on the Canton rail. The release is still gated on
 *  the SAME AI verdict as Base: we read the latest verifier AiJob for
 *  this milestone from Postgres and refuse below the 70 threshold —
 *  then the operator + verifier parties exercise ReleaseMilestone. */
cantonRouter.post("/release", requireAuth, async (c) => {
  const body = await parseJson(c, ReleaseSchema);
  const intentId = body.intentId.toLowerCase();

  const intent = await prisma.intent.findUnique({ where: { intentId } });
  if (!intent) throw new HTTPException(404, { message: "intent not found" });
  const caller = walletFrom(c);
  if (caller !== intent.scientistWallet.toLowerCase()) {
    throw new HTTPException(403, { message: "only the intent's scientist may release" });
  }

  const milestone = await prisma.milestone.findFirst({
    where: { intentId, idx: body.milestoneIdx },
  });
  const score = milestone?.aiScore ?? 0;
  if (score < 70) {
    throw new HTTPException(409, {
      message: `AI verifier score ${score}/100 below release threshold — submit proof and run the verifier first`,
    });
  }

  const onLedger = await canton.findIntent(intentId);
  if (!onLedger) throw new HTTPException(404, { message: "intent has no Canton mirror yet (no private patronage)" });

  await canton.releaseMilestone(onLedger.contractId, body.milestoneIdx, score);
  return ok(c, { released: body.milestoneIdx, aiScore: score });
});
