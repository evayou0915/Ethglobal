"use client";

/** Chain constants + the wagmi config. Connectors are plain wagmi now —
 *  the injected (browser-extension) wallet is the only login method. */
import { http, createConfig } from "wagmi";
import { base, baseSepolia, type Chain } from "wagmi/chains";
import { injected } from "wagmi/connectors";

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 84532);
export const ACTIVE_CHAIN: Chain = CHAIN_ID === 8453 ? base : baseSepolia;

// Only ACTIVE_CHAIN is registered in `chains`, which prevents wagmi from
// honoring reads/writes against the other network if a user's wallet
// drifts there. Both transports are declared because wagmi's
// `createConfig` requires the transports map to cover the full chain
// union, even though only the active one is used.
export const wagmiConfig = createConfig({
  chains: [ACTIVE_CHAIN] as [typeof ACTIVE_CHAIN],
  connectors: [injected()],
  transports: {
    [base.id]:        http(process.env.NEXT_PUBLIC_BASE_RPC_URL         ?? "https://mainnet.base.org"),
    [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org"),
  },
});

export const ESCROW_ADDRESS =
  (process.env.NEXT_PUBLIC_ESCROW_ADDRESS as `0x${string}` | undefined) ??
  ("0x0000000000000000000000000000000000000000" as const);

export const USDC_ADDRESS =
  (process.env.NEXT_PUBLIC_USDC_ADDRESS as `0x${string}` | undefined) ??
  ("0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const);

export const EXPLORER_BASE =
  CHAIN_ID === 8453 ? "https://basescan.org" : "https://sepolia.basescan.org";

export const txUrl   = (hash: string) => `${EXPLORER_BASE}/tx/${hash}`;
export const addrUrl = (addr: string) => `${EXPLORER_BASE}/address/${addr}`;
