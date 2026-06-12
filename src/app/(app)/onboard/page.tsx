"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/client/auth";
import { api } from "@/client/api";
import { useSession } from "@/client/hooks";
import { useSignInModal } from "@/client/sign-in-store";
import { useUpdateScientist } from "@/client/hooks";

type Step = 1 | 2;

const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

/** Auto-insert hyphens as the user types: 0000-0000-0000-0000 */
function formatOrcidInput(raw: string): string {
  const digits = raw.replace(/[^\dXx]/g, "").toUpperCase().slice(0, 16);
  return digits.replace(/(.{4})(?=.)/g, "$1-");
}

export default function OnboardPage() {
  const router = useRouter();
  const { ready, authenticated } = useAuth();
  const { address } = useAccount();
  const openSignIn = useSignInModal((s) => s.open);
  const updateScientist = useUpdateScientist();

  // If the user is already a Scientist, this page would otherwise show an
  // empty form ready to overwrite their profile — which is confusing.
  // Auto-redirect them to /scientist so the landing-page "Verify as a
  // scientist" button does the right thing for returning scientists too.
  // We try the session wallet plus wagmi's active address — same logic as
  // /portfolio — because the Scientist row PK may not match the wallet
  // wagmi is currently signing transactions from.
  const session = useSession();
  const meWallet = (session.data?.wallet ?? address ?? "").toString().toLowerCase() || null;
  const candidates: string[] = [];
  {
    const push = (w?: string | null) => {
      if (!w) return;
      const lc = w.toLowerCase();
      if (!candidates.includes(lc)) candidates.push(lc);
    };
    push(meWallet);
    push(address);
  }
  const existingScientistQ = useQuery({
    queryKey: ["existing-scientist", candidates],
    queryFn: async () => {
      for (const w of candidates) {
        try { return await api.getScientist(w); }
        catch { /* try next */ }
      }
      throw new Error("not a scientist");
    },
    enabled: ready && authenticated && candidates.length > 0,
    retry: false,
  });
  useEffect(() => {
    if (existingScientistQ.data) router.replace("/scientist");
  }, [existingScientistQ.data, router]);

  const [step, setStep] = useState<Step>(1);
  const [orcidPanelOpen, setOrcidPanelOpen] = useState(false);
  const [orcid, setOrcid] = useState("");
  const [name, setName] = useState("");
  const [aff, setAff] = useState("");
  const [bio, setBio] = useState("");
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const orcidValid = ORCID_RE.test(orcid);
  const hasIdentity = orcidValid;
  const wordCount = bio.trim().split(/\s+/).filter(Boolean).length;
  const canSubmit = hasIdentity && name.trim().length >= 2 && !updateScientist.isPending;
  const verifiedName = (updateScientist.data as any)?.orcidRegistryName as string | null | undefined;

  async function submit() {
    setSubmitErr(null);
    if (!ready || !authenticated) { openSignIn(); return; }
    try {
      await updateScientist.mutateAsync({
        displayName: name.trim(),
        orcid: orcidValid ? orcid : undefined,
        affiliation: aff.trim() || undefined,
        bio: bio.trim() || undefined,
      });
      setStep(2);
    } catch (e) {
      setSubmitErr((e as Error).message);
    }
  }

  // If we're checking, or already found a Scientist row, render a tiny
  // placeholder while the redirect runs (avoids the empty form flashing
  // in for a frame on returning scientists).
  if (ready && authenticated && (existingScientistQ.isLoading || existingScientistQ.data)) {
    return (
      <section className="bpage">
        <div className="bpage-inner" style={{ padding: "60px 0", color: "var(--mute)", textAlign: "center" }}>
          {existingScientistQ.data
            ? "You're already onboarded — opening your scientist dashboard…"
            : "Checking your scientist registration…"}
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="bportrait-bg" />

      <section className="bpage">
        <div className="bpage-inner fade-in" style={{ maxWidth: 780 }}>
          <div className="pg-head">
            <div className="eyebrow">Onboarding · Scientist</div>
            <h1>Establish your <em>research identity.</em></h1>
            <p>Connect your scholarly footprint and create the Lab Profile that every patron will read.</p>
          </div>

          <div className="stepper">
            <div className={"step-num " + (step === 1 ? "active" : "done")}>1</div>
            <span className={"step-label " + (step === 1 ? "active" : "")}>Profile</span>
            <div className={"step-line " + (step >= 2 ? "done" : "")} />
            <div className={"step-num " + (step === 2 ? "active" : "")}>2</div>
            <span className={"step-label " + (step === 2 ? "active" : "")}>Review</span>
          </div>

          <div className="form-card">

            {step === 1 && (
              <div className="pane active">
                <div className="sub">Step 01 · Identity &amp; profile</div>
                <h2>
                  <IconSm><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></IconSm>
                  Connect &amp; complete profile
                </h2>
                <p style={{ fontSize: 14, color: "var(--ink-3)", margin: "0 0 22px", lineHeight: 1.6 }}>
                  Verify authorship with your ORCID iD, then fill out your lab profile.
                </p>

                <div className="subhead">A · Connect identity</div>

                <div className="oauth-grid single">
                  <button
                    type="button"
                    className={"oauth-btn" + (orcidValid ? " connected" : "") + (orcidPanelOpen ? " expanded" : "")}
                    onClick={() => setOrcidPanelOpen((v) => !v)}
                  >
                    <div className="oauth-icon">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="8" r="7" />
                        <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
                      </svg>
                    </div>
                    <div className="oauth-meta">
                      <div className="a">ORCID</div>
                      <div className="b">{orcidValid ? orcid : (orcidPanelOpen ? "enter iD below" : "click to enter iD")}</div>
                    </div>
                    <span className="ok">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                  </button>
                </div>

                {orcidPanelOpen && (
                  <div className="field" style={{ marginTop: 16 }}>
                    <label htmlFor="orcid-input">
                      ORCID iD <span className="word-count">(format: 0000-0000-0000-0000)</span>
                    </label>
                    <input
                      id="orcid-input"
                      className="input"
                      type="text"
                      inputMode="numeric"
                      placeholder="0009-0006-7071-9418"
                      value={orcid}
                      onChange={(e) => setOrcid(formatOrcidInput(e.target.value))}
                      maxLength={19}
                      autoFocus
                    />
                    <div className="orcid-help">
                      Don&apos;t have one? Register free at{" "}
                      <a href="https://orcid.org/register" target="_blank" rel="noreferrer">orcid.org/register</a>.
                      We&apos;ll check the iD against the public ORCID registry; a Council reviewer cross-checks
                      ownership within 48 h.
                    </div>
                  </div>
                )}

                {hasIdentity && (
                  <div className="connected-handle show">
                    Verified · {`ORCID ${orcid}`}
                  </div>
                )}

                <div className={"profile-block" + (hasIdentity ? " show" : "")}>
                  <div className="subhead">B · Lab profile</div>

                  <div className="field">
                    <label>
                      <span className="icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                      </span>
                      Full name
                    </label>
                    <input className="input" type="text" placeholder="Dr. Alice Smith" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>

                  <div className="field">
                    <label>
                      <span className="icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
                          <path d="M9 22v-4h6v4" /><path d="M8 6h.01" /><path d="M16 6h.01" /><path d="M12 6h.01" />
                        </svg>
                      </span>
                      Affiliation
                    </label>
                    <input className="input" type="text" placeholder="Stanford University · Bioengineering" value={aff} onChange={(e) => setAff(e.target.value)} />
                  </div>

                  <div className="field">
                    <label>
                      Research bio <span className="word-count">({wordCount} words, optional)</span>
                    </label>
                    <textarea
                      className="input"
                      placeholder="Tell patrons about your research focus, methods, and prior work…"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                    />
                  </div>
                </div>

                {submitErr && (
                  <div className="submit-err">
                    {submitErr}
                  </div>
                )}

                <div className="form-foot">
                  <Link className="btn-back" href="/">← Cancel</Link>
                  <button className="btn-next" disabled={!canSubmit} onClick={submit}>
                    {updateScientist.isPending ? "Verifying with ORCID…" : "Submit for review"}{" "}
                    <span style={{ fontFamily: "JetBrains Mono, monospace" }}>↗</span>
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="pane active">
                <div className="sub">Step 02 · Review</div>
                <h2>
                  <IconSm><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></IconSm>
                  Identity verified · Awaiting AuraSci Council review
                </h2>
                <p style={{ fontSize: 14, color: "var(--ink-3)", lineHeight: 1.7, margin: "8px 0 22px" }}>
                  Your linked identity has been confirmed. A Council reviewer will cross-check ownership against
                  your stated identity within 48 h — once approved, you can publish Intents on the Market.
                </p>

                <div className="review-grid">
                  {orcidValid && (
                    <div className="review-cell">
                      <div className="k">ORCID iD</div>
                      <div className="v" style={{ fontFamily: "JetBrains Mono, monospace", fontWeight: 600 }}>{orcid}</div>
                    </div>
                  )}
                  {verifiedName && (
                    <div className="review-cell">
                      <div className="k">Registry name</div>
                      <div className="v">{verifiedName}</div>
                    </div>
                  )}
                  <div className="review-cell">
                    <div className="k">Display name</div>
                    <div className="v">{name}</div>
                  </div>
                  <div className="review-cell">
                    <div className="k">Affiliation</div>
                    <div className="v">{aff || "—"}</div>
                  </div>
                </div>

                <div className="status-grid">
                  <div className="cell"><div className="k">Status</div><div className="v">Under review</div></div>
                  <div className="cell"><div className="k">Decision by</div><div className="v">≤ 48 h</div></div>
                  <div className="cell"><div className="k">Reviewers</div><div className="v">5 AuraSci councilors</div></div>
                </div>

                <div className="form-foot">
                  <button className="btn-back" onClick={() => setStep(1)}>← Edit profile</button>
                  <Link className="btn-next" href="/scientist">
                    Open scientist dashboard <span style={{ fontFamily: "JetBrains Mono, monospace" }}>↗</span>
                  </Link>
                </div>
              </div>
            )}

          </div>

          <div className="helper-note">
            Profile reviewed by the AuraSci Council within 48 h · Handles linked via ORCID
          </div>
        </div>
      </section>

      <style jsx global>{`
        .pg-head { margin-bottom: 30px; }
        .pg-head .eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--rust); letter-spacing: .18em; text-transform: uppercase; margin-bottom: 14px; display: flex; align-items: center; gap: 10px; }
        .pg-head .eyebrow::before { content: ''; width: 18px; height: 1px; background: var(--rust); }
        .pg-head h1 { font-family: 'Newsreader', serif; font-weight: 500; font-size: clamp(2rem, 3.6vw, 2.8rem); color: var(--ink); margin: 0 0 10px; letter-spacing: -0.01em; line-height: 1.05; }
        .pg-head h1 em { font-style: italic; color: var(--rust); }
        .pg-head p { font-size: 15px; color: var(--ink-3); margin: 0; max-width: 560px; line-height: 1.6; }

        .stepper { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 32px; }
        .step-num { width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 600; background: #fdfcf8; color: var(--mute); border: 1px solid var(--line); transition: all .25s; }
        .step-num.active { background: var(--rust); color: #faf3e3; border-color: var(--rust); box-shadow: 0 0 0 4px rgba(194,65,12,0.12); }
        .step-num.done { background: #65a30d; color: #faf3e3; border-color: #65a30d; }
        .step-line { width: 80px; height: 1px; background: rgba(58,36,24,0.2); transition: all .25s; }
        .step-line.done { background: #65a30d; }
        .step-label { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); letter-spacing: .12em; text-transform: uppercase; margin-left: 2px; }
        .step-label.active { color: var(--rust); }

        .form-card { padding: 30px; border-radius: 6px; border: 1px solid var(--line); background: #fdfcf8; position: relative; }
        .form-card::before, .form-card::after { content: ''; position: absolute; width: 16px; height: 16px; border: 1.5px solid var(--rust); opacity: .5; }
        .form-card::before { top: -1px; left: -1px; border-right: none; border-bottom: none; }
        .form-card::after { bottom: -1px; right: -1px; border-left: none; border-top: none; }
        .form-card h2 { font-family: 'Newsreader', serif; font-weight: 500; font-size: 22px; color: var(--ink); margin: 0 0 6px; display: flex; align-items: center; gap: 10px; letter-spacing: -0.01em; }
        .form-card .sub { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); margin: 0 0 24px; letter-spacing: .08em; text-transform: uppercase; }

        .pane.active { display: block; }

        .form-card label { display: block; font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 500; color: var(--mute); margin-bottom: 8px; letter-spacing: .12em; text-transform: uppercase; }
        .form-card label .icon { display: inline-flex; vertical-align: -3px; margin-right: 6px; color: var(--rust); }
        .field { margin-bottom: 20px; }
        .input { width: 100%; padding: 13px 14px; border-radius: 6px; border: 1px solid var(--line); background: #faf3e3; font-family: 'Inter', sans-serif; font-size: 14px; color: var(--ink); transition: all .2s; box-sizing: border-box; }
        .input:focus { outline: none; border-color: var(--rust); background: #fffaee; box-shadow: 0 0 0 3px rgba(194,65,12,0.10); }
        textarea.input { resize: none; min-height: 130px; line-height: 1.6; font-family: inherit; }
        .word-count { color: var(--mute); font-size: 11px; margin-left: 6px; text-transform: none; letter-spacing: 0; font-weight: 400; }

        .subhead { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--rust); letter-spacing: .14em; text-transform: uppercase; margin: 6px 0 14px; display: flex; align-items: center; gap: 10px; }
        .subhead::before { content: ''; width: 14px; height: 1px; background: var(--rust); }

        .oauth-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 6px; }
        .oauth-grid.single { grid-template-columns: 1fr; }
        @media (max-width: 600px) { .oauth-grid { grid-template-columns: 1fr; } }
        .oauth-btn { text-align: left; padding: 18px; border-radius: 6px; border: 1px solid var(--line); background: #faf3e3; display: flex; align-items: center; gap: 14px; cursor: pointer; transition: all .2s; font-family: inherit; position: relative; }
        .oauth-btn:hover { border-color: var(--rust); background: rgba(254,215,170,0.30); }
        .oauth-btn.connected { border-color: #65a30d; background: rgba(101,163,13,0.06); }
        .oauth-icon { width: 42px; height: 42px; border-radius: 8px; background: rgba(254,215,170,0.40); display: flex; align-items: center; justify-content: center; color: var(--rust); flex-shrink: 0; }
        .oauth-btn.connected .oauth-icon { background: rgba(101,163,13,0.15); color: #4d7c0f; }
        .oauth-meta .a { font-size: 14px; font-weight: 600; color: var(--ink); margin-bottom: 2px; }
        .oauth-meta .b { font-size: 12px; color: var(--mute); font-family: 'JetBrains Mono', monospace; }
        .oauth-btn .ok { position: absolute; top: 12px; right: 12px; display: none; color: #65a30d; }
        .oauth-btn.connected .ok { display: block; }

        .connected-handle { margin-top: 18px; padding: 12px 14px; border-radius: 6px; background: rgba(101,163,13,0.08); border: 1px solid rgba(101,163,13,0.35); font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #4d7c0f; font-weight: 500; display: none; align-items: center; gap: 8px; letter-spacing: 0; text-transform: none; }
        .connected-handle::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #65a30d; box-shadow: 0 0 0 3px rgba(101,163,13,0.2); }
        .connected-handle.show { display: flex; }

        .profile-block { margin-top: 30px; padding-top: 26px; border-top: 1px dashed rgba(58,36,24,0.18); opacity: 0; max-height: 0; overflow: hidden; transition: opacity .3s ease, max-height .4s ease; }
        .profile-block.show { opacity: 1; max-height: 1400px; }

        .review-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
        @media (max-width: 600px) { .review-grid { grid-template-columns: 1fr; } }
        .review-cell { padding: 14px; border-radius: 6px; background: #faf3e3; border: 1px solid var(--line); }
        .review-cell .k { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); letter-spacing: .1em; text-transform: uppercase; margin-bottom: 6px; }
        .review-cell .v { font-family: 'Newsreader', serif; font-size: 17px; color: var(--ink); line-height: 1.4; }

        .status-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
        .status-grid .cell { padding: 14px; border-radius: 6px; background: #faf3e3; border: 1px solid var(--line); }
        .status-grid .k { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); letter-spacing: .08em; text-transform: uppercase; margin-bottom: 6px; }
        .status-grid .v { font-family: 'Newsreader', serif; font-size: 18px; color: var(--ink); }

        .form-foot { margin-top: 32px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
        .btn-back { padding: 13px 22px; border-radius: 6px; background: transparent; border: 1px solid var(--line); color: var(--ink-2); font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 500; cursor: pointer; transition: all .2s; text-decoration: none; }
        .btn-back:hover { border-color: var(--rust); color: var(--rust); }
        .btn-next { padding: 13px 26px; border-radius: 6px; background: var(--ink); border: none; color: #faf3e3; font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 500; cursor: pointer; transition: all .2s; display: inline-flex; align-items: center; gap: 10px; text-decoration: none; }
        .btn-next:hover { background: var(--rust); }
        .btn-next[disabled] { opacity: .4; cursor: not-allowed; }
        .btn-next[disabled]:hover { background: var(--ink); }

        .helper-note { margin-top: 16px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); text-align: center; letter-spacing: .05em; }

        .orcid-help { margin-top: 8px; font-size: 12px; color: var(--mute); line-height: 1.55; letter-spacing: 0; text-transform: none; font-weight: 400; font-family: 'Inter', sans-serif; }
        .orcid-help a { color: var(--rust); text-decoration: underline; }

        .submit-err { margin-top: 16px; padding: 12px 14px; border-radius: 6px; background: rgba(194,65,12,0.08); border: 1px solid rgba(194,65,12,0.35); color: #9a3412; font-size: 13px; line-height: 1.5; font-family: 'Inter', sans-serif; }
      `}</style>
    </>
  );
}

function IconSm({ children }: { children: React.ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--rust)" }}>
      {children}
    </svg>
  );
}
