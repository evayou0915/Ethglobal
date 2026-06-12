"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAccount } from "wagmi";
import { useAuth } from "@/client/auth";
import { useAdminRefundAll, useAdminWithdraw, useAuraBoost, useAuraHeat, useAuraLeaderboard, useAuraSeason, useFund, useIntent, useRefund, useRefundEligibility, useSession } from "@/client/hooks";
import { useToast } from "@/components/Toast";
import { useSignInModal } from "@/client/sign-in-store";
import type { IntentDto, MilestoneDto } from "@/types/api";

// ─── Display helpers ────────────────────────────────────────────────────

type DisplayStatus = "done" | "active" | "locked";

/** Collapse the on-chain/DB milestone status down to the three visual buckets
 *  the existing CSS knows how to render. */
function milestoneDisplayStatus(s: MilestoneDto["status"]): DisplayStatus {
  if (s === "released") return "done";
  if (s === "in_progress" || s === "proof_submitted" || s === "ai_verifying") return "active";
  return "locked"; // includes "rejected" — visually treated like locked
}

function initialsFor(name: string | null | undefined): string {
  if (!name) return "AS";
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "AS";
}

function shortHex(s: string | null | undefined, lead = 4, tail = 4): string {
  if (!s) return "";
  return s.length <= lead + tail + 2 ? s : `${s.slice(0, lead + 2)}…${s.slice(-tail)}`;
}

function tierFor(score: number | null | undefined): string {
  const s = score ?? 0;
  if (s >= 90) return "Tier 1";
  if (s >= 75) return "Tier 2";
  return "Tier 3";
}

/** Split a milestone descriptionMd that was written with our /create page's
 *  template:  "<desc>\n\nVerification criteria: <crit>"  — back into the two
 *  human-readable parts. Falls back gracefully if the description doesn't
 *  follow that shape (e.g. seeded data). */
function splitMilestoneBody(md: string): { desc: string; verify: string | null } {
  const m = md.match(/^([\s\S]*?)\n+verification criteria:\s*([\s\S]+)$/i);
  if (m) return { desc: m[1].trim(), verify: m[2].trim() };
  return { desc: md, verify: null };
}

const QUICK_AMOUNTS = [100, 500, 1000, 5000];

// ─── Page ───────────────────────────────────────────────────────────────

