import { publicClient, ESCROW_ADDRESS } from "../src/lib/chain.js";
import { AURASCI_ESCROW_ABI } from "../src/lib/escrow-abi.js";

const tip = await publicClient.getBlockNumber();
console.log("tip:", tip);

// Walk back in 1500-block chunks until we find Deposited events
let found = 0;
let from = tip - 1499n;
let to = tip;
for (let i = 0; i < 5 && found === 0; i++) {
  const events = await publicClient.getContractEvents({
    address: ESCROW_ADDRESS as `0x${string}`,
    abi: AURASCI_ESCROW_ABI,
    eventName: "Deposited",
    fromBlock: from,
    toBlock: to,
  });
  console.log(`scanned blocks ${from}..${to}: ${events.length} Deposited events`);
  for (const e of events) {
    console.log("  block:", (e as any).blockNumber, "tx:", (e as any).transactionHash);
    console.log("  args :", (e as any).args);
  }
  found += events.length;
  to = from - 1n;
  from = from - 1500n;
}
