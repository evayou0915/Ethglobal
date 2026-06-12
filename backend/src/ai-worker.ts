/**
 * AI worker process — drains AiJob rows in `queued` state.
 *
 * Run as its own process via pm2 (separate from the HTTP server + indexer):
 *   pm2 start dist/ai-worker.js --name aurasci-ai
 *
 * Design notes:
 * - Single-instance assumption. If you ever scale to multiple workers, add a
 *   SELECT ... FOR UPDATE SKIP LOCKED claim. For one process, the simpler
 *   conditional update is race-free against itself.
 * - Idempotent re-attempts: a job that crashed mid-flight (status=running
 *   with `startedAt` older than STALE_RUNNING_MS) is reclaimed on the next
 *   tick. attempts column tracks total tries; after MAX_ATTEMPTS it's left
 *   in failed terminal state.
 * - HTTP handlers never call scoreIntent/scoreProof directly anymore — they
 *   enqueue an AiJob and return its id. Frontend polls GET /api/ai/jobs/:id.
 */
import "dotenv/config";
import { prisma } from "./lib/db.js";
import { scoreIntentQuorum, scoreProof } from "./lib/ai.js";
import { asBytes32, deriveNonce, signRelease } from "./lib/eip712.js";

const TICK_MS = Number(process.env.AI_WORKER_TICK_MS ?? 2_000);
const STALE_RUNNING_MS = Number(process.env.AI_WORKER_STALE_MS ?? 5 * 60_000);
const MAX_ATTEMPTS = Number(process.env.AI_WORKER_MAX_ATTEMPTS ?? 3);
const PASS_THRESHOLD = 70;

let stopping = false;
process.on("SIGINT",  () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function reclaimStale() {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS);
  const { count } = await prisma.aiJob.updateMany({
    where: { status: "running", startedAt: { lt: cutoff } },
    data: { status: "queued" },
  });
  if (count > 0) console.log(`[ai-worker] reclaimed ${count} stale running job(s)`);
}

