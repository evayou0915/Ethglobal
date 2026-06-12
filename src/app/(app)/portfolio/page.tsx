"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/client/auth";
import { api } from "@/client/api";
import { useActivity, useAuraBoost, useAuraSeason, useAuraSpends, useIntents, useSession } from "@/client/hooks";
import { useToast } from "@/components/Toast";
import type { ActivityRow, IntentDto, IntentStatus, ScientistDto } from "@/types/api";

/** Pick the right wallet to query the Scientist row by. The session wallet
 *  (from /me) is the address every row is keyed under; wagmi's active
 *  address is kept as a fallback for rows created before the session
 *  pinning landed. */
function scientistLookupCandidates(
  meWallet: string | null,
  wagmiAddr: string | undefined | null,
): string[] {
  const out: string[] = [];
  const push = (w: string | null | undefined) => {
    if (!w) return;
    const lc = w.toLowerCase();
    if (!out.includes(lc)) out.push(lc);
  };
  push(meWallet);
  push(wagmiAddr);
  return out;
}

type Role = "patron" | "scientist";

// Status → progress timeline bucket. The first segment is a synthetic
// "M0 · fundraising" bookend (matches the trajectory rail on the intent
// detail page); the rest map 1-to-1 to real DB milestones.
function timelineFromIntent(intent: IntentDto | undefined): Array<"done" | "active" | ""> {
  if (!intent) return ["", "", "", ""];
  const goal   = Number(intent.fundingGoalUsdc);
  const raised = Number(intent.totalRaisedUsdc);
  const fundSeg: "done" | "active" | "" =
    goal > 0 && raised >= goal ? "done" :
    raised > 0                  ? "active" :
    "";
  const milestoneSegs = intent.milestones.map<("done" | "active" | "")>((m) => {
    if (m.status === "released") return "done";
    if (m.status === "in_progress" || m.status === "proof_submitted" || m.status === "ai_verifying") return "active";
    return "";
  });
  return [fundSeg, ...milestoneSegs];
}

function badgeFromStatus(intent: IntentDto): { label: string; kind: "active" | "done" | "" } {
  const released = intent.milestones.filter((m) => m.status === "released").length;
  const total = intent.milestones.length;
  if (intent.status === "completed")    return { label: "Completed", kind: "done" };
  if (intent.status === "rejected")     return { label: "Rejected · refund window", kind: "" };
  if (intent.status === "ai_screening") return { label: "Awaiting gatekeeper", kind: "active" };
  if (total > 0 && released === total)  return { label: "All milestones released", kind: "done" };
  // 1-indexed display so M-number in the badge matches the rail labels.
  if (released > 0) return { label: `M${released} verified · M${released + 1} in progress`, kind: "done" };
  return { label: "Fundraising · M0", kind: "active" };
}

const fmtUsd = (rawUsdc: bigint | string | number) => {
  const n = typeof rawUsdc === "bigint" ? Number(rawUsdc) : Number(rawUsdc);
  return "$" + (n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 });
};

export default function PortfolioPage() {
  const [role, setRole] = useState<Role>("patron");
  const { address, isConnected } = useAccount();
  const { authenticated } = useAuth();
  const session = useSession();
  const meWallet = (session.data?.wallet ?? address ?? "").toString().toLowerCase() || null;

  const lookupCandidates = scientistLookupCandidates(meWallet, address);
  const scientistQ = useQuery({
    queryKey: ["scientist-any", lookupCandidates],
    queryFn: async () => {
      let lastErr: unknown = null;
      for (const w of lookupCandidates) {
        try { return await api.getScientist(w); }
        catch (e) { lastErr = e; /* try next */ }
      }
      throw lastErr ?? new Error("scientist not found");
    },
    enabled: (authenticated || isConnected) && lookupCandidates.length > 0,
    retry: false,
  });
  const scientistRegistered = !!scientistQ.data && !scientistQ.isError;
  const scientistWalletActual = scientistQ.data?.wallet ?? meWallet;

  // Active season + caller's balance for the header pill.
  const auraQ = useAuraSeason();
  const auraRemaining = auraQ.data?.you?.remaining ?? null;

  return (
    <>
      <div className="bportrait-bg" />

      <section className="bpage">
        <div className="bpage-inner fade-in">
          <div className="pg-head">
            <div>
              <h1>My <em>portfolio</em></h1>
              <p>Your activity across AuraSci — as patron and as scientist.</p>
            </div>
            <div className="aura-pill">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
              </svg>
              <span className="label">Aura boosts</span>
              <span className="val">{auraRemaining ?? "—"}</span>
            </div>
          </div>

          <div className="role-tabs">
            <button className={"role-tab " + (role === "patron" ? "active" : "")} onClick={() => setRole("patron")}>
              <span className="ic">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 3h12l4 6-10 13L2 9z" />
                </svg>
              </span>
              As patron
            </button>
            <button className={"role-tab " + (role === "scientist" ? "active" : "")} onClick={() => setRole("scientist")}>
              <span className="ic">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 2v7.31" /><path d="M14 9.3V1.99" /><path d="M8.5 2h7" /><path d="M14 9.3a6.5 6.5 0 1 1-4 0" />
                </svg>
              </span>
              As scientist
            </button>
          </div>

          {role === "patron" && <PatronPane />}
          {role === "scientist" && (
            !(authenticated || isConnected)
              ? <ConnectPrompt />
              : scientistQ.isLoading
                ? <div style={{ padding: 48, textAlign: "center", color: "var(--mute)", font: "13px JetBrains Mono, monospace" }}>Checking your scientist registration…</div>
                : scientistRegistered
                  ? <ScientistRegistered profile={scientistQ.data as ScientistDto} wallet={scientistWalletActual!} />
                  : <ScientistEmpty />
          )}
        </div>
      </section>

      <style jsx global>{`
        .role-tabs { display: inline-flex; gap: 0; margin-bottom: 28px; padding: 4px; background: #fdfcf8; border: 1px solid var(--line); border-radius: 8px; }
        .role-tab { padding: 9px 20px; border-radius: 6px; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500; color: var(--ink-3); background: transparent; border: none; cursor: pointer; transition: all .2s; display: inline-flex; align-items: center; gap: 8px; }
        .role-tab:hover { color: var(--rust); }
        .role-tab.active { background: var(--ink); color: #faf3e3; }
        .pg-head { margin-bottom: 32px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
        .pg-head h1 { font-family: 'Newsreader', serif; font-weight: 500; font-size: clamp(2rem, 3.6vw, 2.8rem); color: var(--ink); margin: 0 0 8px; letter-spacing: -0.01em; }
        .pg-head h1 em { font-style: italic; color: var(--rust); }
        .pg-head p { font-size: 15px; color: var(--ink-3); margin: 0; max-width: 560px; line-height: 1.6; }
        .aura-pill { display: inline-flex; align-items: center; gap: 10px; padding: 10px 18px; border-radius: 999px; background: rgba(254,215,170,0.30); border: 1px solid rgba(194,65,12,0.3); }
        .aura-pill .label { font-size: 13px; font-weight: 500; color: var(--rust); }
        .aura-pill .val { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: var(--rust); font-size: 18px; }
      `}</style>
    </>
  );
}

