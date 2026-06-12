/**
 * One-off CLI for the admin escape hatch: call `adminWithdraw(intentId, amount, to, reason)`
 * on the deployed AuraSciEscrow. Signs with ADMIN_PRIVATE_KEY (set in your shell env
 * for this run — do NOT commit it).
 *
 * Usage:
 *   ADMIN_PRIVATE_KEY=0x... npx tsx scripts/admin-withdraw.mts \
 *       --intent 0x5aa61c... --amount 2 --to 0xRECIPIENT [--reason "ops-recovery"]
 *
 * `amount` is in human USDC (e.g. 2 = 2 USDC; converted to 6-decimal units internally).
 */
import { createWalletClient, http, keccak256, parseUnits, toBytes, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ENV } from "../src/lib/env.js";
import { chain, publicClient } from "../src/lib/chain.js";
import { AURASCI_ESCROW_ABI } from "../src/lib/escrow-abi.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const intentId = arg("--intent");
const amountStr = arg("--amount");
const to = arg("--to") as Address | undefined;
const reasonStr = arg("--reason") ?? "admin-withdraw";

if (!intentId || !/^0x[0-9a-fA-F]{64}$/.test(intentId)) {
  throw new Error("--intent <0x...32bytes> required");
}
if (!amountStr || !/^\d+(\.\d+)?$/.test(amountStr)) {
  throw new Error("--amount <human-usdc, e.g. 2 or 0.5> required");
}
if (!to || !/^0x[0-9a-fA-F]{40}$/.test(to)) {
  throw new Error("--to <0x...recipient> required");
}

const adminKey = process.env.ADMIN_PRIVATE_KEY;
if (!adminKey || !/^0x[0-9a-fA-F]{64}$/.test(adminKey)) {
  throw new Error("ADMIN_PRIVATE_KEY env var (the admin wallet's private key) required");
}

const account = privateKeyToAccount(adminKey as `0x${string}`);
const escrowAddr = ENV.ESCROW_ADDRESS as Address;
const amountWei = parseUnits(amountStr, 6);
const reason = keccak256(toBytes(reasonStr));

console.log("─ admin-withdraw ──────────────────────────────────");
console.log("escrow:   ", escrowAddr);
console.log("admin:    ", account.address);
console.log("intent:   ", intentId);
console.log("amount:   ", amountStr, "USDC  (=", amountWei.toString(), "wei)");
console.log("to:       ", to);
console.log("reason:   ", reasonStr, "→", reason);
console.log();

// Sanity: confirm caller is the on-chain admin and there's enough balance.
const onchainAdmin = await publicClient.readContract({
  address: escrowAddr, abi: AURASCI_ESCROW_ABI, functionName: "admin",
});
console.log("on-chain admin =", onchainAdmin);
if ((onchainAdmin as string).toLowerCase() !== account.address.toLowerCase()) {
  throw new Error(`signer (${account.address}) is not the current admin (${onchainAdmin})`);
}
const bal = await publicClient.readContract({
  address: escrowAddr, abi: AURASCI_ESCROW_ABI, functionName: "balanceOf", args: [intentId as `0x${string}`],
});
console.log("intent balance =", Number(bal) / 1e6, "USDC");
if ((bal as bigint) < amountWei) {
  throw new Error(`balance ${bal} < requested ${amountWei}`);
}

const walletClient = createWalletClient({ account, chain, transport: http() });
const hash = await walletClient.writeContract({
  address: escrowAddr,
  abi: AURASCI_ESCROW_ABI,
  functionName: "adminWithdraw",
  args: [intentId as `0x${string}`, amountWei, to, reason],
});
console.log("→ tx submitted:", hash);
const rcpt = await publicClient.waitForTransactionReceipt({ hash });
console.log("✓ mined in block", rcpt.blockNumber, "gas used", rcpt.gasUsed.toString());
