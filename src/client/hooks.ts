"use client";

import { useCallback } from "react";
import { useAccount, useConfig, useConnect, useDisconnect, usePublicClient, useSwitchChain } from "wagmi";
import { getAccount, getWalletClient, signMessage } from "@wagmi/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keccak256, parseUnits, toBytes } from "viem";
import { createSiweMessage } from "viem/siwe";
import type { Config, Connector } from "@wagmi/core";
import { api, auth } from "./api";
import { useAuth, useAuthStore } from "./auth";
import { privyToken } from "./privy-token";
import { ACTIVE_CHAIN, ESCROW_ADDRESS, USDC_ADDRESS, txUrl } from "@/wagmi/config";
import { AURASCI_ESCROW_ABI, ERC20_ABI } from "@/wagmi/abi";
import type { IntentDto, IntentListResponse } from "@/types/api";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const tryGetWalletClient = (config: Config) =>
  getWalletClient(config, { chainId: ACTIVE_CHAIN.id }).catch(() => null);

/** Pick the injected (browser-extension) connector from the configured
 *  list. There's only one configured in src/wagmi/config.ts, but be
 *  defensive about ordering. */
function pickInjected(connectors: readonly Connector[]): Connector | undefined {
  return connectors.find((c) => c.id === "injected") ?? connectors[0];
}

/** Hook returning a function that — when called — makes sure the wagmi
 *  walletClient is usable on ACTIVE_CHAIN. Used inside Fund/Claim/Refund
 *  mutations so the MetaMask permission popup only appears when the user
 *  actually clicks a transaction button (never on page reload). */
function useEnsureWalletReady() {
  const config = useConfig();
  const { connectAsync, connectors } = useConnect();
  const qc = useQueryClient();

  return useCallback(async () => {
    // The DB-pinned wallet (returned by /me) is the ONLY address every
    // downstream check (intent ownership, scientistWallet payout, refund
    // patron) will accept. Refuse to sign from anything else, instead of
    // discovering the mismatch as an on-chain revert.
    const me = qc.getQueryData<{ wallet: string | null } | undefined>(["me"]);
    const pinned = me?.wallet?.toLowerCase();
    if (!pinned) {
      throw new Error("Session not ready — please refresh and try again.");
    }

    const matchesPinned = (wc: { account: { address: string } } | null) =>
      !!wc && wc.account.address.toLowerCase() === pinned;

    // Already connected on the right account? Done.
    if (matchesPinned(await tryGetWalletClient(config))) return;

    // Wallet not attached to wagmi in this session (typical after a page
    // reload — extensions can't be silently reattached). Reconnect now;
    // this is when the wallet's permission popup appears, expected since
    // the user just clicked a transaction button.
    if (!getAccount(config).isConnected) {
      const connector = pickInjected(connectors);
      if (!connector) throw new Error("No browser wallet found — install MetaMask or Rabby and retry.");
      await connectAsync({ connector, chainId: ACTIVE_CHAIN.id }).catch(() => {
        /* surface as the mismatch error below */
      });
      for (let i = 0; i < 20; i++) {
        if (matchesPinned(await tryGetWalletClient(config))) return;
        await sleep(500);
      }
    }

    // Last resort: tell the user exactly which address they need so they
    // can switch accounts (MetaMask account dropdown) and retry.
    const wc = await tryGetWalletClient(config);
    const current = wc ? wc.account.address.toLowerCase() : "(none)";
    throw new Error(
      `Signer is ${current.slice(0, 6)}…${current.slice(-4)} but your registered ` +
      `wallet is ${pinned.slice(0, 6)}…${pinned.slice(-4)}. ` +
      `Switch to that account in your wallet and try again.`,
    );
  }, [config, connectAsync, connectors, qc]);
}

// ─── Session ────────────────────────────────────────────────────────────

export function useSession() {
  const { authenticated } = useAuth();
  return useQuery({ queryKey: ["me"], queryFn: api.me, enabled: authenticated });
}

