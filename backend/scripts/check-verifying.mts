import { prisma } from "../src/lib/db.js";

const ms = await prisma.milestone.findMany({
  where: { status: "ai_verifying" },
  include: { intent: { select: { intentId: true, ticker: true } } },
});

if (ms.length === 0) {
  console.log("no milestones in ai_verifying state");
} else {
  for (const m of ms) {
    console.log({
      intentId: m.intent.intentId,
      ticker: m.intent.ticker,
      idx: m.idx,
      hasSig: !!m.releaseSignature,
      hasNonce: !!m.releaseNonce,
      aiScore: m.aiScore,
    });
  }
}
await prisma.$disconnect();
