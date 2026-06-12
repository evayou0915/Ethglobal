"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/client/auth";
import { useSignInModal } from "@/client/sign-in-store";
import { useActivity, useAuraLeaderboard, useIntents } from "@/client/hooks";
import type { IntentDto, ActivityRow } from "@/types/api";

// ─── Display helpers ────────────────────────────────────────────────────

const usdcWhole = (raw: string | bigint) =>
  Number(typeof raw === "bigint" ? raw : BigInt(raw)) / 1e6;

const initialsOf = (name: string | null | undefined) => {
  if (!name) return "??";
  const parts = name.replace(/^Dr\.?\s+/i, "").split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? "??").slice(0, 2).toUpperCase();
};

const shortAddr = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
const tickerOf = (a: string) => "@" + a.slice(2, 8);

function formatActivity(row: ActivityRow): { ts: string; tone: "rust" | "em" | ""; msg: string } {
  const ts = new Date(row.createdAt).toTimeString().slice(0, 8);
  const who = row.actorWallet ? shortAddr(row.actorWallet) : "—";
  const intent = row.intentId ? tickerOf(row.intentId) : "intent";
  const usd = row.amountUsdc ? usdcWhole(row.amountUsdc).toLocaleString() : "";
  switch (row.kind) {
    case "deposited":
      return { ts, tone: "rust", msg: `${who} funded ${usd} USDC → ${intent}` };
    case "milestone_verified":
      return { ts, tone: "em", msg: `Gatekeeper verified ${intent} M${row.milestoneIdx ?? "?"}` };
    case "proof_submitted":
      return { ts, tone: "", msg: `Proof submitted for ${intent} M${row.milestoneIdx ?? "?"}` };
    case "intent_published":
      return { ts, tone: "", msg: `New intent ${intent} published` };
    case "refunded":
      return { ts, tone: "rust", msg: `${who} refunded ${usd} USDC ← ${intent}` };
  }
}

const FILTER_GROUPS = {
  category: ["all", "longevity", "neuro", "genomics", "ai-bio", "climate", "materials"],
  stage:    ["any", "fundraising", "in-progress", "completed"],
  tier:     ["all", "1", "2", "3"],
};
const FILTER_LABELS: Record<string, string> = {
  all: "All", longevity: "Longevity", neuro: "Neuroscience", genomics: "Genomics",
  "ai-bio": "AI-Bio", climate: "Climate", materials: "Materials",
  any: "Any", fundraising: "Fundraising", "in-progress": "In progress", completed: "Completed",
  "1": "Tier 1", "2": "Tier 2", "3": "Tier 3",
};

// ─── Page ───────────────────────────────────────────────────────────────

