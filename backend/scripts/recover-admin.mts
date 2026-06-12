/**
 * Recovery helper for stuck admin states. Lets you either:
 *   - ACTION=accept  → call acceptAdmin (msg.sender must equal pendingAdmin)
 *   - ACTION=cancel  → call cancelAdminTransfer (msg.sender must equal admin
 *                       OR pendingAdmin)
 *
 * Usage:
 *   PK=0x<your private key> ACTION=accept npx tsx scripts/recover-admin.mts
 *   PK=0x<your private key> ACTION=cancel npx tsx scripts/recover-admin.mts
 */
import { createWalletClient, http, type Address, type Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, publicClient } from "../src/lib/chain.js";
import { AURASCI_ESCROW_ABI } from "../src/lib/escrow-abi.js";
import { ENV } from "../src/lib/env.js";

const PK = process.env.PK as `0x${string}` | undefined;
const ACTION = (process.env.ACTION ?? "").toLowerCase();
if (!PK || !/^0x[0-9a-fA-F]{64}$/.test(PK)) throw new Error("PK env (0x… private key) required");
if (ACTION !== "accept" && ACTION !== "cancel") {
  throw new Error("ACTION env must be 'accept' or 'cancel'");
}

const ABI: Abi = [
  ...AURASCI_ESCROW_ABI as unknown as Abi,
  { type: "error", name: "NotAdmin", inputs: [{ name: "caller", type: "address" }] },
  { type: "error", name: "NotPendingAdmin", inputs: [{ name: "caller", type: "address" }] },
  { type: "error", name: "ZeroAddress", inputs: [] },
];

const account = privateKeyToAccount(PK);
const walletClient = createWalletClient({ account, chain, transport: http() });
const ESCROW = ENV.ESCROW_ADDRESS as Address;

const admin   = (await publicClient.readContract({ address: ESCROW, abi: ABI, functionName: "admin"        })) as Address;
const pending = (await publicClient.readContract({ address: ESCROW, abi: ABI, functionName: "pendingAdmin" })) as Address;

console.log("─ on-chain state ─────────────────────────");
console.log("admin        :", admin);
console.log("pendingAdmin :", pending);
console.log("your address :", account.address);
console.log();

if (pending === "0x0000000000000000000000000000000000000000") {
  console.log("nothing to do — pendingAdmin is already zero");
  process.exit(0);
}

const fn = ACTION === "accept" ? "acceptAdmin" : "cancelAdminTransfer";
console.log(`calling ${fn}() as ${account.address}…`);

const hash = await walletClient.writeContract({
  address: ESCROW, abi: ABI, functionName: fn, args: [],
});
console.log("→ tx submitted:", hash);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") {
  console.error(`✗ tx reverted on-chain (status=${receipt.status})`);
  process.exit(1);
}
console.log("✓ mined in block", receipt.blockNumber);

const newAdmin   = (await publicClient.readContract({ address: ESCROW, abi: ABI, functionName: "admin"        })) as Address;
const newPending = (await publicClient.readContract({ address: ESCROW, abi: ABI, functionName: "pendingAdmin" })) as Address;
console.log();
console.log("─ after ──────────────────────────────────");
console.log("admin        :", newAdmin);
console.log("pendingAdmin :", newPending);
