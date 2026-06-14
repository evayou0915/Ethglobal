// Prove the Privy server wallet signs an EIP-712 Release that recovers to
// the wallet address (i.e. the escrow's ECDSA check will pass once deployed
// with signer = this wallet), and that the policy permits the signature.
import { recoverTypedDataAddress, getAddress } from "viem";
import { signRelease, ESCROW_DOMAIN, RELEASE_TYPES } from "../src/lib/eip712.js";

const intentId = ("0x" + "ab".repeat(32)) as `0x${string}`;
const to = ("0x" + "11".repeat(20)) as `0x${string}`;
const amount = 1_000_000n;
const nonce = ("0x" + "cd".repeat(32)) as `0x${string}`;

console.log("RELEASE_SIGNER =", process.env.RELEASE_SIGNER, "| signing via Privy server wallet…");
const { signature, signer } = await signRelease({ intentId, to, amount, nonce });
const recovered = await recoverTypedDataAddress({
  domain: ESCROW_DOMAIN,
  types: RELEASE_TYPES,
  primaryType: "Release",
  message: { intentId, to: getAddress(to), amount, nonce },
  signature: signature as `0x${string}`,
});
const wallet = "0xA7084d5e27043F4126C161c8a31eF6D0efDca5Cd";
console.log("signer (reported):", signer);
console.log("recovered from sig:", recovered);
const ok = recovered.toLowerCase() === wallet.toLowerCase() && signer.toLowerCase() === wallet.toLowerCase();
console.log(ok
  ? "★ Privy server wallet signs valid EIP-712 releases (recovers to the wallet). Policy allowed it."
  : "✗ mismatch — recovered != Privy wallet");
process.exit(ok ? 0 : 1);
