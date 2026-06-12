// Force one milestone into the 'rejected' state so the patron-side Refund
// card lights up on the intent detail page. Used purely to demonstrate /
// test the refund path on testnet.
import { prisma } from "../src/lib/db.js";

const INTENT_ID = process.env.INTENT_ID
  ?? "0x5aa61cdef33543dd7129e2b97a1aa0bb505c4a9fd0628a7d3d86e9e5a6f438c4";
const IDX = Number(process.env.IDX ?? 0);

const before = await prisma.milestone.findUnique({
  where: { intentId_idx: { intentId: INTENT_ID, idx: IDX } },
});
if (!before) {
  console.error(`no milestone idx=${IDX} for intent ${INTENT_ID}`);
  process.exit(1);
}

await prisma.milestone.update({
  where: { intentId_idx: { intentId: INTENT_ID, idx: IDX } },
  data: {
    status: "rejected",
    aiScore: 45,
    aiRationale: "Manually marked rejected via scripts/force-rejected.mts to enable patron refund.",
  },
});

console.log(`✓ milestone idx=${IDX} of ${INTENT_ID}: ${before.status} → rejected`);
console.log("Now refresh /intent/" + INTENT_ID + " in the browser — the red Refund card should appear.");
await prisma.$disconnect();
