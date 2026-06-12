import { publicClient, ESCROW_ADDRESS } from "../src/lib/chain.js";
import { ENV } from "../src/lib/env.js";

const WALLET = "0xDD9d7f1cF8b60099a59598DFB1a2ad51375dFd6a" as `0x${string}`;
const usdc = ENV.USDC_ADDRESS as `0x${string}`;
const escrow = ENV.ESCROW_ADDRESS as `0x${string}`;

const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals",  stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

const [bal, allowance, dec, ethBal] = await Promise.all([
  publicClient.readContract({ address: usdc, abi: ERC20, functionName: "balanceOf", args: [WALLET] }),
  publicClient.readContract({ address: usdc, abi: ERC20, functionName: "allowance", args: [WALLET, escrow] }),
  publicClient.readContract({ address: usdc, abi: ERC20, functionName: "decimals" }),
  publicClient.getBalance({ address: WALLET }),
]);

console.log("wallet:    ", WALLET);
console.log("ETH bal:   ", Number(ethBal) / 1e18, "ETH (for gas)");
console.log("USDC bal:  ", Number(bal) / 10 ** Number(dec), "USDC");
console.log("allowance to escrow:", Number(allowance) / 10 ** Number(dec), "USDC");
