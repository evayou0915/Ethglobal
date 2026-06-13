"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { api } from "@/client/api";
import { useAuth } from "@/client/auth";
import { useClaim, useIntents, useSession, useSubmitProof } from "@/client/hooks";
import { useToast } from "@/components/Toast";
import { txUrl } from "@/wagmi/config";
import { isWalrusBlobId, walrusBlobUrl } from "@/client/walrus";
import type { IntentDto, MilestoneDto, ScientistDto } from "@/types/api";

export default function ScientistDashboardPage() {
  const { ready, authenticated } = useAuth();
  const { address } = useAccount();
  const session = useSession();
  // The session wallet (from /me) is the address the Scientist row was
  // created under; wagmi's active address is only a fallback while the
  // /me query is still loading.
  const wallet = (session.data?.wallet ?? address ?? "").toString().toLowerCase() || null;

  const { data: scientist, isLoading, isError, error } = useQuery<ScientistDto & { intents?: unknown[] }>({
    queryKey: ["scientist", wallet],
    queryFn: () => api.getScientist(wallet!),
    enabled: !!wallet && ready && authenticated,
    retry: false,
  });

  // No real approval workflow exists yet — anyone who has a Scientist row
  // (i.e. completed /onboard with a verified ORCID or linked GitHub) is
  // treated as approved. Replace with a real `scientist.approvedAt` check
  // once an admin review flow lands.
  const approved = true;

  const email = session.data?.email ?? null;

  // ─── Loading / unauthenticated / not-onboarded gates ────────────────
  if (!ready || (ready && authenticated && wallet && isLoading)) {
    return (
      <section className="bpage">
        <div className="bpage-inner" style={{ maxWidth: 960, color: "var(--mute)", padding: "60px 0" }}>
          Loading scientist profile…
        </div>
      </section>
    );
  }

  if (ready && !authenticated) {
    return (
      <section className="bpage">
        <div className="bpage-inner" style={{ maxWidth: 720, padding: "60px 0" }}>
          <h1 style={{ fontFamily: "Newsreader, serif", fontWeight: 500, fontSize: 28 }}>Sign in to view your dashboard</h1>
          <p style={{ color: "var(--ink-3)", marginTop: 10 }}>Use the Login button in the top-right corner.</p>
        </div>
      </section>
    );
  }

  // 404 = User has no Scientist row yet → hasn't completed onboarding.
  const notFound = isError && /not found|404/i.test((error as Error | undefined)?.message ?? "");
  if (notFound || !scientist) {
    return (
      <section className="bpage">
        <div className="bpage-inner" style={{ maxWidth: 720, padding: "60px 0" }}>
          <h1 style={{ fontFamily: "Newsreader, serif", fontWeight: 500, fontSize: 28 }}>Complete onboarding first</h1>
          <p style={{ color: "var(--ink-3)", margin: "10px 0 20px", lineHeight: 1.6 }}>
            You haven&apos;t created a Lab Profile yet. Submit your identity for review to unlock the scientist dashboard.
          </p>
          <Link href="/onboard" style={{
            display: "inline-block", padding: "12px 22px", borderRadius: 6, background: "var(--ink)",
            color: "#faf3e3", textDecoration: "none", fontSize: 14, fontWeight: 500,
          }}>
            Go to onboarding →
          </Link>
        </div>
      </section>
    );
  }

  // ─── Derive presentation values from the real row ──────────────────
  const PROFILE = {
    name: scientist.displayName,
    handle: scientist.githubHandle ? `@${scientist.githubHandle}` : (scientist.orcid ? scientist.orcid : "—"),
    handleSource: scientist.githubHandle ? "github" as const : (scientist.orcid ? "orcid" as const : null),
    email: email ?? "—",
    affiliation: scientist.affiliation ?? "—",
    bio: scientist.bio ?? "Add a research bio to help patrons understand your work.",
  };

  return (
    <>
      <div className="bportrait-bg" />

      <section className="bpage">
        <div className="bpage-inner fade-in" style={{ maxWidth: 960 }}>
          <div className="pg-head">
            <h1>Scientist <em>dashboard</em></h1>
            <p>Manage your Lab Profile and research intents.</p>
          </div>

          <div className={"status-banner " + (approved ? "approved" : "pending")}>
            {approved ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            )}
            <div>
              <div className="a">{approved ? "Approved" : "Pending review"}</div>
              <div className="b">
                {approved
                  ? "Your profile has been verified by the AuraSci team. You can now publish Scientific Intent assets."
                  : "Your profile is being reviewed by the AuraSci team. This usually takes 24–48 hours."}
              </div>
            </div>
          </div>

          <div className="profile-card">
            <div className="profile-head">
              <div className="ph-row">
                <div className="ph-left">
                  <div className="avatar-lg">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="ph-name">{PROFILE.name}</h2>
                    <p className="ph-handle">{PROFILE.handle}</p>
                  </div>
                </div>
                <span className={"bpill " + (approved ? "verified" : "pending")}>
                  {approved ? "Verified" : "Pending review"}
                </span>
              </div>
            </div>

            <div className="profile-body">
              <div className="info-grid">
                <div className="info-cell">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                  <div>
                    <div className="l">Email</div>
                    <div className="v">{PROFILE.email}</div>
                  </div>
                </div>
                {scientist.githubHandle && (
                  <div className="info-cell">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                    </svg>
                    <div>
                      <div className="l">GitHub</div>
                      <div className="v">
                        <a href={`https://github.com/${scientist.githubHandle}`} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
                          @{scientist.githubHandle}
                        </a>
                      </div>
                    </div>
                  </div>
                )}
                {scientist.orcid && (
                  <div className="info-cell">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="8" r="7" />
                      <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
                    </svg>
                    <div>
                      <div className="l">ORCID iD {scientist.orcidVerified && <span style={{ color: "#65a30d", marginLeft: 4 }}>· verified</span>}</div>
                      <div className="v">
                        <a href={`https://orcid.org/${scientist.orcid}`} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none", fontFamily: "JetBrains Mono, monospace" }}>
                          {scientist.orcid}
                        </a>
                      </div>
                    </div>
                  </div>
                )}
                <div className={"info-cell" + ((scientist.githubHandle && scientist.orcid) ? " span-2" : "")}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
                    <path d="M9 22v-4h6v4" />
                  </svg>
                  <div>
                    <div className="l">Affiliation</div>
                    <div className="v">{PROFILE.affiliation}</div>
                  </div>
                </div>
              </div>

              <div className="bio-box">
                <div className="l">Research bio</div>
                <div className="v">{PROFILE.bio}</div>
              </div>
            </div>
          </div>

          <div className="actions">
            <h3>Actions</h3>
            <div className="actions-grid">
              {approved ? (
                <Link className="action-card" href="/create">
                  <div className="a">Create intent asset</div>
                  <div className="b">Open the 4-step publish flow</div>
                </Link>
              ) : (
                <div className="action-card disabled" aria-disabled="true">
                  <div className="a">Create intent asset</div>
                  <div className="b">Requires approved profile</div>
                </div>
              )}
            </div>
          </div>

          <MyIntentsSection scientistWallet={wallet!} />

        </div>
      </section>

      {/* Using `global` (not scoped) so styles also reach <Link>-rendered <a>
          elements — styled-jsx only attaches its scope class to host elements
          (div/button/span), not to React components. */}
      <style jsx global>{`
        .pg-head { margin-bottom: 32px; }
        .pg-head h1 { font-family: 'Newsreader', serif; font-weight: 500; font-size: clamp(2rem, 3.6vw, 2.8rem); color: var(--ink); margin: 0 0 10px; letter-spacing: -0.01em; }
        .pg-head h1 em { font-style: italic; color: var(--rust); }
        .pg-head p { font-size: 15px; color: var(--ink-3); margin: 0; max-width: 620px; line-height: 1.6; }

        .status-banner { margin-bottom: 32px; padding: 16px 20px; display: flex; align-items: center; gap: 14px; border-radius: 6px; transition: all .25s; }
        .status-banner.pending { border: 1px solid rgba(194,65,12,0.3); background: rgba(254,215,170,0.30); }
        .status-banner.pending svg { flex-shrink: 0; color: var(--rust); }
        .status-banner.approved { border: 1px solid rgba(101,163,13,0.40); background: rgba(101,163,13,0.10); }
        .status-banner.approved svg { flex-shrink: 0; color: #4d7c0f; }
        .status-banner .a { font-family: 'Newsreader', serif; font-weight: 500; font-size: 17px; color: var(--ink); letter-spacing: -0.005em; }
        .status-banner .b { font-size: 13px; color: var(--ink-3); margin-top: 2px; line-height: 1.5; }

        .profile-card { background: #fdfcf8; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
        .profile-head { padding: 24px; border-bottom: 1px solid var(--line-soft); }
        .ph-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .ph-left { display: flex; align-items: center; gap: 16px; }
        .avatar-lg { width: 64px; height: 64px; border-radius: 50%; background: linear-gradient(135deg, #fed7aa, #fb923c); border: 1px solid rgba(194,65,12,0.3); display: flex; align-items: center; justify-content: center; color: #7c2d12; }
        .ph-name { font-family: 'Newsreader', serif; font-weight: 500; font-size: 24px; color: var(--ink); margin: 0; letter-spacing: -0.01em; }
        .ph-handle { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--mute); margin-top: 2px; }
        .bpill.pending { color: var(--rust); border-color: rgba(194,65,12,0.4); background: rgba(254,215,170,0.30); }

        .profile-body { padding: 24px; display: flex; flex-direction: column; gap: 18px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        @media (max-width: 600px) { .info-grid { grid-template-columns: 1fr; } }
        .info-cell { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 6px; background: #faf3e3; border: 1px solid var(--line-soft); }
        .info-cell svg { color: var(--mute); flex-shrink: 0; }
        .info-cell .l { font-size: 12px; color: var(--mute); margin-bottom: 2px; }
        .info-cell .v { font-size: 14px; color: var(--ink-2); font-weight: 500; }
        .span-2 { grid-column: span 2; }
        @media (max-width: 600px) { .span-2 { grid-column: span 1; } }
        .bio-box { padding: 18px 20px; border-radius: 6px; background: #faf3e3; border: 1px solid var(--line-soft); }
        .bio-box .l { font-size: 12px; color: var(--mute); margin-bottom: 8px; }
        .bio-box .v { font-size: 14px; color: var(--ink-3); line-height: 1.7; }

        .actions { margin-top: 40px; }
        .actions h3 { font-family: 'Newsreader', serif; font-weight: 500; font-size: 24px; color: var(--ink); margin: 0 0 16px; letter-spacing: -0.01em; }
        .actions-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        @media (max-width: 600px) { .actions-grid { grid-template-columns: 1fr; } }
        .action-card { padding: 20px; border-radius: 6px; border: 1px solid var(--line); background: #fdfcf8; text-align: left; transition: all .2s; cursor: pointer; text-decoration: none; color: inherit; display: block; }
        .action-card:hover:not(.disabled) { border-color: var(--rust); transform: translateY(-1px); box-shadow: 0 8px 18px rgba(154,52,18,0.06); }
        .action-card.disabled { opacity: .55; cursor: not-allowed; }
        .action-card .a { font-family: 'Inter', sans-serif; font-weight: 600; font-size: 15px; color: var(--ink); margin-bottom: 4px; }
        .action-card .b { font-size: 13px; color: var(--mute); }

        /* ─── MyIntentsSection ────────────────────────────────────────── */
        .my-intents { margin-top: 40px; }
        .my-intents h3 { font-family: 'Newsreader', serif; font-weight: 500; font-size: 24px; color: var(--ink); margin: 0 0 16px; letter-spacing: -0.01em; }
        .intent-card { padding: 22px 24px; border-radius: 8px; border: 1px solid var(--line); background: #fdfcf8; margin-bottom: 16px; }
        .intent-card .ihead { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
        .intent-card .tk { font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 600; color: var(--rust); }
        .intent-card .title { font-family: 'Newsreader', serif; font-size: 19px; font-weight: 500; color: var(--ink); flex: 1; min-width: 240px; }
        .intent-card .status-pill { font-family: 'JetBrains Mono', monospace; font-size: 10px; padding: 4px 10px; border-radius: 999px; letter-spacing: .08em; text-transform: uppercase; background: rgba(254,215,170,0.30); color: var(--rust); border: 1px solid rgba(194,65,12,0.30); }
        .intent-card .status-pill.done { background: rgba(101,163,13,0.10); color: #4d7c0f; border-color: rgba(101,163,13,0.35); }
        .intent-card .status-pill.rejected { background: rgba(220,38,38,0.08); color: #b91c1c; border-color: rgba(220,38,38,0.35); }

        .ms-list { display: flex; flex-direction: column; gap: 10px; }
        .ms-row { display: grid; grid-template-columns: 56px 1fr auto; gap: 18px; align-items: start; padding: 14px 16px; border-radius: 6px; background: #faf3e3; border: 1px solid var(--line-soft); }
        .ms-row .label { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600; color: var(--rust); letter-spacing: .04em; padding-top: 2px; }
        .ms-row .body .t { font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 500; color: var(--ink); margin-bottom: 4px; line-height: 1.4; }
        .ms-row .body .amount { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); }
        .ms-row .ctrl { min-width: 220px; text-align: right; }

        .ms-btn { padding: 8px 14px; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500; border-radius: 4px; border: 1px solid var(--ink); background: var(--ink); color: #faf3e3; cursor: pointer; }
        .ms-btn:hover:not(:disabled) { background: var(--rust); border-color: var(--rust); }
        .ms-btn:disabled { opacity: .5; cursor: not-allowed; }
        .ms-btn.secondary { background: transparent; color: var(--ink-2); }
        .ms-btn.secondary:hover:not(:disabled) { border-color: var(--rust); color: var(--rust); background: transparent; }

        .ms-status { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: .04em; }
        .ms-status.locked { color: var(--mute); }
        .ms-status.pending { color: var(--rust); }
        .ms-status.done { color: #4d7c0f; }
        .ms-status.rejected { color: #b91c1c; }
        .ms-rationale { font-family: 'Inter', sans-serif; font-size: 11px; color: var(--mute); margin-top: 6px; line-height: 1.45; max-width: 220px; text-align: right; }

        .file-row { display: flex; gap: 8px; justify-content: flex-end; align-items: center; flex-wrap: wrap; }
        .file-name { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      `}</style>
    </>
  );
}

