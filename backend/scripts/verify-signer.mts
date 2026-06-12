// Confirm that the deployed contract's `signer` matches what the backend
// will produce signatures with (i.e. SIGNER_PRIVATE_KEY → pubkey).
import { privateKeyToAccount } from "viem/accounts";
import { publicClient } from "../src/lib/chain.js";
import { ENV } from "../src/lib/env.js";
import { AURASCI_ESCROW_ABI } from "../src/lib/escrow-abi.js";

const onchain = await publicClient.readContract({
  address: ENV.ESCROW_ADDRESS as `0x${string}`,
  abi: [
    { type: "function", name: "signer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  ] as const,
  functionName: "signer",
});

const backendPubkey = privateKeyToAccount(ENV.SIGNER_PRIVATE_KEY as `0x${string}`).address;

console.log("escrow.signer (immutable on-chain) :", onchain);
console.log("backend SIGNER_PRIVATE_KEY pubkey  :", backendPubkey);
console.log();
if ((onchain as string).toLowerCase() === backendPubkey.toLowerCase()) {
  console.log("✓ MATCH — release/refund signatures will verify");
} else {
  console.log("✗ MISMATCH — every release/refund tx will revert with InvalidSignature");
  console.log("Fix: redeploy contract with SIGNER_ADDRESS=" + backendPubkey);
  console.log("     OR change backend SIGNER_PRIVATE_KEY to one that derives to " + onchain);
}
