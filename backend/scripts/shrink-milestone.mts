// Temporarily reduce a milestone's release amount so on-chain release()
// doesn't revert with InsufficientEscrow when the testnet escrow only has
// a few USDC. Strictly a demo helper — do not run against real intents.
//
//   npx tsx scripts/shrink-milestone.mts <intentId> <milestoneIdx> <usdcWhole>
//   # e.g.  npx tsx scripts/shrink-milestone.mts 0x5aa61c... 0 1
import { prisma } from "../src/lib/db.js";

const [intentId, idxStr, usdcStr] = process.argv.slice(2);
if (!intentId || !idxStr || !usdcStr) {
  console.error("usage: shrink-milestone.mts <intentId> <idx> <usdcWhole>");
  process.exit(1);
}
const idx = Number(idxStr);
const usdcUnits = BigInt(Math.round(Number(usdcStr) * 1_000_000));

const before = await prisma.milestone.findUnique({
  where: { intentId_idx: { intentId, idx } },
  select: { releaseAmountUsdc: true, status: true, title: true },
});
if (!before) {
  console.error(`no milestone idx=${idx} for intent ${intentId}`);
  process.exit(1);
}
console.log(`before: M${idx} "${before.title.slice(0, 40)}" status=${before.status} releases=${(Number(before.releaseAmountUsdc) / 1e6).toLocaleString()} USDC`);

await prisma.milestone.update({
  where: { intentId_idx: { intentId, idx } },
  data: { releaseAmountUsdc: usdcUnits },
});
console.log(`after:  M${idx} releases=${usdcStr} USDC`);
await prisma.$disconnect();