async function claimOne() {
  // Single-process worker: pick the oldest queued job whose attempt count
  // hasn't exceeded the cap, mark it running.
  const candidate = await prisma.aiJob.findFirst({
    where: { status: "queued", attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return null;
  await prisma.aiJob.update({
    where: { id: candidate.id },
    data: { status: "running", startedAt: new Date(), attempts: { increment: 1 } },
  });
  return candidate;
}

async function runGatekeeper(jobId: string, intentId: string) {
  const intent = await prisma.intent.findUnique({
    where: { intentId },
    select: {
      intentId: true, title: true, descriptionMd: true, category: true, fundingGoalUsdc: true,
      scientistWallet: true,
      milestones: { select: { title: true, descriptionMd: true, releaseAmountUsdc: true }, orderBy: { idx: "asc" } },
    },
  });
  if (!intent) throw new Error(`intent ${intentId} no longer exists`);

  // 5-agent quorum — each agent reviews from a distinct angle, in parallel.
  // Pass requires both ≥3/5 agents approving AND mean score >= 70 (see
  // QuorumResult.passed in lib/ai.ts for why both checks are needed).
  const result = await scoreIntentQuorum({
    title: intent.title,
    description: intent.descriptionMd,
    category: intent.category,
    fundingGoalUsdc: intent.fundingGoalUsdc,
    milestones: intent.milestones,
  });
  const passed = result.passed;

  await prisma.$transaction([
    prisma.intent.update({
      where: { intentId },
      data: {
        aiGatekeeperScore: result.score,
        aiGatekeeperRationale: result.rationale,
        status: passed ? "published" : "rejected",
        publishedAt: passed ? new Date() : null,
      },
    }),
    // First milestone moves to `in_progress` when the intent gets published.
    // Done as a separate updateMany so we don't have to look up the cuid here.
    ...(passed
      ? [
          prisma.milestone.updateMany({
            where: { intentId, idx: 0, status: "locked" },
            data: { status: "in_progress" },
          }),
        ]
      : []),
    prisma.aiJob.update({
      where: { id: jobId },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        score: result.score,
        rationale: result.rationale,
        agentVerdicts: result.verdicts as any, // JSON column
      },
    }),
  ]);

  // Bump the scientist's published-intents counter when the gatekeeper
  // passes. Best-effort, outside the main transaction: the Scientist row
  // may not exist yet for users who skipped /onboard, and a counter miss
  // shouldn't roll back the intent's publish state. Re-running the
  // worker on the same intent won't double-increment because the
  // AiJob.status -> "succeeded" transition above prevents reclaim.
  if (passed && intent.scientistWallet) {
    await prisma.scientist
      .update({
        where: { wallet: intent.scientistWallet.toLowerCase() },
        data: {
          intentsPublished: { increment: 1 },
          reputation: { increment: 5 },
        },
      })
      .catch(() => undefined);
  }
}

async function runVerifier(jobId: string, intentId: string, milestoneId: string) {
  const milestone = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    include: { intent: { select: { scientistWallet: true } } },
  });
  if (!milestone) throw new Error(`milestone ${milestoneId} no longer exists`);
  if (!milestone.proofCid || !milestone.proofHash) {
    throw new Error("milestone has no proof attached");
  }

  const scored = await scoreProof({
    milestoneTitle: milestone.title,
    milestoneDescription: milestone.descriptionMd,
    proofCid: milestone.proofCid,
    proofHash: milestone.proofHash,
  });

  if (scored.score < PASS_THRESHOLD) {
    await prisma.$transaction([
      prisma.milestone.update({
        where: { id: milestone.id },
        data: { aiScore: scored.score, aiRationale: scored.rationale, status: "rejected" },
      }),
      prisma.aiJob.update({
        where: { id: jobId },
        data: { status: "succeeded", finishedAt: new Date(), score: scored.score, rationale: scored.rationale },
      }),
    ]);
    return;
  }

  // Passing path — sign EIP-712 release so the scientist's claim button has
  // a signature to submit on-chain.
  const intentIdBytes = asBytes32(intentId);
  const to = milestone.intent.scientistWallet as `0x${string}`;
  const amount = milestone.releaseAmountUsdc;
  const nonce = deriveNonce({
    purpose: "release",
    intentId: intentIdBytes,
    target: to,
    index: milestone.idx,
  });

  const { signature } = await signRelease({ intentId: intentIdBytes, to, amount, nonce });

  await prisma.$transaction([
    prisma.milestone.update({
      where: { id: milestone.id },
      data: {
        aiScore: scored.score,
        aiRationale: scored.rationale,
        status: "ai_verifying",
        releaseSignature: signature,
        releaseNonce: nonce,
      },
    }),
    prisma.aiJob.update({
      where: { id: jobId },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        score: scored.score,
        rationale: scored.rationale,
        signature,
        nonce,
      },
    }),
    prisma.signedNonce.upsert({
      where: { nonce },
      update: {},
      create: { nonce, purpose: "release", intentId, amountUsdc: amount, recipient: to, signature },
    }),
  ]);
}

async function processOne() {
  const job = await claimOne();
  if (!job) return false;

  console.log(`[ai-worker] running ${job.type} job ${job.id} (attempt ${job.attempts + 1})`);
  try {
    if (job.type === "gatekeeper") {
      if (!job.intentId) throw new Error("gatekeeper job missing intentId");
      await runGatekeeper(job.id, job.intentId);
    } else if (job.type === "verifier") {
      if (!job.intentId || !job.milestoneId) {
        throw new Error("verifier job missing intentId or milestoneId");
      }
      await runVerifier(job.id, job.intentId, job.milestoneId);
    } else {
      throw new Error(`unknown job type: ${job.type}`);
    }
    console.log(`[ai-worker] ✓ ${job.id}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[ai-worker] ✗ ${job.id}: ${message}`);
    const finalAttempt = (job.attempts + 1) >= MAX_ATTEMPTS;
    await prisma.aiJob.update({
      where: { id: job.id },
      data: {
        status: finalAttempt ? "failed" : "queued",  // requeue for retry unless exhausted
        finishedAt: finalAttempt ? new Date() : null,
        error: message,
      },
    });
  }
  return true;
}

async function main() {
  console.log(`▶ aurasci-ai-worker tick=${TICK_MS}ms stale=${STALE_RUNNING_MS}ms maxAttempts=${MAX_ATTEMPTS}`);
  await reclaimStale();
  while (!stopping) {
    const did = await processOne();
    if (!did) {
      // No work — short nap, but stay responsive to SIGTERM.
      await new Promise((r) => setTimeout(r, TICK_MS));
    }
  }
  console.log("[ai-worker] shutting down");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("[ai-worker] fatal:", e);
  process.exit(1);
});