/** SIWE login: connect the injected wallet (if needed), sign a
 *  Sign-In-With-Ethereum message carrying a server nonce, exchange it for
 *  a session JWT, and persist the token. */
export function useSiweLogin() {
  const config = useConfig();
  const { connectAsync, connectors } = useConnect();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // 1. Make sure a browser wallet is connected.
      let address = getAccount(config).address;
      if (!address) {
        const connector = pickInjected(connectors);
        if (!connector) throw new Error("No browser wallet found — install MetaMask or Rabby first.");
        const res = await connectAsync({ connector, chainId: ACTIVE_CHAIN.id });
        address = res.accounts[0];
      }
      if (!address) throw new Error("Wallet connection failed.");

      // 2. Sign a SIWE message embedding a one-time server nonce.
      const { nonce } = await api.siweNonce();
      const message = createSiweMessage({
        address,
        chainId: ACTIVE_CHAIN.id,
        domain: window.location.host,
        uri: window.location.origin,
        nonce,
        version: "1",
        statement: "Sign in to AuraSci",
      });
      const signature = await signMessage(config, { message });

      // 3. Exchange for a session JWT; /me hydrates from the new token.
      const res = await api.siweVerify(message, signature);
      auth.set(res.token);
      qc.invalidateQueries({ queryKey: ["me"] });
      return res;
    },
  });
}

/** Drop the session JWT, disconnect the wallet, and ping the backend's
 *  (currently no-op) logout hook. */
export function useLogout() {
  const { disconnectAsync } = useDisconnect();
  const setPrivyAuthed = useAuthStore((s) => s.setPrivyAuthed);
  const qc = useQueryClient();
  return useCallback(async () => {
    try { await api.logout(); } catch { /* token already cleared in finally */ }
    auth.clear();
    // End the Privy session too (no-op when Privy disabled), so the user
    // doesn't get silently re-authed from a persisted Privy cookie.
    try { await privyToken.logout(); } catch { /* ignore */ }
    setPrivyAuthed(false);
    try { await disconnectAsync(); } catch { /* ignore */ }
    qc.removeQueries({ queryKey: ["me"] });
  }, [disconnectAsync, setPrivyAuthed, qc]);
}

// ─── Reads ──────────────────────────────────────────────────────────────

export function useIntents(params: Parameters<typeof api.listIntents>[0] = {}) {
  return useQuery<IntentListResponse>({
    queryKey: ["intents", params],
    queryFn: () => api.listIntents(params),
  });
}
export function useIntent(id: string | undefined) {
  return useQuery<IntentDto>({
    queryKey: ["intent", id],
    queryFn: () => api.getIntent(id!),
    enabled: Boolean(id),
  });
}
export function useActivity(params: Parameters<typeof api.activity>[0] = {}) {
  return useQuery({ queryKey: ["activity", params], queryFn: () => api.activity(params) });
}

// ─── Chain helpers ──────────────────────────────────────────────────────

