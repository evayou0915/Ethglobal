import { prisma } from "../src/lib/db.js";
const INTENT_ID = "0x5aa61cdef33543dd7129e2b97a1aa0bb505c4a9fd0628a7d3d86e9e5a6f438c4";
const r = await prisma.milestone.update({
  where: { intentId_idx: { intentId: INTENT_ID, idx: 0 } },
  data: { status: "in_progress", aiScore: null, aiRationale: null },
});
console.log("reverted M0 →", r.status);
await prisma.$disconnect();
