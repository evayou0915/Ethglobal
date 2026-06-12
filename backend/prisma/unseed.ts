/* Delete the demo seed data ($CELL-01 / $NEUR-01 / $GENE-01 + Dr. Demo
 * Scientist). Run with: `npx tsx prisma/unseed.ts` from backend/. Idempotent
 * — safe to run multiple times. */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_WALLET = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const DEMO_TICKERS = ["$CELL-01", "$NEUR-01", "$GENE-01"];

async function main() {
  // Find the demo intents by ticker so we don't rely on the
  // intentIdOf("cell01") encoding.
  const demos = await prisma.intent.findMany({
    where: { ticker: { in: DEMO_TICKERS } },
    select: { intentId: true, ticker: true },
  });
  if (demos.length === 0) {
    console.log("[unseed] no demo intents found — nothing to delete");
  } else {
    console.log(`[unseed] deleting ${demos.length} demo intent(s):`, demos.map((d) => d.ticker).join(", "));
    const ids = demos.map((d) => d.intentId);

    // Order matters because of FKs. Cascade where supported, manual otherwise.
    await prisma.aiJob.deleteMany({       where: { intentId: { in: ids } } });
    await prisma.patronage.deleteMany({   where: { intentId: { in: ids } } });
    await prisma.refundRecord.deleteMany({ where: { intentId: { in: ids } } });
    await prisma.activityLog.deleteMany({ where: { intentId: { in: ids } } });
    await prisma.auraSpend.deleteMany({   where: { intentId: { in: ids } } });
    await prisma.auraYield.deleteMany({   where: { intentId: { in: ids } } });
    await prisma.milestone.deleteMany({   where: { intentId: { in: ids } } });
    await prisma.intent.deleteMany({      where: { intentId: { in: ids } } });
    console.log("[unseed] demo intents removed");
  }

  // Demo scientist + user row.
  const sci = await prisma.scientist.findUnique({ where: { wallet: DEMO_WALLET } });
  if (sci) {
    await prisma.scientist.delete({ where: { wallet: DEMO_WALLET } });
    console.log(`[unseed] deleted Scientist ${DEMO_WALLET} (${sci.displayName})`);
  }
  const user = await prisma.user.findUnique({ where: { wallet: DEMO_WALLET } });
  if (user) {
    await prisma.user.delete({ where: { wallet: DEMO_WALLET } });
    console.log(`[unseed] deleted User ${DEMO_WALLET}`);
  }

  console.log("[unseed] done");
}

main()
  .catch((e) => { console.error("[unseed] failed:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
