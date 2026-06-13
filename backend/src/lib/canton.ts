/**
 * Canton rail — thin client for the Daml JSON Ledger API (v1, as served
 * by `daml start` in canton/). The Base/Solidity escrow stays the public
 * rail; this module powers the PRIVATE patronage rail where each
 * Patronage contract is only distributed to its stakeholders' nodes.
 *
 * Custodial party model (hackathon scope): every platform party — the
 * Operator, the AI Verifier, and one party per SIWE wallet — lives on our
 * own sandbox participant, and this backend signs ledger commands on
 * their behalf. Production swaps this for external parties via the
 * Canton Wallet SDK without touching the Daml templates.
 *
 * Feature-flagged: when CANTON_JSON_API_URL is unset every endpoint
 * answers 503 and the rest of AuraSci runs exactly as before.
 */
import { SignJWT } from "jose";
import { ENV } from "./env.js";

export const CANTON_ENABLED = Boolean(ENV.CANTON_JSON_API_URL);

// Package-name reference (Daml 2.10 smart-contract-upgrades format):
// "#<package-name from canton/daml.yaml>:<module>" — resolves to the
// newest vetted package version, so re-deploying the DAR never breaks us.
const PKG = "#aurasci-canton:AuraSci";

// ─── auth ────────────────────────────────────────────────────────────────
// The sandbox runs without an auth service, so the JSON API only needs a
// structurally-valid ledger-claims JWT; any HS256 secret is accepted.
const SANDBOX_SECRET = new TextEncoder().encode("aurasci-sandbox");