export default function IntentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = (params?.id ?? "").toLowerCase();
  const intentQ = useIntent(id);

  const [amount, setAmount] = useState("");
  // Gate the Fund button on the session JWT, NOT on wagmi's
  // isConnected. After a page reload the session is still valid but the
  // wallet extension is no longer attached to the wagmi connector —
  // useAccount().isConnected would flip to false and the button would
  // misleadingly say "Sign in to fund" even though the user is clearly
  // logged in. The fund mutation lazily reattaches the wallet when the
  // user actually clicks.
  const { authenticated } = useAuth();
  const fund = useFund();
  const toast = useToast();
  const openSignIn = useSignInModal((s) => s.open);

  // ─── Loading / not-found gates ────────────────────────────────────────
  if (intentQ.isLoading) {
    return (
      <section className="bpage">
        <div className="bpage-inner" style={{ padding: "60px 0", color: "var(--mute)" }}>
          Loading intent…
        </div>
      </section>
    );
  }
  if (intentQ.isError || !intentQ.data) {
    return (
      <section className="bpage">
        <div className="bpage-inner" style={{ padding: "60px 0", maxWidth: 640 }}>
          <h1 style={{ fontFamily: "Newsreader, serif", fontWeight: 500, fontSize: 28, marginBottom: 12 }}>
            Intent not found
          </h1>
          <p style={{ color: "var(--ink-3)", margin: "0 0 20px", lineHeight: 1.6 }}>
            No intent matches <code style={{ fontFamily: "JetBrains Mono, monospace" }}>{shortHex(id)}</code>. It may
            have been rejected by the gatekeeper, or the URL might be wrong.
          </p>
          <Link href="/market" style={{
            display: "inline-block", padding: "12px 22px", borderRadius: 6, background: "var(--ink)",
            color: "#faf3e3", textDecoration: "none", fontSize: 14, fontWeight: 500,
          }}>← Back to market</Link>
        </div>
      </section>
    );
  }

  const intent: IntentDto = intentQ.data;
  const intentIdHex = intent.intentId as `0x${string}`;

  // ─── Derive display values from the real intent ──────────────────────
  const goalUsdc   = Number(intent.fundingGoalUsdc) / 1e6;
  const raisedUsdc = Number(intent.totalRaisedUsdc) / 1e6;
  const pct = goalUsdc > 0 ? Math.min(100, Math.round((raisedUsdc / goalUsdc) * 100)) : 0;
  const toGo = Math.max(0, goalUsdc - raisedUsdc);

  const aiScore = intent.aiGatekeeperScore ?? 0;
  const sci = intent.scientist ?? null;
  const sciName = sci?.displayName ?? "Unknown scientist";
  const sciAff  = [sci?.affiliation, sci?.orcidVerified ? "Verified scientist" : null].filter(Boolean).join(" · ") || "—";
  const sciInitials = initialsFor(sciName);
  const tier = tierFor(aiScore);

  const evLinks: { label: string; href: string }[] = [];
  if (sci?.githubHandle) evLinks.push({ label: "↗ GitHub", href: `https://github.com/${sci.githubHandle}` });
  if (sci?.orcid)        evLinks.push({ label: "↗ ORCID",  href: `https://orcid.org/${sci.orcid}` });

  const patronages = intent.patronages ?? [];
  const backerCount = intent._count?.patronages ?? patronages.length;
  // Use the last 6 hex chars of each patron's wallet as their "avatar
  // initials" — keeps everyone visually distinguishable without exposing
  // the full address. Padded to ≤4 chips so the visual balance matches
  // the old mock.
  const backerAvatars = patronages.slice(0, 4).map((p) => p.patronWallet.slice(-4).toUpperCase());

  async function doFund() {
    const v = Number(amount);
    if (!Number.isFinite(v) || v <= 0) {
      toast.push({ text: "Enter a USDC amount", tone: "err" });
      return;
    }
    try {
      const res = await fund.mutateAsync({ intentId: intentIdHex, humanAmount: v });
      toast.push({ text: `💎 Patronized $${v.toLocaleString()} USDC`, href: res.url, tone: "ok" });
      setAmount("");
    } catch (e: any) {
      toast.push({ text: "Fund failed: " + (e?.shortMessage ?? e?.message ?? String(e)), tone: "err" });
    }
  }

  return (
    <>
      <div className="bportrait-bg" />

      <section className="bpage">
        <div className="bpage-inner fade-in">
          <Link href="/market" className="back">← Back to market</Link>

          <div className="detail-grid">
            <div>
              <div className="ticker-line">
                <span>{intent.ticker}</span>
                <span className="sep">·</span>
                <span>Gatekeeper {aiScore}/100</span>
              </div>
              <h1 className="intent-title">{intent.title}</h1>

              <div className="scientist-row">
                <div className="av-md">{sciInitials}</div>
                <div>
                  <div className="nm">{sciName}</div>
                  <div className="af">{sciAff}</div>
                </div>
              </div>

              <div className="tags-row">
                {(intent.tags ?? []).map((t) => <span className="bpill" key={t}>{t}</span>)}
                <span className="bpill">{tier}</span>
                <span className="bpill verified">Screened · {aiScore}/100</span>
              </div>

              <p className="hyp">{intent.descriptionMd}</p>

              {evLinks.length > 0 && (
                <div className="ev-links">
                  {evLinks.map((l) => (
                    <a key={l.label} className="ev-link" href={l.href} target="_blank" rel="noreferrer">
                      {l.label}
                    </a>
                  ))}
                </div>
              )}

              {backerCount > 0 && (
                <div className="backers">
                  <span className="lbl">Backed by</span>
                  <span className="bpill">
                    {backerCount} patron{backerCount === 1 ? "" : "s"}
                  </span>
                  <div className="pa-stack">
                    {backerAvatars.map((a, i) => <div className="pa" key={i}>{a}</div>)}
                    {backerCount > backerAvatars.length && (
                      <div className="pa">+{backerCount - backerAvatars.length}</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Funding side */}
            <aside className="fund-side">
              <div className="fund-card">
                <div className="fund-stamp">
                  <span className="dot" />
                  {intent.status === "published" || intent.status === "funded"
                    ? "Fund this research · Open"
                    : `Status · ${intent.status}`}
                </div>
                <div className="fund-num">Total committed · escrow live</div>
                <div className="fund-amt">
                  <span className="cur">$</span>{raisedUsdc.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
                <div className="fund-goal">of <b>${goalUsdc.toLocaleString()}</b> goal</div>

                <div className="bprog" style={{ marginTop: 18, height: 10 }}>
                  <span style={{ width: pct + "%" }} />
                </div>
                <div className="fund-pct">
                  <span className="hl">{pct}% complete</span>
                  <span>${toGo.toLocaleString(undefined, { maximumFractionDigits: 2 })} to go</span>
                </div>

                <div className="fund-input">
                  <input
                    className="binput" type="number" placeholder="Enter USDC amount"
                    value={amount} onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div className="fund-quick">
                  {QUICK_AMOUNTS.map((q) => (
                    <button key={q} onClick={() => setAmount(String(q))}>${q.toLocaleString()}</button>
                  ))}
                </div>
                {authenticated ? (
                  <button className="fund-cta" onClick={doFund} disabled={fund.isPending}>
                    {fund.isPending ? "Confirming…" : "Fund this research"} <span className="arr">→</span>
                  </button>
                ) : (
                  <button className="fund-cta" onClick={openSignIn}>
                    Sign in to fund <span className="arr">→</span>
                  </button>
                )}

                <div className="fund-trust">
                  <div className="tr">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      <path d="m9 12 2 2 4-4" />
                    </svg>
                    <span>Funds escrowed in smart contract — released only on AI-verified milestone proof.</span>
                  </div>
                </div>
              </div>

              <RefundCard intentId={intentIdHex} />
              <AdminRefundAllCard intentId={intentIdHex} />
              <AdminWithdrawCard intentId={intentIdHex} />

              <AuraHeatCard intentId={intentIdHex} />
            </aside>
          </div>

          {/* Milestone trajectory — three synthetic bookend phases bracket
              the real on-chain milestones for visual narrative:
                M0  · Fundraising         (derived from raised vs goal)
                M1…Mn · real DB milestones
                R   · Result attestation  (derived: all milestones released)
                SSR · Replication award   (always locked — aspirational)
              The bookends do NOT trigger any escrow movement; they're purely
              presentational, kept to match the original product narrative. */}
          {(() => {
            const fundDone = goalUsdc > 0 && raisedUsdc >= goalUsdc;
            const fundActive = raisedUsdc > 0 && !fundDone;
            const fundStatus: DisplayStatus = fundDone ? "done" : fundActive ? "active" : "locked";

            const realMilestones = intent.milestones;
            const allMilestonesDone =
              realMilestones.length > 0 && realMilestones.every((m) => m.status === "released");
            const resultStatus: DisplayStatus = allMilestonesDone ? "done" : "locked";

            // SSR award has no auto-completion in the current product (no
            // replication mechanism). It stays locked as an aspirational marker.
            const ssrStatus: DisplayStatus = "locked";

            const totalPhases = realMilestones.length + 3;

            return (
              <div className="ms-unified">
                <div className="ms-unified-head">
                  <h2>Milestone <em>trajectory</em></h2>
                  <div className="sub">
                    M0 → SSR · {totalPhases} phases · ${goalUsdc.toLocaleString()} total escrow
                  </div>
                </div>

                <div className="ms-rail">
                  {/* M0 · Fundraising bookend */}
                  <div className={"ms-row " + fundStatus}>
                    <div className="ms-marker">
                      <span className="lbl">M0</span>
                      <span className="ph">Fund</span>
                    </div>
                    <div className={"ms-card2 " + fundStatus}>
                      <div className="ms-card2-head">
                        <span className="phase">Phase 0 · Fundraising</span>
                        <span className="status">
                          {fundDone ? "✓ Completed" : fundActive ? "In progress" : "Open"}
                        </span>
                      </div>
                      <h3>Reach funding goal and open escrow</h3>
                      <div className="meta">
                        <span><b>{fundDone ? "Closed" : fundActive ? `${pct}% complete` : "Awaiting first patron"}</b></span>
                        <span className="release">
                          ${raisedUsdc.toLocaleString(undefined, { maximumFractionDigits: 2 })} / ${goalUsdc.toLocaleString()} USDC
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Real on-chain milestones */}
                  {realMilestones.map((m) => {
                    const ds = milestoneDisplayStatus(m.status);
                    const { desc, verify } = splitMilestoneBody(m.descriptionMd ?? "");
                    const releaseHuman = Number(m.releaseAmountUsdc) / 1e6;
                    const showDesc = desc.trim() && desc.trim() !== m.title.trim();
                    const due = m.dueDate ? new Date(m.dueDate) : null;
                    const overdue = !!(due && ds === "active" && due.getTime() < Date.now());
                    return (
                      <div className={"ms-row " + ds} key={m.id}>
                        <div className="ms-marker">
                          <span className="lbl">M{m.idx + 1}</span>
                          <span className="ph">{ds === "done" ? "Done" : ds === "active" ? "Active" : "Locked"}</span>
                        </div>
                        <div className={"ms-card2 " + ds}>
                          <div className="ms-card2-head">
                            <span className="phase">Phase {m.idx + 1} · Milestone</span>
                            <span className="status">
                              {ds === "done" ? "✓ Released" : ds === "active" ? (overdue ? "Overdue" : "In progress") : m.status === "rejected" ? "Rejected" : "Locked"}
                            </span>
                          </div>
                          <h3>{m.title}</h3>
                          {showDesc && (
                            <p style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.6, margin: "10px 0 0" }}>{desc}</p>
                          )}
                          <div className="meta">
                            <span><b>{m.proofUploadedAt ? "Proof submitted" : "Awaiting proof"}</b></span>
                            <span className="release">Releases ${releaseHuman.toLocaleString()} USDC</span>
                            {due && (
                              <span style={{ color: overdue ? "#b91c1c" : undefined, fontWeight: overdue ? 600 : undefined }}>
                                {overdue ? "Overdue · " : "Due "}
                                {due.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                              </span>
                            )}
                          </div>
                          {verify && (
                            <div className="verify"><b>Gatekeeper verification</b>{verify}</div>
                          )}
                          {m.aiScore != null && (
                            <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 8, fontFamily: "JetBrains Mono, monospace" }}>
                              AI verifier score · {m.aiScore}/100
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* R · Result attestation bookend */}
                  <div className={"ms-row " + resultStatus}>
                    <div className="ms-marker">
                      <span className="lbl">R</span>
                      <span className="ph">Result</span>
                    </div>
                    <div className={"ms-card2 " + resultStatus}>
                      <div className="ms-card2-head">
                        <span className="phase">Phase {realMilestones.length + 1} · Result attestation</span>
                        <span className="status">{resultStatus === "done" ? "✓ Completed" : "Locked"}</span>
                      </div>
                      <h3>Publish open-access manuscript and dataset for peer replication</h3>
                      <div className="meta">
                        <span><b>Final attestation</b></span>
                        <span className="release">Open-access publication</span>
                      </div>
                    </div>
                  </div>

                  {/* SSR · Replication award bookend (always locked) */}
                  <div className={"ms-row " + ssrStatus}>
                    <div className="ms-marker">
                      <span className="lbl">SSR</span>
                      <span className="ph">Award</span>
                    </div>
                    <div className={"ms-card2 " + ssrStatus}>
                      <div className="ms-card2-head">
                        <span className="phase">Phase {realMilestones.length + 2} · Replication award</span>
                        <span className="status">Locked</span>
                      </div>
                      <h3>Independent replication confirms findings — SSR award unlocked</h3>
                      <div className="meta">
                        <span><b>Independent replication</b></span>
                        <span className="release">Backers receive Aura yield</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </section>

      {/* Using `global` so styles also reach elements rendered by child
          components (AuraHeatCard, RefundCard) — styled-jsx scope class is
          only attached to host elements declared in this render. */}
      <style jsx global>{`
        .back { display: inline-flex; align-items: center; gap: 8px; font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 500; color: var(--mute); margin-bottom: 32px; transition: color .2s; text-decoration: none; }
        .back:hover { color: var(--rust); }

        .detail-grid { display: grid; grid-template-columns: 1fr 400px; gap: 56px; }
        @media (max-width: 980px) { .detail-grid { grid-template-columns: 1fr; gap: 32px; } }

        .ticker-line { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--rust); margin-bottom: 10px; display: flex; gap: 14px; align-items: center; }
        .ticker-line .sep { color: var(--line); }
        .intent-title { font-family: 'Newsreader', serif; font-weight: 500; font-size: clamp(2rem, 4.4vw, 3.4rem); line-height: 1.1; letter-spacing: -0.02em; color: var(--ink); margin: 0 0 24px; }
        .intent-title :global(em) { font-style: italic; color: var(--rust); font-weight: 500; }

        .scientist-row { display: flex; align-items: center; gap: 14px; margin-bottom: 22px; }
        .av-md { width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #fed7aa, #fb923c); display: flex; align-items: center; justify-content: center; font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 700; color: #7c2d12; }
        .scientist-row .nm { font-family: 'Inter', sans-serif; font-weight: 600; font-size: 16px; color: var(--ink); }
        .scientist-row .af { font-size: 13px; color: var(--mute); margin-top: 2px; }

        .tags-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; }
        .hyp { font-size: 16px; line-height: 1.7; color: var(--ink-3); margin-bottom: 24px; max-width: 680px; }
        .ev-links { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; }
        .ev-link { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border: 1px solid var(--line); font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500; color: var(--ink-3); border-radius: 999px; background: #fdfcf8; transition: all .2s; text-decoration: none; }
        .ev-link:hover { border-color: var(--rust); color: var(--rust); }

        .fund-side { display: flex; flex-direction: column; gap: 14px; position: sticky; top: 100px; align-self: flex-start; }
        .fund-card { position: relative; padding: 30px 28px; background: #fdfcf8; border: 2px solid var(--ink); border-radius: 6px; box-shadow: 8px 8px 0 rgba(58,36,24,0.08); }
        .fund-card::before, .fund-card::after { content: ''; position: absolute; width: 18px; height: 18px; border: 2px solid var(--rust); pointer-events: none; }
        .fund-card::before { top: -2px; left: -2px; border-right: none; border-bottom: none; }
        .fund-card::after { bottom: -2px; right: -2px; border-left: none; border-top: none; }
        .fund-stamp { display: inline-flex; align-items: center; gap: 8px; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--rust); letter-spacing: .22em; text-transform: uppercase; font-weight: 600; padding: 6px 12px; border: 1px solid var(--rust); background: rgba(254,215,170,0.30); border-radius: 2px; margin-bottom: 18px; }
        .fund-stamp .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--rust); animation: bl 1.6s ease-in-out infinite; }
        .fund-num { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); margin-bottom: 6px; letter-spacing: .08em; text-transform: uppercase; }
        .fund-amt { font-family: 'Newsreader', serif; font-weight: 500; font-size: 54px; color: var(--ink); line-height: 1; letter-spacing: -0.025em; }
        .fund-amt .cur { font-size: 22px; color: var(--rust); font-family: 'JetBrains Mono', monospace; font-weight: 500; letter-spacing: .04em; margin-right: 6px; vertical-align: 8px; }
        .fund-goal { font-size: 13px; color: var(--ink-3); margin-top: 10px; line-height: 1.5; }
        .fund-goal :global(b) { color: var(--ink); font-weight: 600; font-family: 'JetBrains Mono', monospace; }
        .fund-pct { font-size: 13px; color: var(--ink-3); margin-top: 16px; display: flex; justify-content: space-between; align-items: baseline; }
        .fund-pct .hl { color: var(--rust); font-weight: 700; font-family: 'JetBrains Mono', monospace; font-size: 15px; }
        .fund-input { display: flex; gap: 8px; margin-top: 18px; }
        .fund-input :global(input) { flex: 1; padding: 14px 16px; font-size: 15px; font-family: 'JetBrains Mono', monospace; border: 1px solid var(--line); background: #faf3e3; color: var(--ink); border-radius: 4px; box-sizing: border-box; outline: none; transition: all .2s; }
        .fund-input :global(input:focus) { border-color: var(--rust); background: #fffaee; box-shadow: 0 0 0 3px rgba(194,65,12,0.10); }
        .fund-cta { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; margin-top: 12px; padding: 16px; background: var(--rust); color: #faf3e3; border: none; border-radius: 4px; font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 600; letter-spacing: .04em; cursor: pointer; transition: all .2s; }
        .fund-cta:hover:not(:disabled) { background: var(--ink); transform: translateY(-1px); box-shadow: 0 6px 14px rgba(58,36,24,0.18); }
        .fund-cta:disabled { opacity: .6; cursor: not-allowed; }
        .fund-cta .arr { font-family: 'JetBrains Mono', monospace; font-weight: 400; }
        .fund-quick { display: flex; gap: 6px; margin-top: 10px; }
        .fund-quick :global(button) { flex: 1; padding: 8px; background: transparent; border: 1px solid var(--line); color: var(--ink-3); font-family: 'JetBrains Mono', monospace; font-size: 12px; border-radius: 4px; cursor: pointer; transition: all .2s; }
        .fund-quick :global(button:hover) { border-color: var(--rust); color: var(--rust); background: rgba(254,215,170,0.18); }
        .fund-trust { margin-top: 18px; padding-top: 16px; border-top: 1px dashed var(--line); display: flex; flex-direction: column; gap: 8px; }
        .fund-trust .tr { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--ink-3); line-height: 1.4; }
        .fund-trust .tr :global(svg) { flex-shrink: 0; color: #65a30d; }

        .ms-unified { margin-top: 56px; padding-top: 32px; border-top: 1px solid var(--line); }
        .ms-unified-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 30px; flex-wrap: wrap; gap: 12px; }
        .ms-unified-head h2 { margin: 0; font-family: 'Newsreader', serif; font-weight: 500; font-size: 32px; color: var(--ink); letter-spacing: -0.01em; }
        .ms-unified-head h2 :global(em) { font-style: italic; color: var(--rust); }
        .ms-unified-head .sub { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--mute); letter-spacing: .06em; }

        .ms-rail { position: relative; padding-left: 0; }
        .ms-row { position: relative; display: grid; grid-template-columns: 64px 1fr; gap: 20px; padding-bottom: 18px; }
        .ms-row:not(:last-child)::before { content: ''; position: absolute; left: 31px; top: 64px; bottom: -4px; width: 2px; background: var(--line); }
        .ms-row.done:not(:last-child)::before { background: var(--emerald); }
        .ms-row.active:not(:last-child)::before { background: linear-gradient(to bottom, var(--rust) 0%, var(--rust) 50%, var(--line) 50%, var(--line) 100%); }

        .ms-marker { position: relative; z-index: 2; width: 64px; height: 64px; border-radius: 50%; background: #fdfcf8; border: 2px solid var(--line); display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: var(--mute); }
        .ms-marker .lbl { font-size: 14px; line-height: 1; }
        .ms-marker .ph { font-size: 9px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--mute); margin-top: 3px; }
        .ms-row.done .ms-marker { border-color: var(--emerald); color: var(--emerald); background: rgba(101,163,13,0.08); }
        .ms-row.active .ms-marker { border-color: var(--rust); color: var(--rust); background: #fffaee; box-shadow: 0 0 0 5px rgba(194,65,12,0.10); }

        .ms-card2 { padding: 22px 24px; border: 1px solid var(--line); background: #fdfcf8; border-radius: 6px; transition: all .2s; position: relative; }
        .ms-card2.active { border-color: rgba(194,65,12,0.5); box-shadow: 0 6px 18px rgba(194,65,12,0.08); background: #fffdf6; }
        .ms-card2.done { border-color: rgba(101,163,13,0.35); }
        .ms-card2-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 6px; flex-wrap: wrap; }
        .ms-card2-head .phase { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); letter-spacing: .14em; text-transform: uppercase; font-weight: 500; }
        .ms-card2.active .ms-card2-head .phase { color: var(--rust); }
        .ms-card2.done .ms-card2-head .phase { color: #4d7c0f; }
        .ms-card2-head .status { font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 600; padding: 4px 11px; border: 1px solid var(--line); color: var(--mute); white-space: nowrap; border-radius: 999px; background: #faf3e3; letter-spacing: .04em; text-transform: uppercase; }
        .ms-card2.active .status { color: var(--rust); border-color: rgba(194,65,12,0.4); background: rgba(254,215,170,0.30); }
        .ms-card2.done .status { color: #4d7c0f; border-color: rgba(101,163,13,0.35); background: rgba(101,163,13,0.10); }
        .ms-card2 :global(h3) { margin: 0; font-family: 'Newsreader', serif; font-weight: 500; font-size: 20px; color: var(--ink); line-height: 1.3; letter-spacing: -0.01em; }
        .ms-card2 .meta { font-size: 13px; color: var(--mute); margin-top: 8px; display: flex; gap: 14px; flex-wrap: wrap; }
        .ms-card2 .meta :global(b) { color: var(--ink-2); font-weight: 600; }
        .ms-card2 .meta .release { color: var(--rust); font-family: 'JetBrains Mono', monospace; font-weight: 600; }
        .ms-card2 .verify { font-size: 13px; color: var(--ink-3); margin-top: 14px; line-height: 1.6; padding-top: 14px; border-top: 1px dashed var(--line-soft); }
        .ms-card2 .verify :global(b) { color: var(--rust); font-weight: 600; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; display: block; margin-bottom: 4px; }
        @media (max-width: 600px) {
          .ms-row { grid-template-columns: 48px 1fr; gap: 14px; }
          .ms-marker { width: 48px; height: 48px; }
          .ms-row:not(:last-child)::before { left: 23px; top: 48px; }
        }

        .backers { margin-top: 32px; padding: 18px 0; border-top: 1px solid var(--line); display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
        .backers .lbl { font-size: 13px; color: var(--mute); }
        .backers .pa-stack { display: flex; }
        .backers .pa { width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, #fed7aa, #fb923c); border: 2px solid #fdfcf8; display: flex; align-items: center; justify-content: center; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; color: #7c2d12; margin-left: -10px; }
        .backers .pa:first-child { margin-left: 0; }

        .left-extras { margin-top: 32px; display: flex; flex-direction: column; gap: 18px; }
        .lx-block { padding: 22px; border: 1px solid var(--line); background: #fdfcf8; border-radius: 6px; position: relative; }
        .lx-block .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px dashed var(--line-soft); }
        .lx-block .head .lbl { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--rust); letter-spacing: .16em; text-transform: uppercase; font-weight: 600; display: flex; align-items: center; gap: 8px; }
        .lx-block .head .lbl::before { content: ''; width: 14px; height: 1px; background: var(--rust); }
        .lx-block .head .meta { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); }

        .lx-res-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
        @media (max-width: 600px) { .lx-res-grid { grid-template-columns: 1fr; } }
        .lx-res { padding: 14px 16px; background: #faf3e3; border: 1px solid var(--line-soft); border-radius: 4px; }
        .lx-res .v { font-family: 'Newsreader', serif; font-weight: 500; font-size: 28px; color: var(--ink); line-height: 1; letter-spacing: -0.01em; margin-bottom: 6px; }
        .lx-res .v .u { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--rust); font-weight: 500; margin-left: 4px; vertical-align: 2px; }
        .lx-res .k { font-size: 12px; color: var(--mute); line-height: 1.4; }

        .heat-card { padding: 20px; border: 1px solid var(--line); background: #fdfcf8; border-radius: 6px; position: relative; }
        .heat-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
        .heat-lbl { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--mute); letter-spacing: .18em; text-transform: uppercase; display: flex; align-items: center; gap: 8px; }
        .heat-lbl::before { content: ''; width: 14px; height: 1px; background: var(--rust); }
        .heat-rank { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--rust); font-weight: 600; }
        .heat-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px dashed var(--line-soft); }
        .heat-stat { padding: 0 4px; }
        .heat-stat + .heat-stat { border-left: 1px solid var(--line-soft); padding-left: 18px; }
        .heat-stat .hk { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--mute); letter-spacing: .14em; text-transform: uppercase; margin-bottom: 8px; }
        .heat-stat .hv { display: flex; align-items: baseline; gap: 5px; }
        .heat-stat .hv .num { font-family: 'Newsreader', serif; font-weight: 500; font-size: 42px; color: var(--ink); line-height: 1; letter-spacing: -0.02em; }
        .heat-stat .hv .unit { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--rust); font-weight: 600; letter-spacing: .04em; }
        .heat-stat .hv .hash { font-family: 'Newsreader', serif; font-size: 24px; color: var(--rust); font-weight: 500; line-height: 1; }
        .heat-cta { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .heat-cta .you { font-size: 11px; color: var(--mute); font-family: 'JetBrains Mono', monospace; line-height: 1.4; }
        .heat-cta .you :global(b) { color: var(--rust); font-weight: 700; }
        .heat-cta :global(button) { padding: 9px 16px; border: 1px solid var(--rust); background: rgba(254,215,170,0.30); color: var(--rust); font-family: 'Inter', sans-serif; font-weight: 600; font-size: 12px; letter-spacing: .06em; border-radius: 3px; cursor: pointer; transition: all .2s; text-transform: uppercase; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
        .heat-cta :global(button:hover) { background: var(--rust); color: #faf3e3; }
      `}</style>
    </>
  );
}

// ─── Refund card (only renders when the connected wallet is eligible) ────

function RefundCard({ intentId }: { intentId: `0x${string}` }) {
  const { isConnected } = useAccount();
  const eligibility = useRefundEligibility(intentId);
  const refund = useRefund();
  const toast = useToast();

  // Hide entirely unless the connected wallet has something refundable on
  // this intent. The eligibility query 404s for catalog mock IDs and silently
  // does nothing — production data activates the card.
  if (!isConnected) return null;
  if (!eligibility.data?.eligible) return null;
  const amountUsdc = Number(eligibility.data.refundableUsdc) / 1e6;

  async function doRefund() {
    try {
      const r = await refund.mutateAsync({ intentId });
      const human = Number(r.amount) / 1e6;
      toast.push({ text: `↩ Refunded $${human.toLocaleString()} USDC`, href: r.url, tone: "ok" });
    } catch (e: any) {
      toast.push({ text: "Refund failed: " + (e?.shortMessage ?? e?.message ?? String(e)), tone: "err" });
    }
  }

  const rejectedIdx = eligibility.data.rejectedMilestoneIdx;
  const cause = rejectedIdx != null
    ? `Milestone M${rejectedIdx} was rejected — refund window open.`
    : "Intent was rejected — refund window open.";

  return (
    <div style={{
      marginTop: 14, padding: 18, borderRadius: 6,
      background: "rgba(220, 38, 38, 0.06)",
      border: "1px solid rgba(220, 38, 38, 0.35)",
    }}>
      <div style={{
        fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#b91c1c",
        letterSpacing: "0.10em", textTransform: "uppercase", marginBottom: 8,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#b91c1c" }} />
        Refund available
      </div>
      <div style={{ fontFamily: "Newsreader, serif", fontSize: 26, fontWeight: 500, color: "#2a1a10", letterSpacing: "-0.01em", lineHeight: 1 }}>
        <span style={{ color: "#b91c1c", fontSize: 14, marginRight: 2 }}>$</span>
        {amountUsdc.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </div>
      <div style={{ fontSize: 12, color: "#5a3d2a", marginTop: 6, lineHeight: 1.5 }}>
        {cause} You can withdraw your unspent contribution from the escrow.
      </div>
      <button
        onClick={doRefund}
        disabled={refund.isPending}
        style={{
          marginTop: 14, width: "100%", padding: "11px 16px",
          background: "#b91c1c", color: "#faf3e3", border: "none", borderRadius: 4,
          font: "600 13px Inter, sans-serif", letterSpacing: "0.04em",
          cursor: refund.isPending ? "default" : "pointer", opacity: refund.isPending ? 0.6 : 1,
        }}
      >
        {refund.isPending ? "Confirming…" : "Claim refund →"}
      </button>
    </div>
  );
}

// ─── Aura heat + Boost (real, when active season exists for this intentId) ─

function AuraHeatCard({ intentId }: { intentId: `0x${string}` }) {
  const seasonQ = useAuraSeason();
  const heatQ = useAuraHeat([intentId]);
  // Pull the full season leaderboard so we can show this intent's rank.
  // 200 is the backend cap and is more than enough for the demo season.
  const leaderboardQ = useAuraLeaderboard(200);
  const boost = useAuraBoost();
  const toast = useToast();
  const { isConnected } = useAccount();

  // If there's no active season, the aura/boost feature isn't live —
  // hide the card entirely instead of mocking it.
  if (!seasonQ.data) return null;
  const heat = heatQ.data?.[intentId] ?? 0;
  const remaining = seasonQ.data.you?.remaining ?? 0;

  // Rank = position in the leaderboard (1-indexed). Unranked intents (zero
  // heat = not in the leaderboard's groupBy result) get null.
  const lbItems = leaderboardQ.data?.items ?? [];
  const lbIdx = lbItems.findIndex((x) => x.intentId.toLowerCase() === intentId.toLowerCase());
  const rank = lbIdx >= 0 ? lbIdx + 1 : null;
  const rankTotal = lbItems.length;

  // Fixed-step boosting — matches the original visual rhythm (one compact
  // CTA row at the bottom, no separate input field). Tap the button
  // multiple times for larger boosts.
  const STEP = 5;
  const canBoost = isConnected && remaining >= STEP && !boost.isPending;

  async function doBoost() {
    if (!isConnected) {
      toast.push({ text: "Connect a wallet to boost", tone: "err" });
      return;
    }
    if (remaining < STEP) {
      toast.push({ text: `Not enough Aura left this season (need ${STEP})`, tone: "err" });
      return;
    }
    try {
      const res = await boost.mutateAsync({ intentId, amount: STEP });
      toast.push({ text: `✦ Boosted +${STEP} Aura · heat now ${res.heat}`, tone: "ok" });
    } catch (e: any) {
      toast.push({ text: e?.message ?? "boost failed", tone: "err" });
    }
  }

  return (
    <div className="heat-card">
      <div className="heat-head">
        <div className="heat-lbl">Aura heat · {seasonQ.data.season.name}</div>
        <div className="heat-rank">{seasonQ.data.season.budgetPerPatron} aura/season</div>
      </div>
      <div className="heat-stats">
        <div className="heat-stat">
          <div className="hk">Current heat</div>
          <div className="hv"><span className="num">{heat}</span><span className="unit">aura</span></div>
        </div>
        <div className="heat-stat">
          <div className="hk">Rank</div>
          <div className="hv">
            {rank != null ? (
              <>
                <span className="hash">#</span>
                <span className="num">{rank}</span>
                <span className="unit">/ {rankTotal}</span>
              </>
            ) : (
              <span className="num" style={{ fontSize: 28, color: "var(--mute)" }}>—</span>
            )}
          </div>
        </div>
      </div>
      <div className="heat-cta">
        <div className="you">You have <b>{remaining} Aura</b> this season</div>
        <button onClick={doBoost} disabled={!canBoost}>
          {boost.isPending ? "Boosting…" : `Boost +${STEP} ↑`}
        </button>
      </div>
    </div>
  );
}


// ─── Admin one-click refund-all (renders only for role=admin) ───────────

function AdminRefundAllCard({ intentId }: { intentId: `0x${string}` }) {
  const session = useSession();
  const refundAll = useAdminRefundAll();
  const toast = useToast();
  const [progress, setProgress] = useState<{ i: number; total: number } | null>(null);

  if (session.data?.role !== "admin") return null;

  async function doRefundAll() {
    if (!confirm("Sign and broadcast refund for every patron on this intent? You will pay gas for each tx.")) return;
    setProgress({ i: 0, total: 0 });
    try {
      const res = await refundAll.mutateAsync({
        intentId,
        onProgress: (i, total) => setProgress({ i, total }),
      });
      if (res.count === 0) toast.push({ text: "No patrons with refundable balance.", tone: "ok" });
      else toast.push({ text: `↩ Refunded ${res.count} patron${res.count === 1 ? "" : "s"}.`, tone: "ok" });
    } catch (e: any) {
      toast.push({ text: "Refund-all failed: " + (e?.shortMessage ?? e?.message ?? String(e)), tone: "err" });
    } finally {
      setProgress(null);
    }
  }

  return (
    <div style={{
      marginTop: 14, padding: 18, borderRadius: 6,
      background: "rgba(58,36,24,0.04)",
      border: "1px dashed rgba(58,36,24,0.35)",
    }}>
      <div style={{
        fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#3a2418",
        letterSpacing: "0.10em", textTransform: "uppercase", marginBottom: 8,
      }}>
        Admin · Recovery
      </div>
      <div style={{ fontSize: 12, color: "#5a3d2a", marginBottom: 12, lineHeight: 1.5 }}>
        Sign + broadcast a Refund for every patron with a positive balance.
        Used for governance kills or operational failures. Idempotent —
        unconsumed nonces are reused.
      </div>
      <button
        onClick={doRefundAll}
        disabled={refundAll.isPending}
        style={{
          width: "100%", padding: "10px 16px",
          background: "transparent", color: "#3a2418",
          border: "1px solid #3a2418", borderRadius: 4,
          font: "600 12px JetBrains Mono, monospace", letterSpacing: "0.08em",
          textTransform: "uppercase",
          cursor: refundAll.isPending ? "default" : "pointer",
          opacity: refundAll.isPending ? 0.6 : 1,
        }}
      >
        {progress ? `Refunding ${progress.i}/${progress.total}…` : "Refund all patrons →"}
      </button>
    </div>
  );
}

// ─── Admin escape hatch: pull USDC out of this intent to an arbitrary address.
//      Bypasses milestone gating; subject to MAX_RELEASE_PER_TX = 100k USDC.
//      Renders only for role=admin. ──────────────────────────────────────────

function AdminWithdrawCard({ intentId }: { intentId: `0x${string}` }) {
  const session = useSession();
  const withdraw = useAdminWithdraw();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [reasonText, setReasonText] = useState("ops-recovery");
  const intent = useIntent(intentId);

  if (session.data?.role !== "admin") return null;
  const remainingRaw =
    intent.data
      ? BigInt(intent.data.totalRaisedUsdc) - BigInt(intent.data.totalReleasedUsdc)
      : 0n;
  const remainingHuman = (Number(remainingRaw) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 });

  async function doWithdraw() {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      toast.push({ text: "Enter a positive USDC amount", tone: "err" });
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(to)) {
      toast.push({ text: "Destination must be a 0x-prefixed 20-byte address", tone: "err" });
      return;
    }
    if (!confirm(`Withdraw $${n} USDC from this intent to ${to}? This bypasses milestone gating.`)) return;
    try {
      const r = await withdraw.mutateAsync({
        intentId,
        amount: BigInt(Math.round(n * 1_000_000)),
        to: to as `0x${string}`,
        reasonText,
      });
      toast.push({ text: `⚠ Withdrew $${n} USDC · ${r.txHash.slice(0, 10)}…`, href: r.url, tone: "ok" });
      setAmount("");
    } catch (e: any) {
      toast.push({ text: "Withdraw failed: " + (e?.shortMessage ?? e?.message ?? String(e)), tone: "err" });
    }
  }

  return (
    <div style={{
      marginTop: 14, padding: 18, borderRadius: 6,
      background: "rgba(220, 38, 38, 0.04)",
      border: "1px dashed rgba(220, 38, 38, 0.4)",
    }}>
      <div style={{
        fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#7f1d1d",
        letterSpacing: "0.10em", textTransform: "uppercase", marginBottom: 8,
      }}>
        Admin · Escape hatch (adminWithdraw)
      </div>
      <div style={{ fontSize: 12, color: "#7f1d1d", marginBottom: 12, lineHeight: 1.5 }}>
        Pull USDC out of this intent's escrow to any address. **Skips
        milestone gating** — use only when patron refund-all isn't appropriate
        (corrupted signer key, lost scientist, etc). Capped at 100,000 USDC per tx.
        Available in escrow: <b>${remainingHuman}</b>.
      </div>
      <input
        type="number" placeholder="Amount (USDC)" value={amount}
        onChange={(e) => setAmount(e.target.value)}
        style={{
          width: "100%", padding: "8px 12px", marginBottom: 8, borderRadius: 4,
          border: "1px solid rgba(58,36,24,0.2)", background: "#fffaee",
          font: "13px JetBrains Mono, monospace",
        }}
      />
      <input
        type="text" placeholder="Destination 0x…" value={to}
        onChange={(e) => setTo(e.target.value)}
        style={{
          width: "100%", padding: "8px 12px", marginBottom: 8, borderRadius: 4,
          border: "1px solid rgba(58,36,24,0.2)", background: "#fffaee",
          font: "12px JetBrains Mono, monospace",
        }}
      />
      <input
        type="text" placeholder="Reason tag" value={reasonText}
        onChange={(e) => setReasonText(e.target.value)}
        style={{
          width: "100%", padding: "8px 12px", marginBottom: 10, borderRadius: 4,
          border: "1px solid rgba(58,36,24,0.2)", background: "#fffaee",
          font: "12px JetBrains Mono, monospace",
        }}
      />
      <button
        onClick={doWithdraw}
        disabled={withdraw.isPending}
        style={{
          width: "100%", padding: "10px 16px",
          background: "#b91c1c", color: "#faf3e3",
          border: "none", borderRadius: 4,
          font: "600 12px JetBrains Mono, monospace", letterSpacing: "0.08em",
          textTransform: "uppercase",
          cursor: withdraw.isPending ? "default" : "pointer",
          opacity: withdraw.isPending ? 0.6 : 1,
        }}
      >
        {withdraw.isPending ? "Withdrawing…" : "Admin withdraw →"}
      </button>
    </div>
  );
}
