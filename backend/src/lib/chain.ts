import { createPublicClient, createWalletClient, http, fallback } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { ENV } from "./env.js";

export const chain = ENV.CHAIN_ID === 8453 ? base : baseSepolia;

const rpcUrl = ENV.CHAIN_ID === 8453 ? ENV.BASE_RPC_URL : ENV.BASE_SEPOLIA_RPC_URL;

export const publicClient = createPublicClient({
  chain,
  transport: fallback([http(rpcUrl), http()]),
});

/** Build a wallet client from SIGNER_PRIVATE_KEY. Throws if the env is unset
 *  — only call from code paths that need to sign (release / refund). */
export function getSignerWalletClient() {
  if (!ENV.SIGNER_PRIVATE_KEY) {
    throw new Error("SIGNER_PRIVATE_KEY is not set");
  }
  const account = privateKeyToAccount(ENV.SIGNER_PRIVATE_KEY as `0x${string}`);
  return {
    account,
    client: createWalletClient({ account, chain, transport: http(rpcUrl) }),
  };
}

export const ESCROW_ADDRESS = ENV.ESCROW_ADDRESS;
export const USDC_ADDRESS   = ENV.USDC_ADDRESS;