// ─── MyIntentsSection ─────────────────────────────────────────────────

function MyIntentsSection({ scientistWallet }: { scientistWallet: string }) {
  const q = useIntents({ scientist: scientistWallet.toLowerCase(), limit: 50 });
  // Hide intents the AI gatekeeper rejected — they're terminal, can't be
  // funded or have milestones submitted, and just clutter the dashboard
  // when a scientist iterated through several drafts before passing.
  // `useRejectedIntents` could later surface them in a separate "Archive"
  // section if anyone needs to revisit them.
  const intents = (q.data?.items ?? []).filter((i) => i.status !== "rejected");

  return (
    <div className="my-intents">
      <h3>My intent assets</h3>
      {q.isLoading && (
        <div style={{ padding: "28px 4px", textAlign: "center", color: "var(--mute)", font: "13px JetBrains Mono, monospace" }}>
          Loading your intents…
        </div>
      )}
      {!q.isLoading && intents.length === 0 && (
        <div style={{ padding: "28px 4px", textAlign: "center", color: "var(--mute)", font: "13px JetBrains Mono, monospace", border: "1px dashed var(--line)", borderRadius: 6, background: "#fdfcf8" }}>
          No intents yet. <Link href="/create" style={{ color: "var(--rust)" }}>Publish your first one →</Link>
        </div>
      )}
      {intents.map((i) => <IntentCard key={i.intentId} intent={i} />)}
    </div>
  );
}

