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
  }
}

// ─── JWT-backed middleware ──────────────────────────────────────────────

/** Verify a self-issued JWT, ensure a local User row exists, and stash the
 *  wallet / role on the Hono context for downstream handlers. */
async function authenticateAndUpsert(token: string, c: Context) {
  let claims: Claims;
  try {
    claims = await verifyToken(token);
  } catch (e) {
    throw new HTTPException(401, { message: "invalid token: " + (e as Error).message });
  }
  const wallet = claims.sub.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
    throw new HTTPException(401, { message: "token subject is not a wallet address" });
  }

  // The User row is created at SIWE login time, but tolerate tokens that
  // outlive a DB reset by lazily re-creating the row here.
  let user = await prisma.user.findUnique({ where: { wallet } });
  if (!user) {
    user = await prisma.user.create({
      data: { wallet, role: "patron", lastLoginAt: new Date() },
    });
  } else {
    // Lightly refresh lastLoginAt — not on every request, only when the
    // last write was more than a minute ago, so the DB write rate stays sane.
    const stale = !user.lastLoginAt || Date.now() - user.lastLoginAt.getTime() > 60_000;
    if (stale) {
      user = await prisma.user.update({ where: { wallet }, data: { lastLoginAt: new Date() } });
    }
  }

  // DB is the single source of truth for the user's role — never the token,
  // so role changes (e.g. onboarding promotes patron → scientist) apply to
  // already-issued sessions immediately.
  c.set("wallet", user.wallet);
  c.set("role", user.role);
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