export function useRequireChain() {
  // useAccount().chainId reflects the CONNECTOR's actual chain (what
  // MetaMask is really on), unlike useChainId() which only reports the
  // chain wagmi was configured with. Without this distinction,
  // requireChain() short-circuits and writeContract then fails with
  // "connector chain (1) does not match connection chain (84532)".
  const { chainId: connectorChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  return useCallback(async () => {
    if (connectorChainId !== ACTIVE_CHAIN.id) {
      await switchChainAsync({ chainId: ACTIVE_CHAIN.id });
    }
  }, [connectorChainId, switchChainAsync]);
}

// ─── Fund flow (USDC.approve → escrow.deposit) ──────────────────────────

export function useFund() {
  const publicClient = usePublicClient();
  const config = useConfig();
  const requireChain = useRequireChain();
  const ensureWalletReady = useEnsureWalletReady();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: { intentId: `0x${string}`; humanAmount: number }) => {
      if (ESCROW_ADDRESS === "0x0000000000000000000000000000000000000000") {
        throw new Error("Escrow address not configured (NEXT_PUBLIC_ESCROW_ADDRESS)");
      }
      // Lazy wallet bridge: after a page reload an external wallet is no
      // longer attached to wagmi — bridge it now (this is when MetaMask's
      // permission popup will appear, expected since the user just clicked
      // a transaction button).
      await ensureWalletReady();
      // Then make sure the wallet is on the configured chain (MetaMask
      // commonly starts on mainnet).
      await requireChain();
      const walletClient = await getWalletClient(config, { chainId: ACTIVE_CHAIN.id });
      if (!walletClient || !publicClient) throw new Error("no wallet client");
      const address = walletClient.account.address;

      const decimals = (await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "decimals",
      })) as number;
      const amount = parseUnits(String(args.humanAmount), decimals);

      const allowance = (await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, ESCROW_ADDRESS],
      })) as bigint;

      if (allowance < amount) {
        const approveHash = await walletClient.writeContract({
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [ESCROW_ADDRESS, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      const depositHash = await walletClient.writeContract({
        address: ESCROW_ADDRESS,
        abi: AURASCI_ESCROW_ABI,
        functionName: "deposit",
        args: [args.intentId, amount],
      });
      await publicClient.waitForTransactionReceipt({ hash: depositHash });

      return { txHash: depositHash, url: txUrl(depositHash) };
    },
    onSuccess: (_d, vars) => {
      // Optimistic update — bump the cached intent's totalRaisedUsdc by the
      // amount we just deposited so the funding card reflects the new
      // balance immediately. The indexer needs a few seconds to see the
      // Deposited event and update the DB; until then a plain invalidate +
      // refetch would just return the still-stale $0.
      const addedBaseUnits = BigInt(Math.round(vars.humanAmount * 1_000_000));
      qc.setQueryData<IntentDto>(["intent", vars.intentId], (old) => {
        if (!old) return old;
        return {
          ...old,
          totalRaisedUsdc: (BigInt(old.totalRaisedUsdc) + addedBaseUnits).toString(),
        };
      });

      // Eventual consistency — keep invalidating for ~30s so the indexer's
      // real numbers (with Patronage rows, activity log, etc.) override the
      // optimistic value once they land.
      qc.invalidateQueries({ queryKey: ["intent", vars.intentId] });
      qc.invalidateQueries({ queryKey: ["intents"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      const interval = setInterval(() => {
        qc.invalidateQueries({ queryKey: ["intent", vars.intentId] });
        qc.invalidateQueries({ queryKey: ["intents"] });
        qc.invalidateQueries({ queryKey: ["activity"] });
      }, 3_000);
      setTimeout(() => clearInterval(interval), 30_000);
    },
  });
}

// ─── Claim milestone (call /api/ai/verifier then escrow.release) ────────

export function useClaim() {
  const publicClient = usePublicClient();
  const config = useConfig();
  const requireChain = useRequireChain();
  const ensureWalletReady = useEnsureWalletReady();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: { intentId: string; milestoneIdx: number }) => {
      // Look at the current milestone first. If the AI worker already signed
      // (status=ai_verifying with releaseSignature + releaseNonce cached) we
      // skip re-running the verifier and just broadcast the cached signature.
      // This is the natural retry path when the on-chain tx failed (e.g.
      // InsufficientEscrow because the user hadn't funded yet) — the AI
      // doesn't need to grade again, the signature is still valid.
      const intent0 = await api.getIntent(args.intentId);
      const milestone0 = intent0.milestones.find((m) => m.idx === args.milestoneIdx);
      if (!milestone0) throw new Error("milestone not found");

      let signature: string | null = null;
      let nonce: string | null = null;
      let scoreUsed = 0;

      const cached =
        milestone0.status === "ai_verifying" &&
        milestone0.releaseSignature &&
        milestone0.releaseNonce;

      if (cached) {
        signature = milestone0.releaseSignature;
        nonce     = milestone0.releaseNonce;
        scoreUsed = milestone0.aiScore ?? 0;
      } else {
        // 1. Enqueue verifier job (returns immediately, even if AI is slow).
        const { job: queued } = await api.runVerifier(args.intentId, args.milestoneIdx);
        // 2. Poll until the worker finishes scoring + signing.
        const job = await api.waitForJob(queued.id);
        if (job.status === "failed") {
          throw new Error(`AI verifier failed: ${job.error ?? "unknown error"}`);
        }
        if ((job.score ?? 0) < 70 || !job.signature || !job.nonce) {
          throw new Error(`AI verifier rejected (score ${job.score ?? 0}/100): ${job.rationale ?? "no rationale"}`);
        }
        signature = job.signature;
        nonce = job.nonce;
        scoreUsed = job.score ?? 0;
      }

      // 3. Re-read intent post-verify so amount + scientistWallet are fresh.
      const intent = await api.getIntent(args.intentId);
      const milestone = intent.milestones.find((m) => m.idx === args.milestoneIdx);
      if (!milestone) throw new Error("milestone vanished mid-flow");

      await ensureWalletReady();
      await requireChain();
      const walletClient = await getWalletClient(config, { chainId: ACTIVE_CHAIN.id });
      if (!walletClient || !publicClient) throw new Error("no wallet client");

      // Anchor the on-chain Released event to the proof content: `reason`
      // carries the SHA-256 of the artifact stored on Walrus, so the event
      // is a cryptographic commitment to exactly the bytes the AI verifier
      // graded. (Fallback tag keeps old milestones claimable.)
      const reason = (milestone.proofHash ??
        keccak256(toBytes(`milestone-${args.milestoneIdx}`))) as `0x${string}`;
      const hash = await walletClient.writeContract({
        address: ESCROW_ADDRESS,
        abi: AURASCI_ESCROW_ABI,
        functionName: "release",
        args: [
          args.intentId as `0x${string}`,
          intent.scientistWallet as `0x${string}`,
          BigInt(milestone.releaseAmountUsdc),
          nonce as `0x${string}`,
          reason,
          signature as `0x${string}`,
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      return { txHash: hash, url: txUrl(hash), score: scoreUsed };
    },
    onSuccess: (_d, vars) => {
      // Indexer lag (~4s + 1 confirmation): refetch immediately then keep
      // re-invalidating every 3s for 30s so the milestone status flips from
      // `ai_verifying` → `released` and the next milestone activates.
      const refresh = () => {
        qc.invalidateQueries({ queryKey: ["intent", vars.intentId] });
        qc.invalidateQueries({ queryKey: ["intents"] });
        qc.invalidateQueries({ queryKey: ["activity"] });
      };
      refresh();
      const interval = setInterval(refresh, 3_000);
      setTimeout(() => clearInterval(interval), 30_000);
    },
  });
}

// ─── Refund flow (request signature, then submit on-chain) ─────────────

export function useRefundEligibility(intentId: string | undefined) {
  const { authenticated } = useAuth();
  const { address } = useAccount();
  return useQuery({
    queryKey: ["refund-eligibility", intentId, address],
    queryFn: () => api.refundEligibility(intentId!),
    enabled: Boolean(intentId) && authenticated,
  });
}

export function useRefund() {
  const publicClient = usePublicClient();
  const config = useConfig();
  const requireChain = useRequireChain();
  const ensureWalletReady = useEnsureWalletReady();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: { intentId: string }) => {
      await ensureWalletReady();
      await requireChain();
      const walletClient = await getWalletClient(config, { chainId: ACTIVE_CHAIN.id });
      if (!walletClient || !publicClient) throw new Error("no wallet client");

      const { refund } = await api.requestRefund(args.intentId);
      const hash = await walletClient.writeContract({
        address: ESCROW_ADDRESS,
        abi: AURASCI_ESCROW_ABI,
        functionName: "refund",
        args: [
          refund.intentId,
          refund.patron,
          BigInt(refund.amount),
          refund.nonce,
          refund.reason,
          refund.signature,
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      return { txHash: hash, url: txUrl(hash), amount: refund.amount };
    },
    onSuccess: (_d, vars) => {
      // Indexer lag — keep refreshing for 30s until the Refunded event
      // gets indexed and the refund record / activity / eligibility update.
      const refresh = () => {
        qc.invalidateQueries({ queryKey: ["intent", vars.intentId] });
        qc.invalidateQueries({ queryKey: ["intents"] });
        qc.invalidateQueries({ queryKey: ["activity"] });
        qc.invalidateQueries({ queryKey: ["refund-eligibility", vars.intentId] });
      };
      refresh();
      const interval = setInterval(refresh, 3_000);
      setTimeout(() => clearInterval(interval), 30_000);
    },
  });
}

// ─── Canton private rail ────────────────────────────────────────────────

/** Aggregate private-rail funding for an intent. Returns null (not an
 *  error state) when the backend has the Canton rail disabled, so pages
 *  can simply hide the private block. */
export function useCantonSummary(intentId: string | undefined) {
  return useQuery({
    queryKey: ["canton-intent", intentId],
    queryFn: async () => {
      try { return await api.cantonIntent(intentId!); }
      catch (e: any) {
        if (/disabled|503/i.test(e?.message ?? "")) return null;
        throw e;
      }
    },
    enabled: Boolean(intentId),
    retry: false,
  });
}

/** Fund through the Canton rail — custodial party, no wallet popup. The
 *  ledger (not the UI) keeps the patronage private to its stakeholders. */
export function useCantonFund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { intentId: string; amountUsd: number }) =>
      api.cantonFund(args.intentId, args.amountUsd),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["canton-intent", vars.intentId] });
    },
  });
}