function IntentCard({ intent }: { intent: IntentDto }) {
  const pill = pillFor(intent);
  // USDC currently sitting in escrow for this intent, available to release.
  // A milestone whose releaseAmountUsdc exceeds this would revert at the
  // contract level (insufficient escrow), so MilestoneControl uses it to
  // disable the claim button with an explicit "need $X more" hint instead
  // of letting the user trigger an on-chain revert.
  const escrowAvailableRaw =
    BigInt(intent.totalRaisedUsdc ?? "0") - BigInt(intent.totalReleasedUsdc ?? "0");
  return (
    <div className="intent-card">
      <div className="ihead">
        <span className="tk">{intent.ticker}</span>
        <span className="title">{intent.title}</span>
        <span className={"status-pill " + pill.kind}>{pill.label}</span>
      </div>
      <div className="ms-list">
        {intent.milestones.map((m) => (
          <MilestoneRow
            key={m.id}
            intentId={intent.intentId as `0x${string}`}
            milestone={m}
            escrowAvailableRaw={escrowAvailableRaw}
          />
        ))}
      </div>
    </div>
  );
}

function pillFor(intent: IntentDto): { label: string; kind: "" | "done" | "rejected" } {
  if (intent.status === "completed") return { label: "Completed", kind: "done" };
  if (intent.status === "rejected")  return { label: "Rejected", kind: "rejected" };
  if (intent.status === "ai_screening") return { label: "Awaiting gatekeeper", kind: "" };
  const released = intent.milestones.filter((m) => m.status === "released").length;
  if (released === 3) return { label: "All released", kind: "done" };
  return { label: `${released}/3 released`, kind: "" };
}

