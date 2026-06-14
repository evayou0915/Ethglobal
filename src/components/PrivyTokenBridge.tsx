"use client";

import { useEffect, useRef } from "react";
import { usePrivy, useCreateWallet } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { privyToken } from "@/client/privy-token";
import { useAuthStore } from "@/client/auth";
import { api } from "@/client/api";

function hasEmbeddedEvmWallet(user: ReturnType<typeof usePrivy>["user"]): boolean {
  const accounts = (user?.linkedAccounts ?? []) as Array<Record<string, any>>;
  return accounts.some(
    (a) => a.type === "wallet" && a.walletClientType === "privy" && (a.chainType ?? "ethereum") === "ethereum",
  );
}

/** Bridges Privy auth state into the non-React world:
 *   - mirrors the Privy access token into the module cache so api.ts can
 *     attach it as a Bearer header on the email/social login path;
 *   - flips `privyAuthed` in the auth store so useAuth() reports logged-in
 *     without calling usePrivy() everywhere;
 *   - force-provisions an embedded EVM wallet for OAuth/email users (the
 *     backend pins a wallet from the Privy profile on first /me);
 *   - pings /api/auth/me once authenticated so the User row is upserted.
 *  Renders nothing. Mount once inside <PrivyProvider/>. */
export function PrivyTokenBridge() {
  const { ready, authenticated, user, getAccessToken, logout } = usePrivy();
  const { createWallet } = useCreateWallet();
  const setPrivyAuthed = useAuthStore((s) => s.setPrivyAuthed);
  const qc = useQueryClient();

  // Expose Privy's logout to non-React logout code (useLogout).
  useEffect(() => {
    privyToken.installLogout(async () => { await logout(); });
  }, [logout]);

  // Provision an embedded wallet at most once per mount for OAuth/email users.
  const attemptedCreate = useRef(false);
  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    if (hasEmbeddedEvmWallet(user)) return;
    if (attemptedCreate.current) return;
    attemptedCreate.current = true;
    (async () => {
      try { await createWallet(); qc.invalidateQueries({ queryKey: ["me"] }); }
      catch (e) {
        const msg = (e as Error).message ?? "";
        if (!/already.*(exist|created)/i.test(msg)) attemptedCreate.current = false;
      }
    })();
  }, [ready, authenticated, user, createWallet, qc]);

  // Keep the token cache + privyAuthed flag in sync. Refresh on a 5-min
  // heartbeat (Privy tokens are ~1h and auto-rotate near expiry).
  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      privyToken.clear();
      setPrivyAuthed(false);
      return;
    }
    let cancelled = false;
    const refresh = async (kickBackend: boolean) => {
      try {
        const t = await getAccessToken();
        if (cancelled) return;
        privyToken.set(t ?? null);
        setPrivyAuthed(Boolean(t));
        if (kickBackend && t) {
          for (let i = 0; i < 5 && !cancelled; i++) {
            try { await api.me(); qc.invalidateQueries({ queryKey: ["me"] }); break; }
            catch { await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
          }
        }
      } catch {
        if (!cancelled) { privyToken.set(null); setPrivyAuthed(false); }
      }
    };
    refresh(true);
    const id = setInterval(() => refresh(false), 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [ready, authenticated, getAccessToken, setPrivyAuthed, qc]);

  return null;
}
