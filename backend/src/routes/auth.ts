import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { SiweMessage, generateNonce } from "siwe";
import { prisma } from "../lib/db.js";
import { ok, parseJson } from "../lib/http.js";
import { ENV } from "../lib/env.js";
import { issueToken, requireAuth } from "../lib/auth.js";

export const authRouter = new Hono();

/**
 * SIWE login flow:
 *   1. GET  /api/auth/nonce          → one-time nonce (5-minute TTL)
 *   2. browser signs a SIWE message embedding that nonce
 *   3. POST /api/auth/siwe           → verify signature + nonce, upsert the
 *      User row, return a self-issued JWT (sub = lowercased wallet)
 * The frontend then sends the JWT as `Authorization: Bearer …` on every
 * request — see [requireAuth] in lib/auth.ts.
 */

// One-time nonces. In-memory is fine: the API is a single process, and a
// lost nonce (e.g. across a restart) just means the user clicks Login again.
const NONCE_TTL_MS = 5 * 60 * 1000;
const nonces = new Map<string, number>();           // nonce → expiry epoch ms

function pruneNonces() {
  const now = Date.now();
  for (const [n, exp] of nonces) if (exp < now) nonces.delete(n);
}

authRouter.get("/nonce", (c) => {
  pruneNonces();
  const nonce = generateNonce();
  nonces.set(nonce, Date.now() + NONCE_TTL_MS);
  return ok(c, { nonce });
});

const SiweSchema = z.object({
  message: z.string().min(1).max(4000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

authRouter.post("/siwe", async (c) => {
  const body = await parseJson(c, SiweSchema);

  let siwe: SiweMessage;
  try {
    siwe = new SiweMessage(body.message);
  } catch (e) {
    throw new HTTPException(400, { message: "malformed SIWE message: " + (e as Error).message });
  }

  // The nonce must be one we issued and not yet consumed (anti-replay).
  const expiry = nonces.get(siwe.nonce);
  if (!expiry || expiry < Date.now()) {
    throw new HTTPException(401, { message: "unknown or expired nonce — fetch a fresh one and retry" });
  }
  nonces.delete(siwe.nonce);

  if (siwe.chainId !== ENV.CHAIN_ID) {
    throw new HTTPException(401, { message: `SIWE chainId ${siwe.chainId} does not match server chain ${ENV.CHAIN_ID}` });
  }

  const verified = await siwe.verify({ signature: body.signature }).catch(() => null);
  if (!verified?.success) {
    throw new HTTPException(401, { message: "SIWE signature verification failed" });
  }

  const wallet = siwe.address.toLowerCase();
  const user = await prisma.user.upsert({
    where: { wallet },
    update: { lastLoginAt: new Date() },
    create: { wallet, role: "patron", lastLoginAt: new Date() },
  });

  const token = await issueToken({ sub: wallet, role: user.role });
  return ok(c, { token, wallet, role: user.role });
});

/** Returns the local User row associated with the caller's session. */
authRouter.get("/me", requireAuth, async (c) => {
  const wallet = c.get("wallet");
  const user = await prisma.user.findUnique({
    where: { wallet },
    select: {
      wallet: true, role: true,
      email: true, displayName: true,
      lastLoginAt: true,
    },
  });
  return ok(c, user ?? { wallet, role: "patron" });
});

/** No-op — logout is purely client-side (the frontend drops the stored
 *  JWT). Kept so the frontend can fire-and-forget a hook for potential
 *  server-side cleanup later (revoking refresh tokens etc). */
authRouter.post("/logout", (c) => ok(c, { ok: true }));
