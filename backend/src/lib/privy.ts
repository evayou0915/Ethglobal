/**
 * Privy server-side helper — used by the dual-token auth path.
 *
 * Privy is OPTIONAL: when PRIVY_APP_ID / PRIVY_APP_SECRET are unset the
 * client is never constructed and `privyEnabled()` is false, so the
 * backend keeps working with SIWE-only auth. When configured, requireAuth
 * (lib/auth.ts) falls back to verifying a Privy access token after the
 * self-issued SIWE JWT fails.
 */
import { PrivyClient } from "@privy-io/server-auth";
import { ENV } from "./env.js";

let _privy: PrivyClient | null = null;

export function privyEnabled(): boolean {
  return Boolean(ENV.PRIVY_APP_ID && ENV.PRIVY_APP_SECRET);
}

/** Lazily built Privy client (JWKS verification + user lookups). */
export function privy(): PrivyClient {
  if (!privyEnabled()) throw new Error("Privy not configured (PRIVY_APP_ID / PRIVY_APP_SECRET)");
  if (!_privy) _privy = new PrivyClient(ENV.PRIVY_APP_ID, ENV.PRIVY_APP_SECRET);
  return _privy;
}

/** Verify a Privy access token against Privy's JWKS. Returns `{ userId, ... }`
 *  or throws if invalid/expired. */
export async function verifyPrivyToken(token: string) {
  return privy().verifyAuthToken(token);
}

/** Pick the wallet to pin to a User row for a Privy account:
 *    - external wallet (MetaMask / Rabby) if linked, else
 *    - the Privy-managed embedded wallet (deterministic per DID).
 *  Returns null when no wallet is linked yet (embedded still provisioning). */
export function pickPinnedWallet(user: { linkedAccounts?: unknown[] } | null): string | null {
  const accounts = (user?.linkedAccounts ?? []) as Array<Record<string, any>>;
  const external = accounts.find(
    (a) => a.type === "wallet" && a.address && a.walletClientType !== "privy",
  );
  if (external?.address) return String(external.address).toLowerCase();
  const embedded = accounts.find(
    (a) => a.type === "wallet" && a.address && a.walletClientType === "privy",
  );
  if (embedded?.address) return String(embedded.address).toLowerCase();
  const any = accounts.find((a) => a.type === "wallet" && a.address);
  return any?.address ? String(any.address).toLowerCase() : null;
}

/** Display name + first-seen auth method from a Privy user, for the User row. */
export function extractIdentity(
  user: { linkedAccounts?: unknown[] } | null,
): { displayName: string | null; email: string | null; source: "email" | "google" | "twitter" | "wallet" | "unknown" } {
  const accounts = (user?.linkedAccounts ?? []) as Array<Record<string, any>>;
  const email   = accounts.find((a) => a.type === "email");
  const google  = accounts.find((a) => a.type === "google_oauth");
  const twitter = accounts.find((a) => a.type === "twitter_oauth");
  if (email?.address)    return { displayName: email.address,          email: email.address,  source: "email" };
  if (google?.email)     return { displayName: google.email,           email: google.email,   source: "google" };
  if (twitter?.username) return { displayName: "@" + twitter.username, email: null,           source: "twitter" };
  const wallet = accounts.find((a) => a.type === "wallet");
  if (wallet?.address)   return { displayName: String(wallet.address), email: null,           source: "wallet" };
  return { displayName: null, email: null, source: "unknown" };
}
