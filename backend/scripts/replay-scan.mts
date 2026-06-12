// Reproduce the exact getContractEvents call the indexer makes, to see if
// the events are being returned and what eventName they have.
import { publicClient, ESCROW_ADDRESS } from "../src/lib/chain.js";
import { AURASCI_ESCROW_ABI } from "../src/lib/escrow-abi.js";

const fromBlock = 42_092_158n;   // covers the known deposit at 42092925
const toBlock   = 42_093_157n;

const logs = await publicClient.getContractEvents({
  address: ESCROW_ADDRESS as `0x${string}`,
  abi: AURASCI_ESCROW_ABI,
  fromBlock,
  toBlock,
});

console.log(`scanned ${fromBlock}..${toBlock}: ${logs.length} events`);
for (const l of logs as any[]) {
  console.log(`  block=${l.blockNumber} eventName=${l.eventName} args=${JSON.stringify(l.args, (_, v) => typeof v === "bigint" ? v.toString() : v)}`);
}
