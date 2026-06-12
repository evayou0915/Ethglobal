"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { api } from "@/client/api";
import type { LeaderboardRow } from "@/types/api";

// ---------------------------------------------------------------
// Live data comes from GET /api/leaderboard (Patronage aggregator).
// When there are no patrons yet (fresh deployment), we fall back to
// the SEED dataset below so the page still demonstrates the layout.
// ---------------------------------------------------------------
type Patron = { type: "ind" | "org"; name: string; handle: string; amount: number; projects: number };

const SHORT = (w: string) => w.slice(0, 6) + "…" + w.slice(-4);
const USDC = (raw: string | bigint) => Number(BigInt(raw) / 1_000_000n);
const isOrgName = (s: string | null) =>
  !!s && /(foundation|labs?|institute|fund|ventures|research|trust|university|fnd|org)\b/i.test(s);
const liveToPatron = (r: LeaderboardRow): Patron => ({
  type: isOrgName(r.displayName) ? "org" : "ind",
  name: r.displayName ?? SHORT(r.wallet),
  handle: r.wallet,
  amount: USDC(r.netCommittedUsdc),
  projects: r.projects,
});

// SEED dataset removed — leaderboard now shows only real patrons from
// /api/leaderboard. Empty state below covers the no-data case.

const fmtMoney = (n: number) => {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "k";
  return String(n);
};
const fmtMoneyFull = (n: number) => n.toLocaleString("en-US");
const initialsOf = (s: string) => {
  const parts = s.replace(/^@/, "").split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] || "A").slice(0, 2).toUpperCase();
};

type Filter = "all" | "ind" | "org";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ind", label: "Individuals" },
  { value: "org", label: "Organisations" },
];

