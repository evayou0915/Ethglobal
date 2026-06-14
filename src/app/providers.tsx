"use client";

import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiProvider, createConfig as createPrivyConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { ToastProvider } from "@/components/Toast";
import { PrivyTokenBridge } from "@/components/PrivyTokenBridge";
import { wagmiConfig, ACTIVE_CHAIN } from "@/wagmi/config";

// Public Privy app id. Empty → Privy disabled, the app runs SIWE-only
// (current production behavior). Set it to enable email/Google/X login.
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

function useQ() {
  return useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
      }),
  )[0];
}

/** SIWE-only tree — plain wagmi with the injected connector. */
function PlainTree({ children }: { children: ReactNode }) {
  const queryClient = useQ();
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

/** Privy tree — adds email/Google/X login + embedded wallets, while the
 *  wallet button keeps using our own SIWE → self-issued-JWT flow. wagmi
 *  connectors are managed by Privy here (via @privy-io/wagmi). */
function PrivyTree({ children }: { children: ReactNode }) {
  const queryClient = useQ();
  const [privyWagmi] = useState(() =>
    createPrivyConfig({
      chains: [ACTIVE_CHAIN] as [typeof ACTIVE_CHAIN],
      transports: {
        [base.id]:        http(process.env.NEXT_PUBLIC_BASE_RPC_URL         ?? "https://mainnet.base.org"),
        [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org"),
      },
    }),
  );
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "google", "twitter", "wallet"],
        appearance: { theme: "light", accentColor: "#c2410c" },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: ACTIVE_CHAIN,
        supportedChains: [ACTIVE_CHAIN],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <PrivyWagmiProvider config={privyWagmi}>
          <PrivyTokenBridge />
          <ToastProvider>{children}</ToastProvider>
        </PrivyWagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return PRIVY_APP_ID ? <PrivyTree>{children}</PrivyTree> : <PlainTree>{children}</PlainTree>;
}
