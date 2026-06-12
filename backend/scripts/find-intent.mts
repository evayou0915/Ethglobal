import { prisma } from "../src/lib/db.js";

const intentId = "0x5aa61cdef33543dd7129e2b97a1aa0bb505c4a9fd0628a7d3d86e9e5a6f438c4";
const intent = await prisma.intent.findUnique({
  where: { intentId },
  select: { intentId: true, ticker: true, title: true, status: true, scientistWallet: true },
});
console.log("intent in DB:", intent ?? "(not found)");

const all = await prisma.intent.findMany({ select: { intentId: true, ticker: true, title: true } });
console.log(`\nall ${all.length} intents:`);
for (const i of all) console.log(`  ${i.intentId}  ${i.ticker}  ${i.title.slice(0, 40)}`);

await prisma.$disconnect();
