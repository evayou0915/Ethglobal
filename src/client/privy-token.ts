"use client";

/**
 * Module-level cache for the current Privy access token.
 *
 * `jsonFetch` (api.ts) runs outside React and can't call Privy hooks, so
 * the PrivyTokenBridge component writes the freshest token here on every
 * auth change and `authHeader()` reads it synchronously. Only consulted
 * when there's no self-issued SIWE JWT — the wallet/SIWE path keeps using
 * its own token.
 */
let cachedToken: string | null = null;
let logoutFn: (() => Promise<void>) | null = null;

export const privyToken = {
  current(): string | null {
    return cachedToken;
  },
  set(token: string | null) {
    cachedToken = token;
  },
  clear() {
    cachedToken = null;
  },
  /** PrivyTokenBridge installs Privy's logout here so non-React logout
   *  code (useLogout) can end the Privy session too. No-op if unset. */
  installLogout(fn: () => Promise<void>) {
    logoutFn = fn;
  },
  async logout() {
    cachedToken = null;
    if (logoutFn) { try { await logoutFn(); } catch { /* ignore */ } }
  },
};
