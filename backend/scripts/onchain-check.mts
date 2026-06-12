// Sanity-check the deployed escrow on-chain:
//  - is there code at ESCROW_ADDRESS?
//  - what's its USDC balance? (should equal sum of all successful deposits)
//  - any Deposited events in the recent ~5000 blocks?
import { publicClient, ESCROW_ADDRESS } from "../src/lib/chain.js";
import { AURASCI_ESCROW_ABI } from "../src/lib/escrow-abi.js";
import { ENV } from "../src/lib/env.js";

const tip = await publicClient.getBlockNumber();
const code = await publicClient.getBytecode({ address: ESCROW_ADDRESS as `0x${string}` });

const usdcBal = await publicClient.readContract({
  address: ENV.USDC_ADDRESS as `0x${string}`,
  abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const,
  functionName: "balanceOf",
  args: [ENV.ESCROW_ADDRESS as `0x${string}`],
});

console.log("escrow address:", ESCROW_ADDRESS);
console.log("code at addr:  ", code && code.length > 2 ? `${code.slice(0, 10)}… (${(code.length - 2) / 2} bytes)` : "NONE — empty address!");
console.log("USDC held:     ", Number(usdcBal) / 1e6, "USDC");
console.log("chain tip:     ", Number(tip));

const events = await publicClient.getContractEvents({
  address: ESCROW_ADDRESS as `0x${string}`,
  abi: AURASCI_ESCROW_ABI,
  eventName: "Deposited",
  fromBlock: tip - 1_500n,
  toBlock: tip,
});
console.log("Deposited events (last 5000 blocks):", events.length);
for (const e of events) {
  console.log("  ", (e as any).args, "tx:", e.transactionHash);
}
