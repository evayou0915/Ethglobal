// Demo prep: fund the $CELL-01 intent privately as two institutional
// patrons through the REAL backend HTTP API (auth → fund → verify).
import { SignJWT } from "jose";

const API = "http://localhost:8787";
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);
const INTENT = "0xcell010000000000000000000000000000000000000000000000000000000000";

async function tokenFor(wallet: string) {
  return new SignJWT({ sub: wallet, role: "patron" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("aurasci").setAudience("aurasci-app").setSubject(wallet)
    .setIssuedAt().setExpirationTime("1h").sign(SECRET);
}
async function call(path: string, opts: RequestInit = {}, wallet?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers as any) };
  if (wallet) headers.authorization = "Bearer " + (await tokenFor(wallet));
  const res = await fetch(API + path, { ...opts, headers });
  const j: any = await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(j)}`);
  return j.data;
}

const PHARMA_A = "0x" + "aa".repeat(20);
const PHARMA_B = "0x" + "bb".repeat(20);

const a = await call("/api/canton/fund", { method: "POST", body: JSON.stringify({ intentId: INTENT, amountUsd: 30000 }) }, PHARMA_A);
console.log("✓ PharmaA funded $30k privately →", a.patronageCid.slice(0, 20) + "…");
const b = await call("/api/canton/fund", { method: "POST", body: JSON.stringify({ intentId: INTENT, amountUsd: 12000 }) }, PHARMA_B);
console.log("✓ PharmaB funded $12k privately →", b.patronageCid.slice(0, 20) + "…");

const anon = await call(`/api/canton/intents/${INTENT}`);
console.log("✓ anonymous view:", JSON.stringify(anon));
const asA = await call(`/api/canton/intents/${INTENT}`, {}, PHARMA_A);
console.log("✓ PharmaA's view:", JSON.stringify(asA.mine));
const asB = await call(`/api/canton/intents/${INTENT}`, {}, PHARMA_B);
console.log("✓ PharmaB's view:", JSON.stringify(asB.mine));
