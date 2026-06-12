import { prisma } from "../src/lib/db.js";
import { publicClient, ESCROW_ADDRESS } from "../src/lib/chain.js";

const cp = await prisma.indexerCheckpoint.findUnique({ where: { id: 1 } });
const p  = await prisma.patronage.count();
const a  = await prisma.activityLog.count();
const tip = await publicClient.getBlockNumber();

console.log("escrow:    ", ESCROW_ADDRESS);
console.log("chain tip: ", Number(tip));
console.log("checkpoint:", cp ? Number(cp.lastBlock) : "(none)");
console.log("lag:       ", cp ? Number(tip - cp.lastBlock) : "n/a", "blocks");
console.log("patronages:", p);
console.log("activity:  ", a);
await prisma.$disconnect();