async function ledgerToken(actAs: string[], readAs: string[] = []): Promise<string> {
  return new SignJWT({
    "https://daml.com/ledger-api": {
      ledgerId: "sandbox",
      applicationId: "aurasci",
      actAs,
      readAs,
    },
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("5m")
    .sign(SANDBOX_SECRET);
}

async function jsonApi<T>(path: string, body: unknown, actAs: string[], readAs: string[] = [], method: "POST" | "GET" = "POST"): Promise<T> {
  const res = await fetch(`${ENV.CANTON_JSON_API_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await ledgerToken(actAs, readAs)}`,
    },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.status >= 400) {
    const msg = Array.isArray(json.errors) ? json.errors.join("; ") : `JSON API HTTP ${res.status}`;
    throw new Error(`canton: ${msg}`);
  }
  return json.result as T;
}

// ─── party management ────────────────────────────────────────────────────

const partyCache = new Map<string, string>();    // hint → full party id

/** Resolve a party by its allocation hint, allocating it on first use.
 *  Platform parties ("Operator", "Verifier") are pre-allocated by the
 *  daml.yaml init-script; user parties are derived from the SIWE wallet. */
export async function partyFor(hint: string): Promise<string> {
  const cached = partyCache.get(hint);
  if (cached) return cached;

  // POST /v1/parties/allocate is idempotent-enough for our use: if the
  // hint is taken it errors, and we fall back to listing parties.
  try {
    const r = await jsonApi<{ identifier: string }>(
      "/v1/parties/allocate",
      { identifierHint: hint, displayName: hint },
      [],
    );
    partyCache.set(hint, r.identifier);
    return r.identifier;
  } catch {
    const all = await jsonApi<Array<{ identifier: string; displayName?: string }>>("/v1/parties", undefined, [], [], "GET");
    const hit = all.find((p) => p.displayName === hint || p.identifier.startsWith(hint + "::"));
    if (!hit) throw new Error(`canton: party ${hint} not found and could not be allocated`);
    partyCache.set(hint, hit.identifier);
    return hit.identifier;
  }
}

/** Party hint for an AuraSci user — stable per SIWE wallet. */
export const userPartyHint = (wallet: string) => `user-${wallet.slice(2, 10)}`;

// ─── contract operations ─────────────────────────────────────────────────

type Contract<T> = { contractId: string; payload: T };

export type IntentPayload = {
  operator: string; scientist: string; verifier: string;
  intentId: string; title: string; fundingGoal: string;
  // NB: the JSON API encodes Daml Int64 as a STRING — compare with Number(idx).
  milestones: Array<{ idx: number | string; description: string; amount: string; released: boolean }>;
};
export type PatronagePayload = {
  operator: string; patron: string; scientist: string;
  intentId: string; amount: string;
};

/** Find the on-ledger ResearchIntent for an intentId (operator view). */
export async function findIntent(intentId: string): Promise<Contract<IntentPayload> | null> {
  const operator = await partyFor("Operator");
  const rows = await jsonApi<Array<Contract<IntentPayload>>>(
    "/v1/query",
    { templateIds: [`${PKG}:ResearchIntent`], query: { intentId } },
    [operator],
  );
  return rows[0] ?? null;
}

/** Mirror a DB intent onto the ledger if it isn't there yet. */
export async function ensureIntent(intent: {
  intentId: string; title: string; fundingGoalUsdc: string; scientistWallet: string;
  milestones: Array<{ idx: number; title: string; releaseAmountUsdc: string; status: string }>;
}): Promise<Contract<IntentPayload>> {
  const existing = await findIntent(intent.intentId);
  if (existing) return existing;

  const [operator, verifier, scientist] = await Promise.all([
    partyFor("Operator"), partyFor("Verifier"), partyFor(userPartyHint(intent.scientistWallet)),
  ]);
  const usdc = (base: string) => (Number(base) / 1e6).toFixed(2); // 6-dec base units → Decimal
  await jsonApi(
    "/v1/create",
    {
      templateId: `${PKG}:ResearchIntent`,
      payload: {
        operator, scientist, verifier,
        intentId: intent.intentId,
        title: intent.title,
        fundingGoal: usdc(intent.fundingGoalUsdc),
        milestones: intent.milestones.map((m) => ({
          idx: m.idx, description: m.title, amount: usdc(m.releaseAmountUsdc),
          released: m.status === "released",
        })),
      },
    },
    [operator],
  );
  const created = await findIntent(intent.intentId);
  if (!created) throw new Error("canton: intent creation did not land");
  return created;
}

/** Private patronage: exercise Fund as patron + operator (dual authority). */
export async function fund(intentCid: string, patronWallet: string, amountUsd: number): Promise<string> {
  const [operator, patron] = await Promise.all([
    partyFor("Operator"), partyFor(userPartyHint(patronWallet)),
  ]);
  const r = await jsonApi<{ exerciseResult: string }>(
    "/v1/exercise",
    {
      templateId: `${PKG}:ResearchIntent`,
      contractId: intentCid,
      choice: "Fund",
      argument: { patron, amount: amountUsd.toFixed(2) },
    },
    [patron, operator],
  );
  return r.exerciseResult;
}

/** Release a milestone — operator + verifier dual control (the Canton
 *  analogue of the EIP-712 release signature on Base). */
export async function releaseMilestone(intentCid: string, milestoneIdx: number, aiScore: number) {
  const [operator, verifier] = await Promise.all([partyFor("Operator"), partyFor("Verifier")]);
  return jsonApi(
    "/v1/exercise",
    {
      templateId: `${PKG}:ResearchIntent`,
      contractId: intentCid,
      choice: "ReleaseMilestone",
      argument: { milestoneIdx, aiScore },
    },
    [operator, verifier],
  );
}

/** Operator-side aggregate for an intent: total + patron count, WITHOUT
 *  exposing who funded what. Optionally include the caller's own rows. */
export async function intentSummary(intentId: string, callerWallet?: string) {
  const operator = await partyFor("Operator");
  const rows = await jsonApi<Array<Contract<PatronagePayload>>>(
    "/v1/query",
    { templateIds: [`${PKG}:Patronage`], query: { intentId } },
    [operator],
  );
  const total = rows.reduce((s, r) => s + Number(r.payload.amount), 0);

  let mine: Array<{ amount: number }> = [];
  if (callerWallet) {
    const me = await partyFor(userPartyHint(callerWallet));
    mine = rows.filter((r) => r.payload.patron === me).map((r) => ({ amount: Number(r.payload.amount) }));
  }
  return { totalUsd: total, patronCount: rows.length, mine };
}