// ─── Aura (social points) ──────────────────────────────────────────────

export function useAuraSeason() {
  return useQuery({ queryKey: ["aura-season"], queryFn: api.auraSeason });
}
export function useAuraLeaderboard(limit?: number) {
  return useQuery({ queryKey: ["aura-leaderboard", limit], queryFn: () => api.auraLeaderboard(limit) });
}
export function useAuraHeat(intentIds: string[]) {
  return useQuery({
    queryKey: ["aura-heat", ...intentIds],
    queryFn: () => api.auraHeat(intentIds),
    enabled: intentIds.length > 0,
  });
}
export function useAuraSpends() {
  const { authenticated } = useAuth();
  return useQuery({
    queryKey: ["aura-spends"],
    queryFn: api.auraSpends,
    enabled: authenticated,
  });
}
export function useAuraYields() {
  const { authenticated } = useAuth();
  return useQuery({
    queryKey: ["aura-yields"],
    queryFn: api.auraYields,
    enabled: authenticated,
  });
}

export function useAuraBoost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { intentId: string; amount: number }) =>
      api.auraBoost(args.intentId, args.amount),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["aura-season"] });
      qc.invalidateQueries({ queryKey: ["aura-heat"] });
      qc.invalidateQueries({ queryKey: ["aura-spends"] });
      qc.invalidateQueries({ queryKey: ["aura-leaderboard"] });
      qc.invalidateQueries({ queryKey: ["intent", vars.intentId] });
    },
  });
}