export default function MarketPage() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filters, setFilters] = useState({ category: "all", stage: "any", tier: "all", score: 70 });
  const [scoreLive, setScoreLive] = useState(70);
  const [hasActiveFilters, setHasActiveFilters] = useState(false);

  // Login state for gating scientist-side CTAs ("Publish intent",
  // "Onboard as scientist"). Browsing the market itself stays public.
  const { authenticated } = useAuth();
  const openSignIn = useSignInModal((s) => s.open);
  const requireAuth = (href: string) => (e: React.MouseEvent) => {
    if (authenticated) return;            // let the <Link> navigate normally
    e.preventDefault();
    try { sessionStorage.setItem("aurasci_post_login", href); } catch { /* ignore */ }
    openSignIn();
  };

  // Live data
  const intentsQ = useIntents({ limit: 50 });
  const auraLb   = useAuraLeaderboard(3);
  const liveQ    = useActivity({ limit: 8 });

  // Client-side filtering (filters work on whatever `useIntents` returned).
  const filtered = useMemo(() => {
    const items = intentsQ.data?.items ?? [];
    return items.filter((i) => {
      if (filters.category !== "all" && i.category.toLowerCase() !== filters.category) return false;
      if (filters.score && (i.aiGatekeeperScore ?? 0) < filters.score) return false;
      if (filters.stage !== "any") {
        if (filters.stage === "fundraising" && i.status !== "published") return false;
        if (filters.stage === "in-progress" && i.status !== "funded") return false;
        if (filters.stage === "completed" && i.status !== "completed") return false;
      }
      return true;
    });
  }, [intentsQ.data, filters]);

  // Honor ?signin=open via a Suspense-wrapped child (Next 14 requires
  // useSearchParams readers to live under a <Suspense> boundary so the
  // page can still prerender statically).

  const isFiltered = (state: typeof filters) =>
    state.category !== "all" || state.stage !== "any" || state.tier !== "all" || state.score !== 70;

  const apply = () => {
    setFilters((f) => ({ ...f, score: scoreLive }));
    setHasActiveFilters(isFiltered({ ...filters, score: scoreLive }));
    setDrawerOpen(false);
  };
  const reset = () => {
    setFilters({ category: "all", stage: "any", tier: "all", score: 70 });
    setScoreLive(70);
    setHasActiveFilters(false);
  };

  return (
    <>
      <Suspense fallback={null}><SignInLauncher /></Suspense>
      <div className="bportrait-bg" />

      <section className="bpage">
        <div className="bpage-inner fade-in">
          <div className="bhead" style={{ textAlign: "center", marginBottom: 32 }}>
            <span className="btag">vol. 094 / research market</span>
            <h1>Discover <span className="em">AI-verified</span><br />research</h1>
            <p className="sub" style={{ margin: "14px auto 0" }}>
              Browse milestone-based research intents screened by the Gatekeeper.<br />
              Provide patronage to promising open science.
            </p>
          </div>

          <div className="layout">
            <div>
              <div className="search-row">
                <input className="binput" type="text" placeholder="Search intents — tickers, keywords, scientists…" />
                <button
                  className={"bbtn bbtn-ghost filter-btn" + (hasActiveFilters ? " has-active" : "")}
                  onClick={() => setDrawerOpen(true)}
                >
                  <span>Filters</span>
                  <span className="dot" />
                </button>
              </div>

              <div className="sort-row">
                <span className="count">
                  {intentsQ.isLoading ? "Loading…" : `${filtered.length} active intents`}
                  {hasActiveFilters && <span style={{ color: "var(--rust)", marginLeft: 10 }}>· filtered</span>}
                </span>
                <select defaultValue="Sort by AI score">
                  <option>Sort by AI score</option>
                  <option>Most funded</option>
                  <option>Newest</option>
                  <option>Trending</option>
                </select>
              </div>

              <div className="grid">
                {filtered.map((i) => <IntentCard key={i.intentId} i={i} />)}

                <article className="bcard icard empty-card">
                  <div className="head">
                    <div>
                      <div className="ticker" style={{ color: "var(--mute)" }}>$ ——</div>
                      <div className="ai" style={{ color: "var(--mute)" }}>Open slot</div>
                    </div>
                  </div>
                  <h3 style={{ color: "var(--mute)" }}>Your intent could be here.</h3>
                  <p style={{ fontSize: 14, color: "var(--mute)", margin: 0, lineHeight: 1.6 }}>
                    Have a breakthrough proposal? Publish a milestone-based intent and let the network fund you.
                  </p>
                  <Link
                    className="bbtn bbtn-ghost"
                    href="/create"
                    style={{ marginTop: "auto", alignSelf: "flex-start" }}
                    onClick={requireAuth("/create")}
                  >
                    Publish intent <span className="arrow">→</span>
                  </Link>
                </article>
              </div>

              <div className="bottom-cta">
                <p>Are you a scientist with breakthrough research?</p>
                <Link
                  className="bbtn bbtn-primary"
                  href="/onboard"
                  onClick={requireAuth("/onboard")}
                >
                  Onboard as scientist <span className="arrow">→</span>
                </Link>
              </div>
            </div>

            {/* Sidebar */}
            <aside className="sb">
              <div className="sb-block">
                <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
                <div className="num">§ 01 — leaderboard</div>
                <h4>Season ranking</h4>
                <div className="sub">Ranked by Aura boost score</div>

                {(auraLb.data?.items ?? []).length === 0 && (
                  <div style={{ padding: "16px 0", textAlign: "center", color: "var(--mute)", font: "12px JetBrains Mono, monospace" }}>
                    {auraLb.isLoading ? "Loading…" : "No boosts this season yet"}
                  </div>
                )}
                {(auraLb.data?.items ?? []).map((row) => {
                  const rankStr = row.rank.toString().padStart(2, "0");
                  const rankClass = row.rank === 2 ? "r2" : row.rank === 3 ? "r3" : "";
                  return (
                    <Link className="lbitem" key={row.intentId} href={`/intent/${row.intentId}`} style={{ textDecoration: "none", color: "inherit" }}>
                      <div className={"rk " + rankClass}>{rankStr}</div>
                      <div className="info">
                        <div className="a">{row.intent?.ticker ?? row.intentId.slice(0, 10) + "…"}</div>
                        <div className="b">{row.intent?.title?.slice(0, 36) ?? "—"}</div>
                      </div>
                      <div className="aura">
                        <div className="a">{row.heat}</div>
                        <div className="b">Aura</div>
                      </div>
                    </Link>
                  );
                })}
              </div>

              <div className="sb-block">
                <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
                <div className="feed-head">
                  <span>§ 02 — Live feed</span>
                  <span className="live"><span className="d" />Live</span>
                </div>
                <div className="feed-body">
                  {(liveQ.data?.items ?? []).length === 0 && (
                    <div style={{ padding: "16px 0", textAlign: "center", color: "var(--mute)", font: "12px JetBrains Mono, monospace" }}>
                      {liveQ.isLoading ? "Loading…" : "No activity yet"}
                    </div>
                  )}
                  {(liveQ.data?.items ?? []).map((row) => {
                    const f = formatActivity(row);
                    return (
                      <div className="feed-item" key={row.id}>
                        <span className="ts">{f.ts}</span>
                        <span className={"msg " + f.tone}>{f.msg}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* Filter drawer */}
      <div className={"fbackdrop" + (drawerOpen ? " open" : "")} onClick={() => setDrawerOpen(false)} />
      <aside className={"fdrawer" + (drawerOpen ? " open" : "")} aria-hidden={!drawerOpen}>
        <div className="head">
          <h3>Filters</h3>
          <button className="close" onClick={() => setDrawerOpen(false)} aria-label="Close">×</button>
        </div>
        <div className="body">
          {(["category", "stage", "tier"] as const).map((group) => (
            <div className="fgroup" key={group}>
              <div className="lbl">
                <span>{group === "category" ? "Category" : group === "stage" ? "Stage" : "Tier"}</span>
                <span className="clear" onClick={() => setFilters((f) => ({ ...f, [group]: FILTER_GROUPS[group][0] }))}>Clear</span>
              </div>
              <div className="fchips">
                {FILTER_GROUPS[group].map((v) => (
                  <button
                    key={v}
                    className={"fchip" + (filters[group] === v ? " on" : "")}
                    onClick={() => setFilters((f) => ({ ...f, [group]: v }))}
                  >{FILTER_LABELS[v] ?? v}</button>
                ))}
              </div>
            </div>
          ))}

          <div className="fgroup">
            <div className="lbl"><span>Min Gatekeeper score</span><span style={{ color: "var(--rust)" }}>{scoreLive}</span></div>
            <div className="frange">
              <span>0</span>
              <input
                type="range" min={0} max={100} value={scoreLive} step={5}
                onChange={(e) => setScoreLive(Number(e.target.value))}
              />
              <span>100</span>
            </div>
          </div>
        </div>
        <div className="foot">
          <button className="bbtn bbtn-ghost" onClick={reset}>Reset</button>
          <button className="bbtn bbtn-primary" onClick={apply}>Apply</button>
        </div>
      </aside>

      {/* global so styles also reach <Link>-rendered <a> elements (.lbitem
          in the leaderboard) — styled-jsx scope class is only attached to
          host elements declared in this render. */}
      <style jsx global>{`
        .layout { display: grid; grid-template-columns: 1fr 320px; gap: 32px; margin-top: 36px; }
        @media (max-width: 1024px) { .layout { grid-template-columns: 1fr; } }
        .search-row { display: flex; gap: 10px; margin-bottom: 24px; }
        .search-row .binput { flex: 1; background: var(--paper); }

        .filter-btn { position: relative; }
        .filter-btn .dot { position: absolute; top: -4px; right: -4px; width: 8px; height: 8px; border-radius: 50%; background: var(--rust); display: none; }
        .filter-btn.has-active .dot { display: block; }
        .fdrawer { position: fixed; top: 0; right: 0; bottom: 0; width: 380px; max-width: 90vw; background: #fdfcf8; border-left: 1px solid var(--line); box-shadow: -12px 0 40px rgba(58,36,24,0.10); z-index: 200; display: flex; flex-direction: column; transform: translateX(100%); transition: transform .35s cubic-bezier(.4,0,.2,1); }
        .fdrawer.open { transform: translateX(0); }
        .fdrawer .head { display: flex; justify-content: space-between; align-items: center; padding: 22px 26px; border-bottom: 1px solid var(--line); }
        .fdrawer .head h3 { margin: 0; font-family: 'Newsreader', serif; font-weight: 500; font-size: 24px; color: var(--ink); letter-spacing: -0.01em; }
        .fdrawer .close { width: 32px; height: 32px; border: 1px solid var(--line); background: transparent; color: var(--ink-2); display: flex; align-items: center; justify-content: center; font-size: 18px; cursor: pointer; border-radius: 50%; }
        .fdrawer .close:hover { border-color: var(--rust); color: var(--rust); }
        .fdrawer .body { flex: 1; overflow-y: auto; padding: 22px 26px; }
        .fgroup { margin-bottom: 28px; }
        .fgroup .lbl { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); letter-spacing: 0.08em; margin-bottom: 10px; display: flex; justify-content: space-between; }
        .fgroup .lbl .clear { color: var(--rust); cursor: pointer; }
        .fchips { display: flex; flex-wrap: wrap; gap: 8px; }
        .fchip { padding: 7px 14px; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500; color: var(--ink-3); border: 1px solid var(--line); background: transparent; cursor: pointer; border-radius: 999px; transition: all .2s; }
        .fchip:hover { border-color: var(--rust); color: var(--rust); }
        .fchip.on { background: var(--ink); color: #faf3e3; border-color: var(--ink); }
        .frange { display: flex; align-items: center; gap: 10px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--ink-2); }
        .frange input[type=range] { flex: 1; accent-color: var(--rust); }
        .fdrawer .foot { padding: 18px 26px; border-top: 1px solid var(--line); display: flex; gap: 10px; }
        .fdrawer .foot .bbtn { flex: 1; justify-content: center; }
        .fbackdrop { position: fixed; inset: 0; background: rgba(42,26,16,0.20); z-index: 190; opacity: 0; pointer-events: none; transition: opacity .3s; }
        .fbackdrop.open { opacity: 1; pointer-events: auto; }

        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
        @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }

        .sb { position: sticky; top: 100px; display: flex; flex-direction: column; gap: 32px; align-self: flex-start; }
        .sb-block { background: var(--paper); border: 1px solid var(--line); padding: 22px; position: relative; }
        .sb-block .corner { position: absolute; width: 8px; height: 8px; border-color: var(--rust); border-style: solid; border-width: 0; opacity: .7; }
        .sb-block .corner.tl { top: -1px; left: -1px; border-top-width: 1px; border-left-width: 1px; }
        .sb-block .corner.tr { top: -1px; right: -1px; border-top-width: 1px; border-right-width: 1px; }
        .sb-block .corner.bl { bottom: -1px; left: -1px; border-bottom-width: 1px; border-left-width: 1px; }
        .sb-block .corner.br { bottom: -1px; right: -1px; border-bottom-width: 1px; border-right-width: 1px; }
        .sb h4 { margin: 0 0 4px; font-family: 'Newsreader', serif; font-weight: 500; font-size: 26px; color: var(--ink); letter-spacing: -0.01em; }
        .sb .num { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: rgba(194,65,12,0.7); letter-spacing: 0.08em; margin-bottom: 14px; }
        .sb .sub { font-size: 13px; color: var(--mute); margin: -2px 0 16px; }
        .lbitem { display: flex; align-items: center; gap: 14px; padding: 14px 0; border-bottom: 1px solid var(--line-soft); cursor: pointer; transition: padding-left .25s; }
        .lbitem:hover { padding-left: 6px; }
        .lbitem:last-child { border-bottom: 0; padding-bottom: 0; }
        .lbitem .rk { font-family: 'Instrument Serif', serif; font-size: 32px; color: var(--rust); min-width: 38px; line-height: 1; }
        .lbitem .rk.r2 { color: var(--ink-3); }
        .lbitem .rk.r3 { color: rgba(194,65,12,0.55); }
        .lbitem .info { flex: 1; min-width: 0; }
        .lbitem .info .a { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 600; color: var(--ink); }
        .lbitem .info .b { font-size: 12px; color: var(--mute); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 3px; }
        .lbitem .aura { text-align: right; }
        .lbitem .aura .a { color: var(--rust); font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 700; }
        .lbitem .aura .b { font-size: 11px; color: var(--mute); margin-top: 2px; }

        .feed-head { display: flex; align-items: center; gap: 8px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--rust); margin-bottom: 16px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
        .feed-head .live { margin-left: auto; display: inline-flex; gap: 6px; align-items: center; color: var(--emerald); font-size: 11px; }
        .feed-head .live .d { width: 6px; height: 6px; border-radius: 50%; background: var(--emerald); animation: bl 1.6s ease-in-out infinite; }
        .feed-body { display: flex; flex-direction: column; gap: 10px; max-height: 380px; overflow-y: auto; }
        .feed-item { display: flex; gap: 10px; font-size: 12px; line-height: 1.5; }
        .feed-item .ts { color: var(--mute); flex-shrink: 0; font-variant-numeric: tabular-nums; font-family: 'JetBrains Mono', monospace; }
        .feed-item .msg { color: var(--ink-3); }
        .feed-item .msg.rust { color: var(--rust); }
        .feed-item .msg.em { color: var(--emerald); }

        .bottom-cta { margin-top: 48px; padding: 36px; text-align: center; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); background: #fdfcf8; }
        .bottom-cta p { margin: 0 0 16px; font-family: 'Newsreader', serif; font-weight: 500; font-size: 24px; color: var(--ink-2); letter-spacing: -0.01em; }

        .empty-card { background: transparent !important; border: 1px dashed var(--line) !important; }
        .empty-card:hover { border-color: var(--rust) !important; transform: none !important; box-shadow: none !important; }

        .sort-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; font-size: 13px; color: var(--mute); }
        .sort-row .count { font-family: 'JetBrains Mono', monospace; color: var(--ink-2); }
        .sort-row select { font-family: 'Inter', sans-serif; font-size: 13px; color: var(--ink-2); background: transparent; border: 1px solid var(--line); padding: 6px 10px; border-radius: 2px; outline: none; cursor: pointer; }
      `}</style>

      {/* `global` because <IntentCard/> is a separate component — styled-jsx
          scoped styles from this parent wouldn't reach its DOM otherwise. */}
      <style jsx global>{`
        .icard { padding: 24px; display: flex; flex-direction: column; gap: 14px; background: #fdfcf8; text-decoration: none; color: inherit; }
        .icard:hover h3 { color: var(--rust); }
        .icard .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .icard .ticker { font-family: 'JetBrains Mono', monospace; font-size: 18px; font-weight: 600; color: var(--ink); letter-spacing: 0.02em; }
        .icard .ai { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: rgba(194,65,12,0.85); margin-top: 3px; }
        .icard h3 { margin: 0; font-family: 'Newsreader', serif; font-weight: 500; font-size: 22px; line-height: 1.25; color: var(--ink); letter-spacing: -0.01em; }
        .icard .tags { display: flex; flex-wrap: wrap; gap: 6px; }
        .icard .scientist { display: flex; align-items: center; gap: 10px; padding: 12px 0; border-top: 1px solid var(--line-soft); border-bottom: 1px solid var(--line-soft); font-size: 13px; color: var(--ink-3); }
        .icard .av { width: 24px; height: 24px; border-radius: 50%; background: linear-gradient(135deg,#fed7aa,#fb923c); display: flex; align-items: center; justify-content: center; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; color: #7c2d12; }
        .icard .verified { margin-left: auto; color: var(--emerald); font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
        .icard .funding { display: flex; flex-direction: column; gap: 8px; }
        .icard .frow { display: flex; justify-content: space-between; font-size: 13px; }
        .icard .frow .l { color: var(--mute); }
        .icard .frow .r { color: var(--ink-2); font-weight: 600; font-family: 'JetBrains Mono', monospace; }
        .icard .meta { display: flex; justify-content: space-between; font-size: 12px; color: var(--mute); }
      `}</style>
    </>
  );
}

function IntentCard({ i }: { i: IntentDto }) {
  const raised = usdcWhole(i.totalRaisedUsdc);
  const goal   = usdcWhole(i.fundingGoalUsdc);
  const pct    = goal > 0 ? Math.min(100, (raised / goal) * 100) : 0;
  const patronCount = i._count?.patronages ?? 0;
  const screened = i.aiGatekeeperScore != null && i.aiGatekeeperScore >= 70;
  return (
    <Link className="bcard icard" href={`/intent/${i.intentId}`}>
      <div className="head">
        <div>
          <div className="ticker">{i.ticker}</div>
          <div className="ai">Gatekeeper · {i.aiGatekeeperScore ?? "—"}/100</div>
        </div>
        <span className={"bpill " + (screened ? "verified" : "")}>{screened ? "Screened" : i.status}</span>
      </div>
      <h3>{i.title}</h3>
      <div className="tags">
        {(i.tags ?? []).slice(0, 3).map((t) => <span className="bpill" key={t}>{t}</span>)}
      </div>
      <div className="scientist">
        <span className="av">{initialsOf(i.scientist?.displayName)}</span>
        <span>{i.scientist?.displayName ?? "—"}{i.scientist?.affiliation ? ` · ${i.scientist.affiliation}` : ""}</span>
        {i.scientist?.orcidVerified && <span className="verified">✓ Verified</span>}
      </div>
      <div className="funding">
        <div className="frow"><span className="l">Funding</span><span className="r">${raised.toLocaleString()} / ${goal.toLocaleString()}</span></div>
        <div className="bprog"><span style={{ width: pct + "%" }} /></div>
        <div className="meta"><span>{i.milestones.length} milestones</span><span>{patronCount.toLocaleString()} patrons</span></div>
      </div>
    </Link>
  );
}

/** Reads ?signin=open and pops the sign-in modal. Lives under <Suspense/>
 *  so the parent page can still be statically prerendered (Next 14
 *  requires useSearchParams consumers to be Suspense-wrapped). */
function SignInLauncher() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const openSignIn = useSignInModal((s) => s.open);
  useEffect(() => {
    if (searchParams.get("signin") === "open") {
      openSignIn();
      router.replace(pathname, { scroll: false });
    }
  }, [searchParams, openSignIn, router, pathname]);
  return null;
}
