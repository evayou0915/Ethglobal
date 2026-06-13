"use client";

import type {
  ApiOk,
  IntentListResponse,
  IntentDto,
  ActivityListResponse,
  ScientistDto,
  PublicConfig,
  LeaderboardResponse,
  AiJobDto,
  RefundQuote,
  RefundEligibility,
  AdminRefundAllResponse,
  AuraSeasonAndYou,
  AuraBalanceDto,
  AuraBoostResponse,
  AuraHeatMap,
  AuraSpendDto,
  AuraYieldDto,
} from "@/types/api";
import { authToken } from "./auth";

/** Backend base URL — points at the self-hosted Hono server (e.g. https://api.aurasci.xyz).
 *  Empty string falls back to relative URLs which is useful when running the
 *  backend behind the same reverse proxy as the frontend in dev. */
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

/** Session JWT issued by POST /api/auth/siwe, persisted in localStorage
 *  via the auth store. */
export const auth = {
  get token(): string | null {
    return authToken.current();
  },
  set(token: string | null) { authToken.set(token); },
  clear() { authToken.clear(); },
};

function url(path: string): string {
  if (!path.startsWith("/")) path = "/" + path;
  return API_BASE + path;
}

async function authHeader(): Promise<Record<string, string>> {
  const t = authToken.current();
  return t ? { Authorization: "Bearer " + t } : {};
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
    ...(await authHeader()),
  };

  const res = await fetch(url(path), { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return (body as ApiOk<T>).data;
}

async function fileFetch<T>(path: string, fd: FormData): Promise<T> {
  const headers = await authHeader();
  const res = await fetch(url(path), { method: "POST", headers, body: fd });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  return (json as ApiOk<T>).data;
}

export const api = {
  config: () => jsonFetch<PublicConfig>("/api/config"),
  siweNonce: () => jsonFetch<{ nonce: string }>("/api/auth/nonce"),
  siweVerify: (message: string, signature: string) =>
    jsonFetch<{ token: string; wallet: string; role: string }>("/api/auth/siwe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature }),
    }),
  me: () => jsonFetch<{
    wallet: string | null;
    role?: string;
    email?: string | null;
    displayName?: string | null;
  }>("/api/auth/me"),
  logout: async () => {
    try { await jsonFetch<{ ok: true }>("/api/auth/logout", { method: "POST" }); }
    finally { auth.clear(); }
  },

  listIntents: (params: { status?: string; category?: string; scientist?: string; limit?: number; cursor?: string }) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null) q.set(k, String(v));
    return jsonFetch<IntentListResponse>(`/api/intents?${q}`);
  },
  getIntent: (id: string) => jsonFetch<IntentDto>(`/api/intents/${encodeURIComponent(id)}`),
  createIntent: (body: unknown) =>
    jsonFetch<{ intent: IntentDto; job: AiJobDto }>("/api/intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),

  getScientist: (wallet: string) =>
    jsonFetch<ScientistDto & { intents: IntentDto[] }>(`/api/scientists/${wallet}`),
  upsertScientist: (wallet: string, body: unknown) =>
    jsonFetch<ScientistDto>(`/api/scientists/${wallet}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),

  activity: (params: { intentId?: string; actor?: string; limit?: number; cursor?: string }) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null) q.set(k, String(v));
    return jsonFetch<ActivityListResponse>(`/api/activity?${q}`);
  },

  submitProof: (intentId: string, idx: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fileFetch<{ blobId: string; blobUrl: string; suiObjectId: string | null; proofHash: string }>(
      `/api/intents/${encodeURIComponent(intentId)}/milestones/${idx}/submit-proof`,
      fd,
    );
  },

  runVerifier: (intentId: string, milestoneIdx: number) =>
    jsonFetch<{ job: AiJobDto }>("/api/ai/verifier", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId, milestoneIdx }),
    }),
  rescoreGatekeeper: (intentId: string) =>
    jsonFetch<{ job: AiJobDto }>("/api/ai/gatekeeper", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId }),
    }),

  leaderboard: (limit?: number) =>
    jsonFetch<LeaderboardResponse>(`/api/leaderboard${limit ? `?limit=${limit}` : ""}`),

  getJob: (id: string) => jsonFetch<AiJobDto>(`/api/ai/jobs/${encodeURIComponent(id)}`),

  refundEligibility: (intentId: string) =>
    jsonFetch<RefundEligibility>(`/api/refunds/eligibility?intentId=${encodeURIComponent(intentId)}`),
  requestRefund: (intentId: string) =>
    jsonFetch<{ refund: RefundQuote }>("/api/refunds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId }),
    }),
  adminRefundAll: (intentId: string) =>
    jsonFetch<AdminRefundAllResponse>(`/api/admin/intents/${encodeURIComponent(intentId)}/refund-all`, {
      method: "POST",
    }),

  // Aura
  auraSeason:    () => jsonFetch<AuraSeasonAndYou>("/api/aura/season"),
  auraBalance:   () => jsonFetch<AuraBalanceDto>("/api/aura/balance"),
  auraHeat:      (intentIds: string[]) =>
    jsonFetch<AuraHeatMap>(`/api/aura/heat?intentIds=${encodeURIComponent(intentIds.join(","))}`),
  auraSpends:    () => jsonFetch<{ items: AuraSpendDto[]; seasonId: string }>("/api/aura/spends"),
  auraYields:    () => jsonFetch<{ items: AuraYieldDto[]; seasonId: string }>("/api/aura/yields"),
  auraBoost:     (intentId: string, amount: number) =>
    jsonFetch<AuraBoostResponse>("/api/aura/boost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId, amount }),
    }),
  auraLeaderboard: (limit?: number) =>
    jsonFetch<{ items: Array<{ rank: number; intentId: string; heat: number; intent: { intentId: string; ticker: string; title: string; status: string; category: string } | null }>; seasonId: string | null }>(
      `/api/aura/leaderboard${limit ? `?limit=${limit}` : ""}`,
    ),

  /** Poll an AiJob until it leaves queued/running. Default 90s timeout. */
  async waitForJob(id: string, opts: { intervalMs?: number; timeoutMs?: number } = {}): Promise<AiJobDto> {
    const interval = opts.intervalMs ?? 1500;
    const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
    while (true) {
      const job = await api.getJob(id);
      if (job.status === "succeeded" || job.status === "failed") return job;
      if (Date.now() > deadline) throw new Error(`AI job ${id} timed out after ${opts.timeoutMs ?? 90_000}ms (status=${job.status})`);
      await new Promise((r) => setTimeout(r, interval));
    }
  },

};