// ─── Admin: emergency adminWithdraw (escape hatch) ─────────────────────

export function useAdminWithdraw() {
  const publicClient = usePublicClient();
  const config = useConfig();
  const requireChain = useRequireChain();
  const ensureWalletReady = useEnsureWalletReady();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      intentId: `0x${string}`;
      amount: bigint;                  // 6-decimal USDC units
      to: `0x${string}`;
      reasonText?: string;             // free-form label, will be keccak256'd
    }) => {
      await ensureWalletReady();
      await requireChain();
      const walletClient = await getWalletClient(config, { chainId: ACTIVE_CHAIN.id });
      if (!walletClient || !publicClient) throw new Error("no wallet client");

      const reason = keccak256(toBytes(args.reasonText ?? "admin-withdraw"));
      const hash = await walletClient.writeContract({
        address: ESCROW_ADDRESS,
        abi: AURASCI_ESCROW_ABI,
        functionName: "adminWithdraw",
        args: [args.intentId, args.amount, args.to, reason],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      return { txHash: hash, url: txUrl(hash) };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["intent", vars.intentId] });
      qc.invalidateQueries({ queryKey: ["intents"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    },
  });
}

// ─── Admin: one-click refund all patrons ───────────────────────────────

export function useAdminRefundAll() {
  const publicClient = usePublicClient();
  const config = useConfig();
  const requireChain = useRequireChain();
  const ensureWalletReady = useEnsureWalletReady();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: { intentId: string; onProgress?: (i: number, total: number, tx: string) => void }) => {
      await ensureWalletReady();
      await requireChain();
      const walletClient = await getWalletClient(config, { chainId: ACTIVE_CHAIN.id });
      if (!walletClient || !publicClient) throw new Error("no wallet client");

      const { refunds } = await api.adminRefundAll(args.intentId);
      if (refunds.length === 0) return { count: 0, txs: [] as string[] };

      const txs: string[] = [];
      for (let i = 0; i < refunds.length; i++) {
        const r = refunds[i];
        const hash = await walletClient.writeContract({
          address: ESCROW_ADDRESS,
          abi: AURASCI_ESCROW_ABI,
          functionName: "refund",
          args: [
            args.intentId as `0x${string}`,
            r.patron,
            BigInt(r.amount),
            r.nonce,
            r.reason,
            r.signature,
          ],
        });
        await publicClient.waitForTransactionReceipt({ hash });
        txs.push(hash);
        args.onProgress?.(i + 1, refunds.length, hash);
      }
      return { count: refunds.length, txs };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["intent", vars.intentId] });
      qc.invalidateQueries({ queryKey: ["intents"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      qc.invalidateQueries({ queryKey: ["refund-eligibility"] });
    },
  });
}