// ─── Per-milestone row, status-aware control on the right ──────────────

function MilestoneRow({
  intentId,
  milestone,
  escrowAvailableRaw,
}: {
  intentId: `0x${string}`;
  milestone: MilestoneDto;
  escrowAvailableRaw: bigint;
}) {
  const amount = (Number(BigInt(milestone.releaseAmountUsdc)) / 1e6).toLocaleString();
  const due = milestone.dueDate ? new Date(milestone.dueDate) : null;
  // "Overdue" only makes sense for milestones the scientist still owes work
  // on — once it's released we don't want to keep guilt-tripping them, and
  // for locked milestones the due date is informational only.
  const isActive =
    milestone.status === "in_progress" ||
    milestone.status === "proof_submitted" ||
    milestone.status === "ai_verifying";
  const overdue = !!(due && isActive && due.getTime() < Date.now());
  return (
    <div className="ms-row">
      <div className="label">M{milestone.idx}</div>
      <div className="body">
        <div className="t">{milestone.title}</div>
        <div className="amount">
          Releases ${amount} USDC
          {due && (
            <>
              <span style={{ margin: "0 8px", opacity: 0.5 }}>·</span>
              <span style={{ color: overdue ? "#b91c1c" : "var(--mute)" }}>
                {overdue ? "Overdue · " : "Due "}
                {due.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
              </span>
            </>
          )}
          {milestone.proofCid && isWalrusBlobId(milestone.proofCid) && (
            <>
              <span style={{ margin: "0 8px", opacity: 0.5 }}>·</span>
              <a
                href={walrusBlobUrl(milestone.proofCid)}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--mute)", textDecoration: "underline", textUnderlineOffset: 3 }}
                title={`Walrus blob ${milestone.proofCid}`}
              >
                Proof on Walrus ↗
              </a>
            </>
          )}
        </div>
      </div>
      <div className="ctrl">
        <MilestoneControl
          intentId={intentId}
          milestone={milestone}
          escrowAvailableRaw={escrowAvailableRaw}
        />
      </div>
    </div>
  );
}

