// Reset the indexer checkpoint to (current chain tip - 100), so it picks up
// recent on-chain activity instead of trying to back-fill from genesis.
// Run AFTER the contract is deployed and you've made a fresh transaction.
import { prisma } from "../src/lib/db.js";
import { publicClient } from "../src/lib/chain.js";

const lookback = BigInt(process.env.LOOKBACK ?? 100);
const tip = await publicClient.getBlockNumber();
const target = tip > lookback ? tip - lookback : 0n;
const cp = await prisma.indexerCheckpoint.upsert({
  where: { id: 1 },
  update: { lastBlock: target },
  create: { id: 1, lastBlock: target },
});
console.log(`✓ checkpoint reset → block ${cp.lastBlock} (tip ${tip})`);
console.log("Restart the indexer so it picks up the new checkpoint.");
await prisma.$disconnect();
