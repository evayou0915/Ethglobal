// Simulate the release call the frontend is about to broadcast — without
// spending gas. Surfaces the actual contract revert reason that MetaMask
// is hiding behind "this tx may fail".
import { keccak256, toBytes } from "viem";
import { publicClient } from "../src/lib/chain.js";
import { AURASCI_ESCROW_ABI } from "../src/lib/escrow-abi.js";
import { ENV } from "../src/lib/env.js";
import { prisma } from "../src/lib/db.js";

const INTENT_ID = "0x5aa61cdef33543dd7129e2b97a1aa0bb505c4a9fd0628a7d3d86e9e5a6f438c4";
const IDX = 0;

const milestone = await prisma.milestone.findUnique({
  where: { intentId_idx: { intentId: INTENT_ID, idx: IDX } },
  include: { intent: { select: { scientistWallet: true } } },
});
if (!milestone) throw new Error("milestone not found");

const to = milestone.intent.scientistWallet as `0x${string}`;
const amount = milestone.releaseAmountUsdc;
const nonce = (milestone.releaseNonce ?? "0x" + "0".repeat(64)) as `0x${string}`;
const sig = (milestone.releaseSignature ?? "0x") as `0x${string}`;
const reason = keccak256(toBytes(`milestone-${IDX}`));

console.log("─── args we'd pass to escrow.release ─────────────────────");
console.log("intentId :", INTENT_ID);
console.log("to       :", to);
console.log("amount   :", Number(amount) / 1e6, "USDC");
console.log("nonce    :", nonce);
console.log("reason   :", reason);
console.log("sig      :", sig.slice(0, 20) + "…" + sig.slice(-10), "len=" + (sig.length / 2 - 1));
console.log();

// On-chain balance + nonce reuse check
const onchainBalance = await publicClient.readContract({
  address: ENV.ESCROW_ADDRESS as `0x${string}`, abi: AURASCI_ESCROW_ABI,
  functionName: "balanceOf", args: [INTENT_ID as `0x${string}`],
});
const nonceUsed = await publicClient.readContract({
  address: ENV.ESCROW_ADDRESS as `0x${string}`, abi: AURASCI_ESCROW_ABI,
  functionName: "usedNonce", args: [nonce],
});
console.log("on-chain balanceOf:", Number(onchainBalance) / 1e6, "USDC");
console.log("on-chain nonceUsed:", nonceUsed);
console.log();

try {
  await publicClient.simulateContract({
    address: ENV.ESCROW_ADDRESS as `0x${string}`,
    abi: AURASCI_ESCROW_ABI,
    functionName: "release",
    args: [INTENT_ID as `0x${string}`, to, amount, nonce, reason, sig],
    account: to,                     // simulate from the scientist wallet
  });
  console.log("✓ simulation passed — release should succeed when broadcast");
} catch (e: any) {
  console.log("✗ revert reason:", e.shortMessage ?? e.message ?? e);
  if (e.cause) console.log("  cause:", e.cause.shortMessage ?? e.cause.message);
}
await prisma.$disconnect();