export default function LeaderboardPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const { address } = useAccount();

  const [live, setLive] = useState<Patron[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.leaderboard(50)
      .then((res) => { if (!cancelled) setLive(res.items.map(liveToPatron)); })
      .catch((e) => { if (!cancelled) setLoadError(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, []);

  // Only real data — no SEED fallback. `live === null` means still loading;
  // `live === []` means loaded but no patrons on chain yet (empty state).
  const dataset: Patron[] = live ?? [];
  const isLoading = live === null && !loadError;

  const { sorted, top50, totalAll, top10Sum, maxAmount } = useMemo(() => {
    const sorted = [...dataset].sort((a, b) => b.amount - a.amount);
    const top50 = sorted.slice(0, 50);
    const totalAll = sorted.reduce((s, p) => s + p.amount, 0);
    const top10Sum = sorted.slice(0, 10).reduce((s, p) => s + p.amount, 0);
    const maxAmount = top50[0]?.amount ?? 1;
    return { sorted, top50, totalAll, top10Sum, maxAmount };
  }, [dataset]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return top50.filter((p) => {
      if (filter !== "all" && p.type !== filter) return false;
      if (needle && p.name.toLowerCase().indexOf(needle) < 0 && p.handle.toLowerCase().indexOf(needle) < 0) return false;
      return true;
    });
  }, [top50, filter, q]);

  return (
    <section className="bpage">
      <div className="bpage-inner fade-in">
      <header style={{ display: "flex", justifyContent: "space-between", gap: 24, marginBottom: 36, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 420px", minWidth: 0 }}>
          <h1 style={h1}>
            Patron <em style={em}>leaderboard</em>
          </h1>
          <p style={sub}>
            Top 50 patrons across AuraSci, ranked by total committed capital. Both individuals and institutions are
            eligible — capital must be in escrow or already released against verified milestones.
          </p>
        </div>
        {address && (() => {
          // Find the caller's real row in the live leaderboard data. If
          // they haven't funded anything yet, we still render the card
          // showing $0 / 0 projects so they know they're on screen.
          const mine = sorted.find((p) => p.handle.toLowerCase() === address.toLowerCase());
          return (
            <div style={{ flex: "0 1 auto" }}>
              <YouCard
                wallet={address}
                sorted={sorted}
                amount={mine?.amount ?? 0}
                projects={mine?.projects ?? 0}
              />
            </div>
          );
        })()}
      </header>

      {/* Stats strip — top/bottom border, 4 columns separated by right-borders
          (last one has no border). Matches the original .stats / .stat-card. */}
      <div className="lb-kpi-strip" style={kpiStrip}>
        <KpiInline label="Total committed" prefix="$" value={fmtMoney(totalAll)} />
        <KpiInline label="Active patrons"  value={sorted.length.toLocaleString()} />
        <KpiInline label="Avg per patron"  prefix="$" value={fmtMoney(Math.round(totalAll / sorted.length))} />
        <KpiInline last label="Top 10 share" value={(top10Sum / totalAll * 100).toFixed(1)} suffix="%" />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div className="lb-search" style={searchWrap}>
          <SearchIcon />
          <input
            type="search"
            placeholder="Search patron or handle…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={searchInput}
          />
        </div>
      </div>

      <div className="lb-table" style={tableWrap}>
        {/* Rust corner accents — top-left + bottom-right, matching the
            original .lb-table::before / ::after markers. */}
        <span style={{ position: "absolute", top: -1, left: -1, width: 14, height: 14, borderTop: "1.5px solid #c2410c", borderLeft: "1.5px solid #c2410c", opacity: 0.5, pointerEvents: "none" }} />
        <span style={{ position: "absolute", bottom: -1, right: -1, width: 14, height: 14, borderBottom: "1.5px solid #c2410c", borderRight: "1.5px solid #c2410c", opacity: 0.5, pointerEvents: "none" }} />
        <div className="lb-row lb-headrow" style={{ ...row, ...headRow }}>
          <div>Rank</div>
          <div>Patron</div>
          <div>Projects</div>
          <div style={{ textAlign: "right" }}>Total committed</div>
          <div>Share of pool</div>
        </div>
        {isLoading && (
          <div style={empty}>Loading patron leaderboard…</div>
        )}
        {!isLoading && filtered.length === 0 && sorted.length === 0 && (
          <div style={empty}>
            No on-chain patronages yet. Be the first — fund an intent on the{" "}
            <Link href="/market" style={{ color: "var(--rust)" }}>Market</Link>.
          </div>
        )}
        {!isLoading && filtered.length === 0 && sorted.length > 0 && (
          <div style={empty}>No patrons match your search.</div>
        )}
        {filtered.map((p) => {
          // Rank is original sort position, not filter index.
          const rank = sorted.findIndex((x) => x.handle === p.handle) + 1;
          return <Row key={p.handle} p={p} rank={rank} totalAll={totalAll} maxAmount={maxAmount} />;
        })}
      </div>

      {loadError && (
        <div style={tableFoot}>
          <span style={{ color: "#c2410c" }}>Couldn&apos;t load leaderboard: {loadError}</span>
        </div>
      )}
      </div>

      {/* Mobile (≤720px) responsive overrides. The page is built with inline
       *  styles, so we use !important here to win specificity. Effects:
       *   - KPI strip becomes a 2×2 grid (was 1×4 with vertical dividers).
       *   - Table header hides; each row stacks vertically into a card so the
       *     wide 5-column grid no longer overflows.
       *   - Search input expands to fill its row. */}
      <style jsx global>{`
        @media (max-width: 720px) {
          .lb-kpi-strip {
            grid-template-columns: repeat(2, 1fr) !important;
            gap: 20px 0 !important;
            padding: 18px 0 !important;
          }
          .lb-kpi-strip > div { padding: 0 16px !important; }
          .lb-kpi-strip > div:nth-child(2n) { border-right: none !important; }

          .lb-table .lb-headrow { display: none !important; }
          .lb-table .lb-row {
            grid-template-columns: 1fr !important;
            padding: 16px !important;
            gap: 10px !important;
          }
          .lb-table .lb-row .lb-amount {
            align-items: flex-start !important;
            text-align: left !important;
          }

          .lb-search { width: 100%; }
          .lb-search input { width: 100% !important; min-width: 0 !important; }
        }
      `}</style>
    </section>
  );
}

function Row({ p, rank, totalAll, maxAmount }: { p: Patron; rank: number; totalAll: number; maxAmount: number }) {
  const pct = (p.amount / totalAll) * 100;
  const widthPct = (p.amount / maxAmount) * 100;
  return (
    <div className="lb-row" style={{ ...row, borderBottom: "1px solid rgba(58,36,24,0.08)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {rank <= 3 ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: "#c2410c" }}>
              <path d="M5 16L3 6l5.5 4L12 4l3.5 6L21 6l-2 10H5zm0 2h14v2H5v-2z" />
            </svg>
            <span style={{ font: "italic 500 22px Newsreader, serif", color: "#c2410c", lineHeight: 1 }}>{rank}</span>
          </span>
        ) : (
          <span style={{ font: "italic 400 22px Newsreader, serif", color: "#3a2418", lineHeight: 1 }}>{rank}</span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 32, height: 32, borderRadius: p.type === "org" ? 6 : "50%",
          background: p.type === "org" ? "linear-gradient(135deg,#fef3c7,#fbbf24)" : "linear-gradient(135deg,#fed7aa,#fb923c)",
          color: "#7c2d12", display: "flex", alignItems: "center", justifyContent: "center",
          font: "700 11px JetBrains Mono, monospace",
        }}>{initialsOf(p.name)}</div>
        <div>
          <div style={{ font: "600 14px Inter, sans-serif", color: "#2a1a10" }}>{p.name}</div>
          <div style={{ font: "12px JetBrains Mono, monospace", color: "#5a3d2a" }}>{p.handle}</div>
        </div>
      </div>
      <div style={{ font: "13px Inter, sans-serif", color: "#3a2418" }}>
        {p.projects}
        <div style={{ font: "10px JetBrains Mono, monospace", color: "#5a3d2a", letterSpacing: "0.06em" }}>
          {p.projects === 1 ? "project" : "projects"}
        </div>
      </div>
      <div className="lb-amount" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
        <div style={{ font: "500 22px Newsreader, serif", color: "#2a1a10", letterSpacing: "-0.01em", lineHeight: 1 }}>
          <span style={{ font: "500 11px JetBrains Mono, monospace", color: "#c2410c", marginRight: 3, verticalAlign: 5 }}>$</span>
          {fmtMoneyFull(p.amount)}
        </div>
        <div style={{ font: "11px JetBrains Mono, monospace", color: "#5a3d2a", letterSpacing: "0.04em", textTransform: "uppercase" }}>USDC</div>
      </div>
      <div>
        <div style={{ font: "12px Inter, sans-serif", color: "#3a2418", display: "flex", justifyContent: "space-between" }}>
          <b style={{ color: "#c2410c", font: "600 12px JetBrains Mono, monospace" }}>{pct.toFixed(2)}%</b>
          <span style={{ color: "#5a3d2a", fontSize: 11 }}>{widthPct.toFixed(0)}% of leader</span>
        </div>
        <div style={{ height: 4, background: "rgba(58,36,24,0.10)", borderRadius: 99, marginTop: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", width: widthPct + "%", background: "#c2410c" }} />
        </div>
      </div>
    </div>
  );
}

function KpiInline({ label, value, prefix, suffix, last }: {
  label: string;
  value: string;
  prefix?: string;
  suffix?: string;
  first?: boolean;
  last?: boolean;
}) {
  return (
    <div style={{
      padding: "0 28px",
      borderRight: last ? "none" : "1px solid rgba(58,36,24,0.18)",
    }}>
      <div style={{ font: "11px JetBrains Mono, monospace", color: "#5a3d2a", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ font: "500 30px Newsreader, serif", color: "#2a1a10", lineHeight: 1, letterSpacing: "-0.02em" }}>
        {prefix && (
          <span style={{ font: "500 14px JetBrains Mono, monospace", color: "#c2410c", marginRight: 4, verticalAlign: 6 }}>{prefix}</span>
        )}
        {value}
        {suffix && (
          <span style={{ font: "500 12px JetBrains Mono, monospace", color: "#c2410c", marginLeft: 2, verticalAlign: 8 }}>{suffix}</span>
        )}
      </div>
    </div>
  );
}

function YouCard({ wallet, sorted, amount, projects }: { wallet: string; sorted: Patron[]; amount: number; projects: number }) {
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].amount > amount) rank++;
    else break;
  }
  const short = wallet.slice(0, 6) + "…" + wallet.slice(-4);
  // First non-"0x" char of the wallet for the avatar — matches the
  // original spec which just shows a single initial letter.
  const initial = (wallet.replace(/^0x/i, "")[0] ?? "A").toUpperCase();
  return (
    <div style={{
      padding: "18px 22px",
      border: "1px solid rgba(194,65,12,0.30)",
      background: "rgba(254,215,170,0.18)",
      borderRadius: 6,
      display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap",
      minWidth: 340, maxWidth: 520,
    }}>
      <div style={{
        width: 42, height: 42, borderRadius: "50%",
        background: "linear-gradient(135deg,#fed7aa,#fb923c)",
        color: "#7c2d12",
        display: "flex", alignItems: "center", justifyContent: "center",
        font: "600 14px JetBrains Mono, monospace",
        border: "1px solid rgba(194,65,12,0.30)",
        flexShrink: 0,
      }}>{initial}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "11px JetBrains Mono, monospace", color: "#5a3d2a", letterSpacing: "0.10em", textTransform: "uppercase", marginBottom: 4 }}>
          Your standing
        </div>
        <div style={{ font: "500 18px Newsreader, serif", color: "#2a1a10", letterSpacing: "-0.005em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          Currently <em style={{ color: "#c2410c", fontStyle: "italic" }}>#{rank}</em> · {short} · {projects} project{projects === 1 ? "" : "s"}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ font: "700 18px JetBrains Mono, monospace", color: "#c2410c", letterSpacing: "0.02em" }}>
          ${fmtMoneyFull(amount)}
        </div>
        <div style={{ font: "11px JetBrains Mono, monospace", color: "#5a3d2a", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 2 }}>
          Lifetime committed
        </div>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#5a3d2a" }}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────

const lead: React.CSSProperties = {
  font: "11px JetBrains Mono, monospace", color: "#c2410c",
  letterSpacing: "0.22em", textTransform: "uppercase",
};
const h1: React.CSSProperties = {
  font: "500 clamp(2.4rem, 4.6vw, 3.6rem) Newsreader, serif",
  letterSpacing: "-0.02em", margin: "0 0 10px", color: "#2a1a10", lineHeight: 1.05,
};
const em: React.CSSProperties = { color: "#c2410c", fontStyle: "italic" };
const sub: React.CSSProperties = {
  font: "15px Inter, sans-serif", color: "#5a3d2a", maxWidth: 640, lineHeight: 1.6,
};
const chipStyle = (active: boolean): React.CSSProperties => ({
  padding: "8px 14px",
  font: "12px JetBrains Mono, monospace",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  background: active ? "#c2410c" : "transparent",
  color: active ? "#faf3e3" : "#5a3d2a",
  border: "1px solid " + (active ? "#c2410c" : "rgba(58,36,24,0.20)"),
  borderRadius: 4,
  cursor: "pointer",
});
const searchWrap: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8,
  padding: "8px 12px", background: "#faf3e3",
  border: "1px solid rgba(58,36,24,0.18)", borderRadius: 4,
};
const searchInput: React.CSSProperties = {
  border: "none", background: "transparent", outline: "none",
  font: "13px Inter, sans-serif", color: "#2a1a10", width: 220,
};
const tableWrap: React.CSSProperties = {
  background: "#fdfcf8",
  border: "1px solid rgba(58,36,24,0.18)",
  borderRadius: 8,
  overflow: "hidden",
  position: "relative",
};
const row: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "72px 1.6fr 1fr 1fr 1.4fr",
  alignItems: "center",
  padding: "16px 24px",
  gap: 18,
};
const headRow: React.CSSProperties = {
  background: "#faf3e3",
  borderBottom: "1px solid rgba(58,36,24,0.18)",
  font: "500 10.5px JetBrains Mono, monospace",
  color: "#5a3d2a",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  padding: "14px 24px",
};
const empty: React.CSSProperties = {
  padding: "38px 24px", textAlign: "center", color: "#5a3d2a",
  font: "13px JetBrains Mono, monospace",
};
const tableFoot: React.CSSProperties = {
  marginTop: 16, padding: "14px 18px",
  display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
  font: "11px JetBrains Mono, monospace", color: "#5a3d2a",
  letterSpacing: "0.06em",
};
const kpiStrip: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: 0,
  margin: "0 0 36px",
  padding: "22px 0",
  borderTop: "1px solid rgba(58,36,24,0.18)",
  borderBottom: "1px solid rgba(58,36,24,0.18)",
};