// ─── Scientist onboarding (Lab Profile upsert + ORCID verify) ──────────

export function useUpdateScientist() {
  const { address } = useAccount();
  const session = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      displayName: string;
      bio?: string;
      avatarUrl?: string;
      orcid?: string;
      affiliation?: string;
    }) => {
      // The session wallet (from /me) is what the backend's ownership
      // check compares against; fall back to wagmi's active address only
      // while the /me query is still loading.
      const wallet = (session.data?.wallet ?? address ?? "").toString().toLowerCase();
      if (!wallet) throw new Error("wallet not connected");
      return api.upsertScientist(wallet, body);
    },
    onSuccess: () => {
      // /me reflects the new role=scientist; profile pages re-fetch the row.
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["scientist"] });
    },
  });
}

// ─── Proof upload ───────────────────────────────────────────────────────

export function useSubmitProof() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { intentId: string; idx: number; file: File }) =>
      api.submitProof(args.intentId, args.idx, args.file),
    onSuccess: (_d, vars) => {
      // Both the single-intent detail page and the scientist-dashboard list
      // page render off cached data — invalidate both so the milestone flips
      // from `in_progress` to `proof_submitted` without waiting for staleTime.
      qc.invalidateQueries({ queryKey: ["intent", vars.intentId] });
      qc.invalidateQueries({ queryKey: ["intents"] });
    },
  });
}

// ─── Format helpers ─────────────────────────────────────────────────────

export const usdcToFloat = (s: string) => Number(s) / 1e6;
export const fmtUsdc = (s: string) => "$" + usdcToFloat(s).toLocaleString();
export const shortAddr = (a: string | null | undefined) =>
  a ? a.slice(0, 6) + "…" + a.slice(-4) : "—";
