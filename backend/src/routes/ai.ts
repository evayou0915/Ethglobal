/**
 * AI endpoints — all asynchronous. Heavy LLM work happens in the ai-worker
 * process; these handlers just enqueue an AiJob row and return its id. The
 * frontend polls GET /api/ai/jobs/:id for status.
 */
import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../lib/db.js";
import { ok, parseJson } from "../lib/http.js";
import { assertIntentOwner, requireAuth } from "../lib/auth.js";

export const aiRouter = new Hono();

// POST /api/ai/gatekeeper — re-score an existing intent
aiRouter.post("/gatekeeper", requireAuth, async (c) => {
  const { intentId } = await parseJson(
    c,
    z.object({ intentId: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }),
  );

  const intent = await prisma.intent.findUnique({
    where: { intentId },
    select: { intentId: true, status: true, scientistWallet: true },
  });
  if (!intent) throw new HTTPException(404, { message: "intent not found" });
  await assertIntentOwner(c, intent.scientistWallet);

  // If there's already a pending job for this intent, return it instead of
  // piling up duplicates.
  const existing = await prisma.aiJob.findFirst({
    where: { intentId, type: "gatekeeper", status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return ok(c, { job: existing }, 202);

  const job = await prisma.$transaction(async (tx) => {
    await tx.intent.update({
      where: { intentId },
      data: { status: "ai_screening" },
    });
    return tx.aiJob.create({
      data: { type: "gatekeeper", status: "queued", intentId },
    });
  });
  return ok(c, { job }, 202);
});

// POST /api/ai/verifier — score a milestone proof + (on pass) sign EIP-712 release
aiRouter.post("/verifier", requireAuth, async (c) => {
  const { intentId, milestoneIdx } = await parseJson(
    c,
    z.object({
      intentId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
      milestoneIdx: z.number().int().min(0).max(2),
    }),
  );

  const milestone = await prisma.milestone.findUnique({
    where: { intentId_idx: { intentId, idx: milestoneIdx } },
    include: { intent: { select: { scientistWallet: true } } },
  });
  if (!milestone) throw new HTTPException(404, { message: "no such milestone" });
  await assertIntentOwner(c, milestone.intent.scientistWallet);
  if (milestone.status !== "proof_submitted") {
    throw new HTTPException(409, {
      message: `milestone status is ${milestone.status}, expected proof_submitted`,
    });
  }
  if (!milestone.proofCid || !milestone.proofHash) {
    throw new HTTPException(400, { message: "proof has not been uploaded" });
  }

  const existing = await prisma.aiJob.findFirst({
    where: { milestoneId: milestone.id, type: "verifier", status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return ok(c, { job: existing }, 202);

  const job = await prisma.$transaction(async (tx) => {
    await tx.milestone.update({
      where: { id: milestone.id },
      data: { status: "ai_verifying" },
    });
    return tx.aiJob.create({
      data: {
        type: "verifier",
        status: "queued",
        intentId,
        milestoneId: milestone.id,
        inputCid: milestone.proofCid,
      },
    });
  });
  return ok(c, { job }, 202);
});

// GET /api/ai/jobs/:id — poll a job's status. Public on purpose — the id is a
// cuid and acts as the capability token; not enumerable.
aiRouter.get("/jobs/:id", async (c) => {
  const id = c.req.param("id");
  const job = await prisma.aiJob.findUnique({ where: { id } });
  if (!job) throw new HTTPException(404, { message: "job not found" });
  return ok(c, job);
});
