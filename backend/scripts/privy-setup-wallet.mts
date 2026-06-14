// One-time: create an app-controlled Privy server wallet that the AI
// verifier uses to sign milestone-release authorizations, governed by a
// policy. Prints the ids to put in env. Requires PRIVY_APP_ID/SECRET.
import { PrivyClient } from "@privy-io/server-auth";

const privy = new PrivyClient(process.env.PRIVY_APP_ID!, process.env.PRIVY_APP_SECRET!);

const policy = await privy.walletApi.createPolicy({
  name: "AuraSci verifier signer",
  version: "1.0",
  chainType: "ethereum",
  rules: [
    // The agent wallet may ONLY sign EIP-712 typed data on Base Sepolia
    // (our escrow's chain). Everything else — sending transactions,
    // signing other chains' data, exporting the key — is denied by the
    // allowlist. This is the policy-engine restriction.
    {
      name: "only sign Base Sepolia release/refund typed-data",
      action: "ALLOW",
      method: "eth_signTypedData_v4",
      conditions: [
        { fieldSource: "ethereum_typed_data_domain", field: "chain_id", operator: "eq", value: "84532" },
      ],
    },
  ],
} as any);

const wallet = await privy.walletApi.create({ chainType: "ethereum", policyIds: [policy.id] } as any);

console.log(JSON.stringify({
  PRIVY_POLICY_ID: policy.id,
  PRIVY_WALLET_ID: wallet.id,
  PRIVY_WALLET_ADDRESS: wallet.address,
}, null, 2));