/** Format a shortfall (raw 6-decimal USDC) like "$1.50". */
function formatShortfall(raw: bigint): string {
  const human = Number(raw) / 1e6;
  return "$" + human.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function MilestoneControl({
  intentId,
  milestone,
  escrowAvailableRaw,
}: {
  intentId: `0x${string}`;
  milestone: MilestoneDto;
  escrowAvailableRaw: bigint;
}) {
  // True when the escrow doesn't currently hold enough USDC to satisfy this
  // milestone's release — clicking claim would always revert on-chain
  // (InsufficientEscrow). The AI's release signature stays valid in the DB,
  // so once a patron tops up the funding the button re-enables automatically.
  const releaseRaw = BigInt(milestone.releaseAmountUsdc);
  const underfunded = releaseRaw > escrowAvailableRaw;
  const shortfall = underfunded ? releaseRaw - escrowAvailableRaw : 0n;

  switch (milestone.status) {
    case "locked":           return (
      <span className="ms-status locked">
        {milestone.idx === 0 ? "Awaiting publication" : `Awaiting M${milestone.idx - 1} release`}
      </span>
    );
    case "in_progress":      return <UploadProofControl intentId={intentId} milestone={milestone} />;
    case "proof_submitted":
      if (underfunded) {
        return (
          <span className="ms-status pending">
            Awaiting funding · need {formatShortfall(shortfall)} more in escrow
          </span>
        );
      }
      return <ClaimControl intentId={intentId} milestone={milestone} />;
    case "ai_verifying":
      // The AI scorer transitions the milestone to `ai_verifying` AND writes a
      // cached signature when (and only when) it passes. If both fields are
      // present, the human is between "AI signed" and "broadcast on-chain" —
      // most commonly because they cancelled the wallet popup. Surface a
      // "Resume claim →" button so they can retry the broadcast without
      // re-running AI. If no signature yet, the worker is still grading.
      if (milestone.releaseSignature && milestone.releaseNonce) {
        if (underfunded) {
          return (
            <span className="ms-status pending">
              Awaiting funding · need {formatShortfall(shortfall)} more in escrow
            </span>
          );
        }
        return <ClaimControl intentId={intentId} milestone={milestone} label="Resume claim →" />;
      }
      return <span className="ms-status pending">Pending verification…</span>;
    case "released":         return milestone.releaseTxHash
      ? <a className="ms-status done" href={txUrl(milestone.releaseTxHash)} target="_blank" rel="noreferrer">✓ Released · view tx ↗</a>
      : <span className="ms-status done">✓ Released</span>;
    case "rejected":         return (
      <>
        <span className="ms-status rejected">✗ AI rejected · score {milestone.aiScore ?? "—"}/100</span>
        {milestone.aiRationale && <div className="ms-rationale">{milestone.aiRationale}</div>}
      </>
    );
  }
}

// ─── in_progress → file picker + Upload proof ─────────────────────────

function UploadProofControl({ intentId, milestone }: { intentId: `0x${string}`; milestone: MilestoneDto }) {
  const [file, setFile] = useState<File | null>(null);
  // Local "just uploaded, waiting for refetch" flag — fixes the brief window
  // where useIntents is re-fetching but the cached milestone.status is still
  // `in_progress`, which would otherwise re-render this same upload UI with
  // the file cleared. Resets once the row re-renders with the new status.
  const [justUploaded, setJustUploaded] = useState(false);
  const submitProof = useSubmitProof();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  async function doUpload() {
    if (!file) {
      toast.push({ text: "Choose a file first", tone: "err" });
      return;
    }
    try {
      const r = await submitProof.mutateAsync({ intentId, idx: milestone.idx, file });
      // `cid` fallback keeps the toast working against a backend that
      // predates the Walrus migration (returns {cid} instead of {blobId}).
      const storedId = r.blobId ?? (r as { cid?: string }).cid ?? "";
      toast.push({
        text: `📎 Proof stored on Walrus · ${storedId.slice(0, 10)}…`,
        href: r.blobUrl,
        tone: "ok",
      });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setJustUploaded(true);
    } catch (e: any) {
      toast.push({ text: "Upload failed: " + (e?.message ?? String(e)), tone: "err" });
    }
  }

  if (justUploaded) {
    return <span className="ms-status pending">Uploaded · refreshing…</span>;
  }

  return (
    <div className="file-row">
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.zip,.tar,.csv,.txt,.json,.png,.jpg,.jpeg"
        style={{ display: "none" }}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {file && <span className="file-name" title={file.name}>{file.name}</span>}
      <button className="ms-btn secondary" onClick={() => fileRef.current?.click()} disabled={submitProof.isPending}>
        {file ? "Replace" : "Choose file"}
      </button>
      <button className="ms-btn" onClick={doUpload} disabled={!file || submitProof.isPending}>
        {submitProof.isPending ? "Uploading…" : "Upload proof →"}
      </button>
    </div>
  );
}

// ─── proof_submitted → Run AI verifier + claim ────────────────────────

function ClaimControl({
  intentId,
  milestone,
  label = "Run AI verifier → claim",
}: { intentId: `0x${string}`; milestone: MilestoneDto; label?: string }) {
  const claim = useClaim();
  const toast = useToast();

  async function doClaim() {
    try {
      const r = await claim.mutateAsync({ intentId, milestoneIdx: milestone.idx });
      toast.push({
        text: `✓ Released! score ${r.score}/100 · ${r.txHash.slice(0, 10)}…`,
        href: r.url,
        tone: "ok",
      });
    } catch (e: any) {
      toast.push({ text: e?.message ?? String(e), tone: "err" });
    }
  }

  return (
    <button className="ms-btn" onClick={doClaim} disabled={claim.isPending}>
      {claim.isPending ? "Broadcasting…" : label}
    </button>
  );
}
