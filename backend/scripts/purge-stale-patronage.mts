// Wipe Patronage / Release / RefundRecord / ActivityLog rows whose txHash
// belongs to a stale (now-decommissioned) escrow contract. Also resets every
// Intent.totalRaisedUsdc / totalReleasedUsdc to match what the indexer would
// see on the *current* escrow.
//
// Use this once after redeploying the AuraSciEscrow contract — otherwise
// the DB carries phantom balances from the previous deployment that don't
// exist on the new contract.
//
// Pass dry-run via DRY=1 to only print what would change.
import { prisma } from "../src/lib/db.js";

const DRY = process.env.DRY === "1";

const patronageCount = await prisma.patronage.count();
const releaseCount   = await prisma.release.count();
const refundCount    = await prisma.refundRecord.count();
const activityCount  = await prisma.activityLog.count();
const signedNonces   = await prisma.signedNonce.count();

console.log("─── BEFORE ─────────────────────────");
console.log("Patronage rows    :", patronageCount);
console.log("Release rows      :", releaseCount);
console.log("RefundRecord rows :", refundCount);
console.log("ActivityLog rows  :", activityCount);
console.log("SignedNonce rows  :", signedNonces);
const totals = await prisma.intent.findMany({
  select: { intentId: true, ticker: true, totalRaisedUsdc: true, totalReleasedUsdc: true },
});
for (const t of totals) {
  console.log(`  ${t.ticker}: raised=${Number(t.totalRaisedUsdc) / 1e6} released=${Number(t.totalReleasedUsdc) / 1e6}`);
}

if (DRY) {
  console.log("\nDRY=1 → no writes. Re-run without DRY to apply.");
  await prisma.$disconnect();
  process.exit(0);
}

// Reset milestone-level cached signatures so cached EIP-712 sigs (which were
// for the old contract's verifyingContract domain) don't get re-broadcast.
const ms = await prisma.milestone.updateMany({
  where: { OR: [{ status: "ai_verifying" }, { releaseSignature: { not: null } }] },
  data: { releaseSignature: null, releaseNonce: null, status: "in_progress" },
});

await prisma.$transaction([
  prisma.activityLog.deleteMany({}),
  prisma.release.deleteMany({}),
  prisma.refundRecord.deleteMany({}),
  prisma.patronage.deleteMany({}),
  prisma.signedNonce.deleteMany({}),
  prisma.intent.updateMany({
    data: { totalRaisedUsdc: 0n, totalReleasedUsdc: 0n },
  }),
]);

console.log("\n✓ purged stale event-mirror rows + reset intent totals");
console.log(`  also reset ${ms.count} milestone(s) cached releaseSignature/releaseNonce`);
console.log("Restart the indexer afterwards (pm2 restart aurasci-indexer) so it");
console.log("re-checkpoints near current tip and doesn't try to back-fill.");
await prisma.$disconnect();
