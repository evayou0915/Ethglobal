// Reset a milestone from `rejected` (AI verifier failed) back to
// `in_progress` so the scientist can re-upload and retry.
//
// Usage:
//   npx tsx scripts/reset-milestone.mts <intentId> <idx>
import { prisma } from "../src/lib/db.js";

const [intentId, idxStr] = process.argv.slice(2);
if (!intentId || !idxStr) {
  console.error("usage: reset-milestone.mts <intentId> <idx>");
  process.exit(1);
}
const idx = Number(idxStr);

const before = await prisma.milestone.findUnique({
  where: { intentId_idx: { intentId, idx } },
  select: { status: true, aiScore: true, aiRationale: true },
});
if (!before) {
  console.error("no such milestone");
  process.exit(1);
}
console.log("before:", before);

await prisma.milestone.update({
  where: { intentId_idx: { intentId, idx } },
  data: {
    status: "in_progress",
    aiScore: null,
    aiRationale: null,
    releaseSignature: null,
    releaseNonce: null,
    proofCid: null,
    proofHash: null,
    proofFileName: null,
    proofFileMime: null,
    proofUploadedAt: null,
  },
});
console.log(`✓ M${idx} reset to in_progress (sig/proof cleared)`);
await prisma.$disconnect();
