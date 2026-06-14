/**
 * SIWE auth — the browser signs a Sign-In-With-Ethereum message with the
 * user's wallet, POSTs it to /api/auth/siwe, and receives a self-issued
 * HS256 JWT whose `sub` is the lowercased wallet address. Every
 * authenticated request carries that JWT in the Authorization header;
 * [requireAuth] verifies it and hydrates the local User row.
 */
import { SignJWT, jwtVerify } from "jose";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ENV } from "./env.js";
import { prisma } from "./db.js";
import { privyEnabled, verifyPrivyToken, privy, pickPinnedWallet, extractIdentity } from "./privy.js";

const SECRET = new TextEncoder().encode(ENV.JWT_SECRET);
const ISSUER = "aurasci";
const AUDIENCE = "aurasci-app";

export type Claims = {
  sub: string;                                      // lowercased 0x wallet address
  role?: "scientist" | "patron" | "admin";
};

export async function issueToken(claims: Claims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ENV.JWT_TTL_SECONDS)
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<Claims> {
  const { payload } = await jwtVerify(token, SECRET, { issuer: ISSUER, audience: AUDIENCE });
  if (!payload.sub) throw new Error("token has no sub");
  return { sub: payload.sub, role: payload.role as Claims["role"] | undefined };
}

// ─── Hono context augmentation ──────────────────────────────────────────

declare module "hono" {
  interface ContextVariableMap {
    wallet: string;                                 // populated after requireAuth
    role: Claims["role"] | undefined;
    privyId: string | undefined;                    // set only for Privy-authed callers
  }
}

// ─── Dual-token middleware (SIWE self-JWT + Privy) ──────────────────────

/** Touch the User row for `wallet` (create on first sight, refresh
 *  lastLoginAt at most once a minute) and stash wallet/role on context. */
async function hydrateUser(wallet: string, c: Context, opts: { privyId?: string; email?: string | null; displayName?: string | null } = {}) {
  let user = await prisma.user.findUnique({ where: { wallet } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        wallet, role: "patron", lastLoginAt: new Date(),
        privyId: opts.privyId ?? null,
        email: opts.email ?? null,
        displayName: opts.displayName ?? null,
      },
    });
  } else {
    const stale = !user.lastLoginAt || Date.now() - user.lastLoginAt.getTime() > 60_000;
    // Backfill privyId the first time a wallet-pinned user logs in via Privy.
    const needPrivyId = opts.privyId && user.privyId !== opts.privyId;
    if (stale || needPrivyId) {
      user = await prisma.user.update({
        where: { wallet },
        data: { lastLoginAt: new Date(), ...(needPrivyId ? { privyId: opts.privyId } : {}) },
      });
    }
  }
  // DB is the single source of truth for role — never the token.
  c.set("wallet", user.wallet);
  c.set("role", user.role);
  if (opts.privyId) c.set("privyId", opts.privyId);
}

/** Verify the bearer token and hydrate context. Tries the self-issued SIWE
 *  JWT first (the primary, always-on path); if that fails and Privy is
 *  configured, falls back to verifying a Privy access token via JWKS. */
async function authenticateAndUpsert(token: string, c: Context) {
  // 1. Self-issued SIWE JWT (HS256) — sub is the wallet address.
  try {
    const claims = await verifyToken(token);
    const wallet = claims.sub.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
      throw new HTTPException(401, { message: "token subject is not a wallet address" });
    }
    await hydrateUser(wallet, c);
    return;
  } catch (siweErr) {
    if (!privyEnabled()) {
      throw new HTTPException(401, { message: "invalid token: " + (siweErr as Error).message });
    }
  }

  // 2. Privy access token — verify against Privy's JWKS, pin the wallet.
  let privyId: string;
  try {
    const claims = await verifyPrivyToken(token);
    privyId = claims.userId;
  } catch (e) {
    throw new HTTPException(401, { message: "invalid token (neither SIWE nor Privy): " + (e as Error).message });
  }

  // Match an existing user by privyId first (fast path on repeat requests).
  const existing = await prisma.user.findFirst({ where: { privyId } });
  if (existing) {
    await hydrateUser(existing.wallet, c, { privyId });
    return;
  }

  // First sight of this Privy account — fetch the profile to pin a wallet.
  let privyUser: any = null;
  try { privyUser = await privy().getUserById(privyId); }
  catch (e) {
    throw new HTTPException(503, { message: "could not fetch Privy profile — retry shortly: " + (e as Error).message });
  }
  const pinned = pickPinnedWallet(privyUser);
  if (!pinned) {
    // Embedded wallet not provisioned yet — the frontend should retry.
    throw new HTTPException(503, { message: "embedded wallet pending provisioning by Privy — retry shortly" });
  }
  const ident = extractIdentity(privyUser);
  await hydrateUser(pinned, c, { privyId, email: ident.email, displayName: ident.displayName });
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header("authorization") ?? c.req.header("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "missing bearer token" });
  }
  await authenticateAndUpsert(auth.slice("Bearer ".length).trim(), c);
  await next();
};

/** Attach wallet to context if a valid token is present; otherwise let the
 *  request through anonymously. */
export const optionalAuth: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header("authorization") ?? c.req.header("Authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    try { await authenticateAndUpsert(auth.slice(7).trim(), c); }
    catch { /* swallow — anonymous */ }
  }
  await next();
};

export function walletFrom(c: Context): string {
  const w = c.get("wallet");
  if (!w) throw new HTTPException(401, { message: "not authenticated" });
  return w;
}

/** Hono middleware: require a token whose User has role `admin`. */
export const requireAdmin: MiddlewareHandler = async (c, next) => {
  await requireAuth(c, async () => {});
  if (c.get("role") !== "admin") {
    throw new HTTPException(403, { message: "admin role required" });
  }
  await next();
};

/** True when `intentScientistWallet` matches the caller's wallet. The JWT
 *  subject is the same address that was stored at intent-creation time, so
 *  a single string compare is the right (and strongest) check. */
export async function isIntentOwner(c: Context, scientistWallet: string): Promise<boolean> {
  const active = c.get("wallet");
  if (!active) return false;
  return active.toLowerCase() === scientistWallet.toLowerCase();
}

/** Sugar: throw 403 if the caller doesn't own the intent. */
export async function assertIntentOwner(c: Context, scientistWallet: string): Promise<void> {
  if (!(await isIntentOwner(c, scientistWallet))) {
    throw new HTTPException(403, { message: "only the intent's scientist may perform this action" });
  }
}