// ─── Patron pane ────────────────────────────────────────────────────────

function PatronPane() {
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const { address, isConnected } = useAccount();
  const activity = useActivity({ actor: address?.toLowerCase(), limit: 200 });

  // Pull every intent the wallet has activity on. We could narrow this with a
  // per-id endpoint, but a single intents fetch + client-side join is cheaper
  // when the count is small.
  const allIntents = useIntents({ limit: 100 });

  const { holdings, stats } = useMemo(() => {
    const rows = (activity.data?.items ?? []) as ActivityRow[];
    const deposits = new Map<string, bigint>();
    const refunds  = new Map<string, bigint>();
    for (const r of rows) {
      if (!r.intentId) continue;
      const amount = r.amountUsdc ? BigInt(r.amountUsdc) : 0n;
      if (r.kind === "deposited") deposits.set(r.intentId, (deposits.get(r.intentId) ?? 0n) + amount);
      if (r.kind === "refunded")  refunds.set(r.intentId,  (refunds.get(r.intentId)  ?? 0n) + amount);
    }

    const intentsById = new Map<string, IntentDto>();
    for (const i of allIntents.data?.items ?? []) intentsById.set(i.intentId, i);

    const holdings: Array<{ intent: IntentDto | undefined; intentId: string; net: bigint }> = [];
    for (const [intentId, dep] of deposits) {
      const net = dep - (refunds.get(intentId) ?? 0n);
      if (net <= 0n) continue;
      holdings.push({ intent: intentsById.get(intentId), intentId, net });
    }
    holdings.sort((a, b) => (a.net < b.net ? 1 : -1));

    // Stats
    const totalNet = holdings.reduce((s, h) => s + h.net, 0n);
    const activeStatuses: IntentStatus[] = ["published", "funded", "ai_screening", "submitted"];
    const activeCount = holdings.filter((h) => h.intent && activeStatuses.includes(h.intent.status)).length;
    const milestonesVerified = holdings.reduce(
      (s, h) => s + (h.intent?.milestones.filter((m) => m.status === "released").length ?? 0),
      0,
    );
    const inEscrow = holdings.reduce((s, h) => {
      const i = h.intent;
      if (!i) return s + h.net;
      const remaining = BigInt(i.totalRaisedUsdc) - BigInt(i.totalReleasedUsdc);
      return s + (remaining > 0n ? remaining : 0n) * h.net / (BigInt(i.totalRaisedUsdc) || 1n);
    }, 0n);

    return {
      holdings,
      stats: {
        totalFunded: totalNet,
        activeCount,
        milestonesVerified,
        inEscrow,
      },
    };
  }, [activity.data, allIntents.data]);

  const visibleHoldings = holdings.filter((h) => {
    if (filter === "all") return true;
    if (!h.intent) return filter === "active";
    if (filter === "completed") return h.intent.status === "completed";
    return h.intent.status !== "completed";
  });

  const loading = activity.isLoading || allIntents.isLoading;

  return (
    <div>
      <div className="stats">
        <Stat label="Total funded"        value={isConnected ? fmtUsd(stats.totalFunded) : "—"} />
        <Stat label="Active intents"      value={isConnected ? String(stats.activeCount) : "—"} />
        <Stat label="Milestones verified" value={isConnected ? String(stats.milestonesVerified) : "—"} />
        <Stat label="In escrow"           value={isConnected ? fmtUsd(stats.inEscrow) : "—"} />
      </div>

      <div className="panel-h">
        <h2>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--rust)" }}>
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
          Funded holdings
        </h2>
        <div className="filter-tabs">
          {(["all", "active", "completed"] as const).map((f) => (
            <button key={f} className={"ftab" + (filter === f ? " active" : "")} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="holdings-list">
        {!isConnected && (
          <div style={{ padding: "32px 4px", textAlign: "center", color: "var(--mute)", font: "13px JetBrains Mono, monospace" }}>
            Connect your wallet to see your holdings.
          </div>
        )}
        {isConnected && loading && (
          <div style={{ padding: "32px 4px", textAlign: "center", color: "var(--mute)", font: "13px JetBrains Mono, monospace" }}>
            Loading your holdings…
          </div>
        )}
        {isConnected && !loading && visibleHoldings.length === 0 && (
          <div style={{ padding: "32px 4px", textAlign: "center", color: "var(--mute)", font: "13px JetBrains Mono, monospace" }}>
            No holdings yet. <Link href="/market" style={{ color: "var(--rust)" }}>Browse intents →</Link>
          </div>
        )}
        {isConnected && !loading && visibleHoldings.map((h) => (
          <HoldingRow key={h.intentId} h={h} />
        ))}
      </div>

      <AuraAllocation />
      <AuraRecentSpends />

      <style jsx>{`
        .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; margin-bottom: 40px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 20px 0; }
        @media (max-width: 900px) { .stats { grid-template-columns: repeat(2, 1fr); gap: 20px 0; } }

        .panel-h { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; flex-wrap: wrap; gap: 12px; margin-top: 8px; }
        .panel-h h2 { font-family: 'Newsreader', serif; font-weight: 500; font-size: 24px; color: var(--ink); margin: 0; display: flex; align-items: center; gap: 10px; letter-spacing: -0.01em; }
        .filter-tabs { display: flex; gap: 8px; }
        .filter-tabs :global(.ftab) { padding: 7px 14px; border-radius: 999px; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500; background: #fdfcf8; border: 1px solid var(--line); color: var(--ink-3); cursor: pointer; transition: all .2s; }
        .filter-tabs :global(.ftab:hover) { border-color: var(--rust); color: var(--rust); }
        .filter-tabs :global(.ftab.active) { background: var(--ink); border-color: var(--ink); color: #faf3e3; }

        .holdings-list { border: 1px solid var(--line); border-radius: 8px; background: #fdfcf8; padding: 6px 22px; position: relative; }
        .holdings-list::before, .holdings-list::after { content: ''; position: absolute; width: 14px; height: 14px; border: 1.5px solid var(--rust); opacity: .5; }
        .holdings-list::before { top: -1px; left: -1px; border-right: none; border-bottom: none; }
        .holdings-list::after { bottom: -1px; right: -1px; border-left: none; border-top: none; }

        .aura-section { margin-top: 48px; padding: 26px; border-radius: 6px; background: rgba(254,215,170,0.25); border: 1px solid rgba(194,65,12,0.3); }
        .aura-section h2 { font-family: 'Newsreader', serif; font-weight: 500; font-size: 22px; color: var(--ink); margin: 0 0 8px; display: flex; align-items: center; gap: 10px; letter-spacing: -0.01em; }
        .aura-section p { font-size: 14px; color: var(--ink-3); margin: 0 0 18px; line-height: 1.6; }
        .aura-bar-wrap { background: #fdfcf8; border-radius: 999px; height: 12px; overflow: hidden; border: 1px solid var(--line); position: relative; }
        .aura-bar-fill { height: 100%; background: linear-gradient(to right, var(--rust), #fb923c); border-radius: 999px; }
        .aura-meta { display: flex; justify-content: space-between; font-size: 13px; color: var(--mute); margin-top: 10px; flex-wrap: wrap; gap: 8px; }
        .aura-meta :global(strong) { color: var(--rust); font-family: 'JetBrains Mono', monospace; font-weight: 700; }
      `}</style>
    </div>
  );
}

// ─── Aura allocation card (real data) ──────────────────────────────────

function AuraAllocation() {
  const { isConnected } = useAccount();
  const auraQ = useAuraSeason();
  const data = auraQ.data;

  if (!isConnected || !data) {
    return (
      <div style={{
        marginTop: 48, padding: 26, borderRadius: 6,
        background: "rgba(254,215,170,0.25)", border: "1px solid rgba(194,65,12,0.3)",
        font: "13px JetBrains Mono, monospace", color: "var(--mute)", textAlign: "center",
      }}>
        {isConnected ? "Loading Aura season…" : "Connect wallet to see your Aura allocation."}
      </div>
    );
  }
  const you = data.you;
  const total = you?.total ?? data.season.budgetPerPatron;
  const used  = you?.used ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const endsIn = humanizeDelta(new Date(data.season.endsAt).getTime() - Date.now());

  return (
    <div style={{
      marginTop: 48, padding: 26, borderRadius: 6,
      background: "rgba(254,215,170,0.25)", border: "1px solid rgba(194,65,12,0.3)",
    }}>
      <h2 style={{ font: "500 22px Newsreader, serif", margin: "0 0 8px", color: "var(--ink)", display: "flex", alignItems: "center", gap: 10, letterSpacing: "-0.01em" }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--rust)" }}>
          <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
        </svg>
        Aura allocation · {data.season.name}
      </h2>
      <p style={{ font: "14px Inter, sans-serif", color: "var(--ink-3)", margin: "0 0 18px", lineHeight: 1.6 }}>
        You've used <b>{used}</b> of <b>{total}</b> Aura boosts this season
        {you && you.bonus > 0 && <> (including <b>+{you.bonus}</b> earned from milestone yield)</>}.
        Aura amplifies a project's leaderboard rank.
      </p>
      <div style={{ background: "#fdfcf8", borderRadius: 999, height: 12, overflow: "hidden", border: "1px solid var(--line)" }}>
        <div style={{ height: "100%", width: pct + "%", background: "linear-gradient(to right, var(--rust), #fb923c)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", font: "13px Inter, sans-serif", color: "var(--mute)", marginTop: 10, flexWrap: "wrap", gap: 8 }}>
        <span>Used · <b style={{ color: "var(--rust)", font: "700 13px JetBrains Mono, monospace" }}>{used}</b></span>
        <span>Remaining · <b style={{ color: "var(--rust)", font: "700 13px JetBrains Mono, monospace" }}>{you?.remaining ?? total}</b></span>
        <span>Resets in · <b style={{ color: "var(--rust)", font: "700 13px JetBrains Mono, monospace" }}>{endsIn}</b></span>
      </div>
    </div>
  );
}

function AuraRecentSpends() {
  const { isConnected } = useAccount();
  const spendsQ = useAuraSpends();
  const items = spendsQ.data?.items ?? [];
  if (!isConnected || items.length === 0) return null;
  return (
    <div style={{ marginTop: 24 }}>
      <h2 style={{ font: "500 18px Newsreader, serif", margin: "0 0 10px", color: "var(--ink)", letterSpacing: "-0.01em" }}>
        Recent boosts
      </h2>
      <div style={{ border: "1px solid var(--line)", borderRadius: 8, background: "#fdfcf8", overflow: "hidden" }}>
        {items.slice(0, 6).map((s) => (
          <Link
            key={s.id}
            href={`/intent/${s.intentId}`}
            style={{
              display: "grid", gridTemplateColumns: "1fr auto auto", gap: 14, padding: "12px 16px",
              borderBottom: "1px solid var(--line)", textDecoration: "none", color: "inherit", alignItems: "center",
            }}
          >
            <div>
              <div style={{ font: "600 13px Inter, sans-serif", color: "var(--ink)" }}>{s.intent?.title ?? s.intentId.slice(0, 14) + "…"}</div>
              <div style={{ font: "11px JetBrains Mono, monospace", color: "var(--mute)" }}>{s.intent?.ticker ?? ""}</div>
            </div>
            <div style={{ font: "600 14px JetBrains Mono, monospace", color: "var(--rust)" }}>+{s.amount}</div>
            <div style={{ font: "11px JetBrains Mono, monospace", color: "var(--mute)" }}>{new Date(s.createdAt).toLocaleDateString()}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function humanizeDelta(ms: number): string {
  if (ms <= 0) return "ended";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  if (d > 0) return `${d}d ${h.toString().padStart(2, "0")}h`;
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <style jsx>{`
        .stat-card { padding: 0 24px; border-right: 1px solid var(--line); }
        .stat-card:last-child { border-right: none; }
        @media (max-width: 900px) {
          .stat-card { border-right: none; padding: 0 16px; }
          .stat-card:nth-child(odd) { border-right: 1px solid var(--line); }
        }
        .stat-label { font-size: 11px; color: var(--mute); font-weight: 500; margin-bottom: 8px; font-family: 'JetBrains Mono', monospace; letter-spacing: .08em; text-transform: uppercase; }
        .stat-value { font-family: 'Newsreader', serif; font-weight: 500; font-size: 28px; color: var(--ink); letter-spacing: -0.02em; line-height: 1; }
      `}</style>
    </div>
  );
}

function HoldingRow({ h }: { h: { intent: IntentDto | undefined; intentId: string; net: bigint } }) {
  const intent = h.intent;
  const badge = intent ? badgeFromStatus(intent) : { label: "intent metadata pending", kind: "" as const };
  const tl = timelineFromIntent(intent);
  const boost = useAuraBoost();
  const seasonQ = useAuraSeason();
  const toast = useToast();

  // Fixed +5 step matches the Aura heat card on the intent detail page so
  // patrons see one consistent "Boost" affordance no matter which surface
  // they're on. Disable when there's no active season, when the user has
  // already spent down their season budget, or while a tx is in flight.
  const STEP = 5;
  const remaining = seasonQ.data?.you?.remaining ?? 0;
  const canBoost = Boolean(seasonQ.data) && remaining >= STEP && !boost.isPending;

  async function doBoost() {
    if (!seasonQ.data) {
      toast.push({ text: "No active Aura season — Boost is paused.", tone: "err" });
      return;
    }
    if (remaining < STEP) {
      toast.push({ text: `Not enough Aura left this season (need ${STEP}).`, tone: "err" });
      return;
    }
    try {
      const res = await boost.mutateAsync({ intentId: h.intentId as `0x${string}`, amount: STEP });
      toast.push({ text: `✦ Boosted +${STEP} Aura · heat now ${res.heat}`, tone: "ok" });
    } catch (e: any) {
      toast.push({ text: e?.message ?? "boost failed", tone: "err" });
    }
  }
  const nextMilestone = intent?.milestones.find((m) => m.status === "in_progress" || m.status === "proof_submitted" || m.status === "ai_verifying");
  const nextLine = intent?.status === "rejected"
    ? "Refund available"
    : intent?.status === "completed"
      ? "All milestones released"
      : nextMilestone
        // 1-indexed M-number so it matches the rail on the intent detail page.
        ? `Next release · ${fmtUsd(nextMilestone.releaseAmountUsdc)} on M${nextMilestone.idx + 1}`
        : "Awaiting M0 quorum";

  return (
    <div className="holding">
      <div className="holding-row">
        <div className="holding-left">
          <div className="ticker-row">
            <span className="ticker">{intent?.ticker ?? h.intentId.slice(0, 10) + "…"}</span>
            <span className={"badge-mini " + badge.kind}>{badge.label}</span>
            <span className="scientist">
              {intent?.scientist?.displayName ?? "—"}
              {intent?.scientist?.affiliation ? ` · ${intent.scientist.affiliation}` : ""}
            </span>
          </div>
          <div className="title">{intent?.title ?? "Intent metadata not loaded"}</div>
          <div className="mini-timeline">
            {tl.map((s, i) => <div key={i} className={"mt-dot " + s} />)}
          </div>
        </div>
        <div className="holding-right">
          <div className="funded-amt">{fmtUsd(h.net)}</div>
          <div className="funded-label">Your patronage</div>
          <div className="next-release">{nextLine}</div>
          <div className="holding-actions">
            <Link className="holding-btn" href={`/intent/${h.intentId}`}>Details</Link>
            <button
              className="holding-btn primary"
              onClick={doBoost}
              disabled={!canBoost}
              title={!seasonQ.data ? "No active Aura season" : remaining < STEP ? "Out of Aura this season" : undefined}
            >
              {boost.isPending ? "Boosting…" : `Boost +${STEP}`}
            </button>
          </div>
        </div>
      </div>

      {/* Using `global` so styles also reach <Link>-rendered <a> elements
          (e.g. the "Details" button) — styled-jsx scope class is only
          attached to host elements declared in this render, not React
          components like next/link's <Link>. */}
      <style jsx global>{`
        .holding { padding: 22px 0; border-bottom: 1px solid var(--line); transition: background .2s; }
        .holding:last-child { border-bottom: none; }
        .holding:hover .ticker { color: var(--rust); }
        .holding-row { display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: center; }
        @media (max-width: 800px) { .holding-row { grid-template-columns: 1fr; } }

        .holding-left .ticker-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
        .holding-left .ticker { font-family: 'JetBrains Mono', monospace; font-size: 18px; font-weight: 600; color: var(--ink); }
        .holding-left .scientist { font-size: 13px; color: var(--mute); }
        .holding-left .title { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 15px; color: var(--ink-2); margin: 6px 0 14px; line-height: 1.4; }
        .badge-mini { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500; }
        .badge-mini.active { background: rgba(254,215,170,0.30); color: var(--rust); border: 1px solid rgba(194,65,12,0.3); }
        .badge-mini.done { background: rgba(101,163,13,0.10); color: #4d7c0f; border: 1px solid rgba(101,163,13,0.35); }

        .mini-timeline { display: flex; align-items: center; gap: 6px; max-width: 360px; }
        .mt-dot { flex: 1; height: 6px; border-radius: 3px; background: rgba(58,36,24,0.12); position: relative; }
        .mt-dot.done { background: #65a30d; }
        .mt-dot.active { background: linear-gradient(to right, #fb923c, var(--rust)); }
        .mt-dot.active::after { content: ''; position: absolute; right: 0; top: -2px; width: 10px; height: 10px; border-radius: 50%; background: var(--rust); box-shadow: 0 0 8px rgba(194,65,12,0.5); }

        .holding-right { text-align: right; min-width: 200px; }
        .funded-amt { font-family: 'Newsreader', serif; font-weight: 500; font-size: 24px; color: var(--ink); letter-spacing: -0.01em; }
        .funded-label { font-size: 12px; color: var(--mute); margin-top: 2px; }
        .next-release { font-size: 13px; color: var(--rust); margin-top: 8px; font-weight: 500; }
        .holding-actions { margin-top: 14px; display: flex; gap: 8px; justify-content: flex-end; }
        .holding-btn { padding: 7px 14px; border-radius: 6px; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500; background: #faf3e3; border: 1px solid var(--line); color: var(--ink-2); cursor: pointer; transition: all .2s; text-decoration: none; display: inline-block; }
        .holding-btn:hover { border-color: var(--rust); color: var(--rust); }
        .holding-btn.primary { background: var(--rust); border-color: var(--rust); color: #faf3e3; }
        .holding-btn.primary:hover { background: var(--rust-2, #9a3412); }
      `}</style>
    </div>
  );
}

// ─── Scientist pane: empty ──────────────────────────────────────────────

function ConnectPrompt() {
  return (
    <div style={{ padding: 48, textAlign: "center", border: "1px dashed rgba(58,36,24,0.3)", borderRadius: 8, background: "#fdfcf8" }}>
      <div style={{ font: "13px JetBrains Mono, monospace", color: "var(--mute)" }}>
        Connect your wallet to view your scientist profile.
      </div>
    </div>
  );
}

function ScientistEmpty() {
  return (
    <div className="sci-empty">
      <div className="icon-wrap">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 2v7.31" /><path d="M14 9.3V1.99" /><path d="M8.5 2h7" /><path d="M14 9.3a6.5 6.5 0 1 1-4 0" />
        </svg>
      </div>
      <h3>You're not yet a <em>scientist</em>.</h3>
      <p>Establish your research identity to publish intent assets, set milestones, and receive milestone-based patronage.</p>
      <div className="perks">
        <span>Publish intents</span>
        <span>AI-verified milestones</span>
        <span>Capital flows</span>
      </div>
      <Link className="sci-onboard-cta" href="/onboard">
        Onboard as scientist <span className="arr">↗</span>
      </Link>

      <style jsx>{`
        .sci-empty { padding: 48px 32px; border-radius: 8px; border: 1px dashed rgba(58,36,24,0.3); background: #fdfcf8; text-align: center; position: relative; }
        .sci-empty::before, .sci-empty::after { content: ''; position: absolute; width: 18px; height: 18px; border: 1.5px solid var(--rust); opacity: .5; }
        .sci-empty::before { top: -1px; left: -1px; border-right: none; border-bottom: none; }
        .sci-empty::after { bottom: -1px; right: -1px; border-left: none; border-top: none; }
        .icon-wrap { width: 64px; height: 64px; border-radius: 50%; background: rgba(254,215,170,0.40); color: var(--rust); display: flex; align-items: center; justify-content: center; margin: 0 auto 18px; }
        h3 { font-family: 'Newsreader', serif; font-weight: 500; font-size: 24px; color: var(--ink); margin: 0 0 10px; letter-spacing: -0.01em; }
        h3 :global(em) { font-style: italic; color: var(--rust); }
        p { font-size: 14px; color: var(--ink-3); margin: 0 auto 22px; max-width: 440px; line-height: 1.6; }
        .perks { display: flex; justify-content: center; gap: 24px; flex-wrap: wrap; margin-bottom: 26px; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: .08em; color: var(--mute); text-transform: uppercase; }
        .perks :global(span) { display: inline-flex; align-items: center; gap: 6px; }
        .perks :global(span::before) { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--rust); }
        .sci-onboard-cta { display: inline-flex; align-items: center; gap: 10px; padding: 14px 26px; border-radius: 6px; background: var(--ink); color: #faf3e3; font-family: 'Inter', sans-serif; font-weight: 500; font-size: 14px; letter-spacing: .04em; text-decoration: none; transition: all .2s; }
        .sci-onboard-cta:hover { background: var(--rust); }
        .sci-onboard-cta .arr { font-family: 'JetBrains Mono', monospace; }
      `}</style>
    </div>
  );
}

// ─── Scientist pane: registered ─────────────────────────────────────────

function ScientistRegistered({ profile, wallet }: { profile: ScientistDto; wallet: string }) {
  const myIntents = useIntents({ scientist: wallet.toLowerCase(), limit: 50 });
  const intents = myIntents.data?.items ?? [];
  const totalRaised = intents.reduce((s, i) => s + BigInt(i.totalRaisedUsdc), 0n);
  return (
    <div>
      <div className="sci-card">
        <div className="sci-card-h">
          <h2>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--rust)" }}>
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            Profile
          </h2>
          <span className="sci-status">Verified</span>
        </div>
        <div className="sci-profile-grid">
          <Field lbl="Display name" val={profile.displayName} />
          <Field lbl="Wallet"       val={wallet.slice(0, 6) + "…" + wallet.slice(-4)} mono />
          <Field lbl="Affiliation"  val={profile.affiliation ?? "—"} />
          <Field lbl="Joined"       val={new Date(profile.createdAt).toISOString().slice(0, 10)} mono />
          <div className="sci-field bio-block">
            <div className="lbl">Research bio</div>
            <div className="val">{profile.bio ?? "(no bio yet — edit on /onboard)"}</div>
          </div>
        </div>
      </div>

      <div className="sci-card">
        <div className="sci-card-h">
          <h2>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--rust)" }}>
              <path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" />
            </svg>
            Research Identity Profile
          </h2>
          <span className="sci-status">Connected</span>
        </div>
        <div className="identity-grid">
          <IdCard
            kind="orcid"
            a="ORCID"
            b={profile.orcid ?? "—"}
            tag={profile.orcidVerified ? "verified" : null}
          />
          <IdCard
            kind="github"
            a="GitHub"
            b={profile.githubHandle ? `@${profile.githubHandle}` : "Not linked"}
            muted={!profile.githubHandle}
          />
          <IdCard
            kind="wallet"
            a="Wallet"
            b={wallet.slice(0, 6) + "…" + wallet.slice(-4)}
          />
          <IdCard
            kind="reputation"
            a="Reputation"
            b={String(profile.reputation) + " pts"}
          />
        </div>
        <div className="sci-metrics">
          <Metric v={String(intents.length)} l="Active intents" />
          <Metric v={fmtUsd(totalRaised)} l="Raised lifetime" />
          <Metric v={String(profile.milestonesVerified)} l="Milestones verified" />
        </div>
        <div className="sci-actions">
          <Link className="sci-btn" href="/scientist">Open scientist dashboard <span>↗</span></Link>
          <Link className="sci-btn primary" href="/create">Create intent <span>↗</span></Link>
        </div>
      </div>

      <div className="panel-h">
        <h2>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--rust)" }}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="9" y1="15" x2="15" y2="15" />
            <line x1="9" y1="11" x2="15" y2="11" />
          </svg>
          Published intents
        </h2>
        <div className="filter-tabs">
          <button className="ftab active">All</button>
          <button className="ftab">Active</button>
          <button className="ftab">Draft</button>
        </div>
      </div>

      <div className="sci-intents">
        {myIntents.isLoading && (
          <div style={{ padding: 28, textAlign: "center", color: "var(--mute)", font: "13px JetBrains Mono, monospace" }}>
            Loading your intents…
          </div>
        )}
        {!myIntents.isLoading && intents.length === 0 && (
          <div style={{ padding: 28, textAlign: "center", color: "var(--mute)", font: "13px JetBrains Mono, monospace" }}>
            No intents published yet. <Link href="/create" style={{ color: "var(--rust)" }}>Create one →</Link>
          </div>
        )}
        {intents.map((p) => {
          const released = p.milestones.filter((m) => m.status === "released").length;
          const raised = Number(BigInt(p.totalRaisedUsdc)) / 1e6;
          const goal   = Number(BigInt(p.fundingGoalUsdc)) / 1e6;
          const pct = goal > 0 ? Math.round((raised / goal) * 100) : 0;
          const badge = badgeFromStatus(p);
          return (
            <Link className="sci-intent" key={p.intentId} href={`/intent/${p.intentId}`}>
              <div className="left">
                <div className="ttl-row">
                  <span className="tk">{p.ticker}</span>
                  <span className={"badge " + badge.kind}>{badge.label}</span>
                </div>
                <div className="ttl">{p.title}</div>
                <div className="meta">
                  <span>Status · {p.status}</span>
                  <span>{released} milestone{released === 1 ? "" : "s"} verified</span>
                </div>
              </div>
              <div className="right">
                <div className="amt">${raised.toLocaleString()}</div>
                <div className="lbl">Raised / ${goal >= 1000 ? (goal / 1000).toFixed(0) + "k" : goal} goal</div>
                <div className="progress"><span style={{ width: pct + "%" }} /></div>
                <div className="pct">{pct}% funded</div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* global so styles reach <Link>-rendered <a> elements (sci-btn,
          sci-intent) — styled-jsx scope class is only attached to host
          elements declared in this render. */}
      <style jsx global>{`
        .sci-card { padding: 26px; border-radius: 8px; border: 1px solid var(--line); background: #fdfcf8; margin-bottom: 18px; position: relative; }
        .sci-card::before, .sci-card::after { content: ''; position: absolute; width: 14px; height: 14px; border: 1.5px solid var(--rust); opacity: .5; }
        .sci-card::before { top: -1px; left: -1px; border-right: none; border-bottom: none; }
        .sci-card::after { bottom: -1px; right: -1px; border-left: none; border-top: none; }
        .sci-card-h { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; flex-wrap: wrap; gap: 12px; }
        .sci-card-h h2 { font-family: 'Newsreader', serif; font-weight: 500; font-size: 22px; color: var(--ink); margin: 0; display: flex; align-items: center; gap: 10px; letter-spacing: -0.01em; }
        .sci-status { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; background: rgba(101,163,13,0.10); border: 1px solid rgba(101,163,13,0.35); font-size: 12px; font-weight: 500; color: #4d7c0f; font-family: 'JetBrains Mono', monospace; letter-spacing: .05em; }
        .sci-status::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #65a30d; box-shadow: 0 0 0 3px rgba(101,163,13,0.2); }

        .sci-profile-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px 28px; }
        @media (max-width: 680px) { .sci-profile-grid { grid-template-columns: 1fr; } }
        .sci-field .lbl { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 500; color: var(--mute); letter-spacing: .12em; text-transform: uppercase; margin-bottom: 6px; }
        .sci-field .val { font-family: 'Inter', sans-serif; font-size: 15px; color: var(--ink); font-weight: 500; }
        .sci-field .val.mono { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 500; }

        .bio-block { grid-column: 1/-1; padding-top: 8px; border-top: 1px dashed rgba(58,36,24,0.18); margin-top: 6px; }
        .bio-block .val { font-size: 14px; line-height: 1.7; color: var(--ink-2); font-weight: 400; }

        .identity-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 6px; }
        @media (max-width: 680px) { .identity-grid { grid-template-columns: 1fr; } }

        .sci-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 18px; }
        @media (max-width: 600px) { .sci-metrics { grid-template-columns: repeat(3, 1fr); gap: 8px; } }

        .sci-actions { display: flex; gap: 10px; margin-top: 18px; flex-wrap: wrap; }
        .sci-btn { padding: 10px 18px; border-radius: 6px; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500; background: #faf3e3; border: 1px solid var(--line); color: var(--ink-2); cursor: pointer; transition: all .2s; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
        .sci-btn:hover { border-color: var(--rust); color: var(--rust); }
        .sci-btn.primary { background: var(--rust); border-color: var(--rust); color: #faf3e3; }
        .sci-btn.primary:hover { background: var(--rust-2, #9a3412); color: #faf3e3; }

        .panel-h { display: flex; align-items: center; justify-content: space-between; margin: 32px 0 18px; flex-wrap: wrap; gap: 12px; }
        .panel-h h2 { font-family: 'Newsreader', serif; font-weight: 500; font-size: 24px; color: var(--ink); margin: 0; display: flex; align-items: center; gap: 10px; letter-spacing: -0.01em; }
        .filter-tabs { display: flex; gap: 8px; }
        .filter-tabs .ftab { padding: 7px 14px; border-radius: 999px; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500; background: #fdfcf8; border: 1px solid var(--line); color: var(--ink-3); cursor: pointer; transition: all .2s; }
        .filter-tabs .ftab.active { background: var(--ink); border-color: var(--ink); color: #faf3e3; }

        .sci-intents { display: flex; flex-direction: column; gap: 12px; margin-top: 8px; }
        .sci-intent { padding: 18px 20px; border-radius: 6px; border: 1px solid var(--line); background: #fdfcf8; display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; flex-wrap: wrap; transition: all .2s; text-decoration: none; color: inherit; }
        .sci-intent:hover { border-color: var(--rust); box-shadow: 0 8px 18px rgba(154,52,18,0.06); transform: translateY(-1px); }
        .sci-intent .left { flex: 1; min-width: 240px; }
        .sci-intent .ttl-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
        .sci-intent .tk { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600; color: var(--rust); letter-spacing: .04em; }
        .sci-intent .badge { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 500; letter-spacing: .10em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; background: rgba(254,215,170,0.30); color: var(--rust); border: 1px solid rgba(194,65,12,0.30); }
        .sci-intent .badge.done { background: rgba(101,163,13,0.10); color: #4d7c0f; border-color: rgba(101,163,13,0.35); }
        .sci-intent .ttl { font-family: 'Newsreader', serif; font-weight: 500; font-size: 17px; color: var(--ink); letter-spacing: -0.005em; line-height: 1.35; }
        .sci-intent .meta { margin-top: 6px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); letter-spacing: .04em; display: flex; gap: 14px; flex-wrap: wrap; }
        .sci-intent .right { text-align: right; min-width: 160px; }
        .sci-intent .right .amt { font-family: 'Newsreader', serif; font-weight: 500; font-size: 22px; color: var(--ink); letter-spacing: -0.01em; line-height: 1; }
        .sci-intent .right .lbl { font-size: 11px; color: var(--mute); font-family: 'JetBrains Mono', monospace; letter-spacing: .06em; text-transform: uppercase; margin-top: 4px; }
        .sci-intent .right .progress { margin-top: 10px; height: 6px; border-radius: 999px; background: rgba(58,36,24,0.08); overflow: hidden; }
        .sci-intent .right .progress span { display: block; height: 100%; background: linear-gradient(to right, var(--rust), #fb923c); }
        .sci-intent .right .pct { margin-top: 6px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--rust); font-weight: 600; }
      `}</style>
    </div>
  );
}

function Field({ lbl, val, mono }: { lbl: string; val: string; mono?: boolean }) {
  return (
    <div className="sci-field">
      <div className="lbl">{lbl}</div>
      <div className={"val" + (mono ? " mono" : "")}>{val}</div>
    </div>
  );
}

type IdCardKind = "orcid" | "github" | "wallet" | "reputation";

function IdIcon({ kind }: { kind: IdCardKind }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "orcid") {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="7" />
        <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
      </svg>
    );
  }
  if (kind === "github") {
    return (
      <svg {...common}>
        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
      </svg>
    );
  }
  if (kind === "wallet") {
    return (
      <svg {...common}>
        <rect x="2" y="6" width="20" height="13" rx="2" />
        <path d="M2 10h20" />
        <path d="M16 15h2" />
      </svg>
    );
  }
  // reputation — trophy
  return (
    <svg {...common}>
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
      <path d="M17 4h3v2a3 3 0 0 1-3 3" />
      <path d="M7 4H4v2a3 3 0 0 0 3 3" />
    </svg>
  );
}

function IdCard({ a, b, kind, tag, muted }: {
  a: string;
  b: string;
  kind: IdCardKind;
  tag?: string | null;
  muted?: boolean;
}) {
  return (
    <div className="id-card">
      <div className="ic"><IdIcon kind={kind} /></div>
      <div className="meta">
        <div className="a">
          {a}
          {tag && <span className="tag">· {tag}</span>}
        </div>
        <div className={"b" + (muted ? " muted" : "")}>{b}</div>
      </div>
      {/* global so subcomponent styles also flow from the parent's rules */}
      <style jsx global>{`
        .id-card { padding: 16px 18px; border-radius: 6px; border: 1px solid var(--line); background: #faf3e3; display: flex; align-items: center; gap: 14px; }
        .id-card .ic { width: 42px; height: 42px; border-radius: 8px; background: rgba(254,215,170,0.40); color: var(--rust); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .id-card .meta .a { font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 2px; }
        .id-card .meta .a .tag { color: #4d7c0f; font-weight: 500; margin-left: 4px; font-size: 12px; }
        .id-card .meta .b { font-size: 12px; color: var(--ink-2); font-family: 'JetBrains Mono', monospace; word-break: break-all; }
        .id-card .meta .b.muted { color: var(--mute); }
      `}</style>
    </div>
  );
}

function Metric({ v, l }: { v: string; l: string }) {
  return (
    <div className="sci-metric">
      <div className="v">{v}</div>
      <div className="l">{l}</div>
      <style jsx global>{`
        .sci-metric { padding: 14px; border-radius: 6px; background: #faf3e3; border: 1px solid var(--line); text-align: center; }
        .sci-metric .v { font-family: 'Newsreader', serif; font-weight: 500; font-size: 24px; color: var(--ink); letter-spacing: -0.01em; line-height: 1; }
        .sci-metric .l { font-size: 11px; color: var(--mute); margin-top: 6px; font-family: 'JetBrains Mono', monospace; letter-spacing: .06em; text-transform: uppercase; }
      `}</style>
    </div>
  );
}
