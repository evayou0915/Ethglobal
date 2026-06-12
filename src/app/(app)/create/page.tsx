"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { api } from "@/client/api";
import { useToast } from "@/components/Toast";
import { useSignInModal } from "@/client/sign-in-store";
import type { AgentVerdictDto } from "@/types/api";

// ─── State + helpers ────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4;
type PhaseState = "queued" | "active" | "done";
type AgentName = "ATLAS-7" | "HELIX-3" | "ORCHID-9" | "VESTA-2" | "LYRA-5";

const AGENTS: AgentName[] = ["ATLAS-7", "HELIX-3", "ORCHID-9", "VESTA-2", "LYRA-5"];

type Milestone = { desc: string; crit: string; amt: number; due: string };


const ROMAN = (i: number) => "M" + (i + 1);

const tickerFromTitle = (title: string) => {
  const w = (title.match(/[A-Za-z]{3,}/g) ?? []).filter(
    (x) => !["the", "and", "for", "with", "from", "that", "this", "open", "science"].includes(x.toLowerCase()),
  );
  return "$" + (w[0] ?? "ASSET").slice(0, 4).toUpperCase() + "-01";
};

// ─── Page ───────────────────────────────────────────────────────────────

export default function CreateIntentPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);

  // Step 1 fields
  const [title, setTitle] = useState("Targeting senescent cells to reverse cardiac fibrosis");
  const [hypothesis, setHypothesis] = useState(
    "Senescent cells accumulate in aged cardiac tissue, driving fibrosis and dysfunction. " +
    "Selective elimination via mRNA-based therapeutic should reverse fibrosis and restore cardiac function in murine models.",
  );
  const [tags, setTags] = useState<string[]>(["Longevity", "AI-Bio", "Tier-1"]);
  const [tagInput, setTagInput] = useState("");

  // Step 2 milestones — fixed at exactly 3. The backend enforces 3
  // (intents.ts CreateIntentSchema `.length(3)`) and the indexer's milestone
  // progression assumes idx 0/1/2, so the UI must not let users add/remove.
  const [milestones, setMilestones] = useState<Milestone[]>([
    { desc: "Compile comprehensive senescent cell biomarker dataset from cardiac tissue samples", crit: "Dataset passes quality audit · >95% annotation accuracy", amt: 40000, due: "" },
    { desc: "Demonstrate selective senescent cell clearance in vitro cardiac tissue models",      crit: "Peer-reviewed preprint · reproducible protocol on bioRxiv",   amt: 55000, due: "" },
    { desc: "Validate cardiac function recovery in murine model post senolytic treatment",        crit: "Echocardiogram + histology · ≥30% fibrosis reduction (n≥12)", amt: 35000, due: "" },
  ]);

  const totalAmt = milestones.reduce((s, m) => s + (Number(m.amt) || 0), 0);

  function setMilestoneAt(i: number, next: Milestone) {
    setMilestones((arr) => arr.map((m, j) => (j === i ? next : m)));
  }
  // No add/remove: the milestone count is fixed at 3 (see note above).

  function commitTag(raw: string) {
    const t = raw.trim().replace(/^#+/, "").replace(/\s+/g, "-");
    if (!t) return;
    if (t.length > 32) return;
    if (tags.includes(t)) { setTagInput(""); return; }
    if (tags.length >= 10) return;
    setTags((arr) => [...arr, t]);
    setTagInput("");
  }
  function removeTag(t: string) {
    setTags((arr) => arr.filter((x) => x !== t));
  }

  // Step 2 ticker (user can override)
  const [ticker, setTicker] = useState("$CELL-01");
  const [tickerEdited, setTickerEdited] = useState(false);
  useEffect(() => {
    if (!tickerEdited) setTicker(tickerFromTitle(title));
  }, [title, tickerEdited]);

  // Resource asks
  const [resources, setResources] = useState<Record<string, boolean>>({ gpu: true, lab: false });

  // Step 3
  const [attest, setAttest] = useState(false);

  // Step 4 Setu animation
  const [phaseStates, setPhaseStates] = useState<PhaseState[]>(["queued", "queued", "queued"]);
  const [logs, setLogs] = useState<string[][]>([[], [], []]);
  const [setuDone, setSetuDone] = useState(false);
  const animTimers = useRef<NodeJS.Timeout[]>([]);

  // Real backend call running in parallel with the animation.
  const { isConnected } = useAccount();
  const toast = useToast();
  const openSignIn = useSignInModal((s) => s.open);
  const [serverIntentId, setServerIntentId] = useState<`0x${string}` | null>(null);
  const [serverScore, setServerScore] = useState<number | null>(null);
  const [serverRejected, setServerRejected] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  // Per-agent verdicts from the 5-persona quorum, populated when the AI
  // worker finishes. We render the chip's color/score from this — no fake
  // staggered approvals.
  const [verdicts, setVerdicts] = useState<AgentVerdictDto[] | null>(null);

  const verdictByAgent = (name: AgentName): AgentVerdictDto | undefined =>
    verdicts?.find((v) => v.agent === name);

  // Step 4 auto-play
  useEffect(() => {
    if (step !== 4) return;
    setPhaseStates(["queued", "queued", "queued"]);
    setLogs([[], [], []]);
    setVerdicts(null);
    setSetuDone(false);
    setServerIntentId(null);
    setServerScore(null);
    setServerRejected(null);
    setServerError(null);

    // Phases 1 and 2 ("Broadcast" + "Ledger inscription") are pure
    // theater — kept for visual rhythm while the real 5-agent quorum runs.
    // Phase 3 is real: we wait for the AI worker to return per-agent
    // verdicts and reveal each chip from the actual response.
    (async () => {
      if (!isConnected) {
        setServerError("Connect your wallet to publish this intent.");
        return;
      }
      try {
        const category = (tags[0] ?? "Bio").trim() || "Bio";
        const goal = totalAmt * 1_000_000;             // human USDC → 6-decimal units
        const body = {
          ticker,
          title,
          descriptionMd: hypothesis,
          category,
          tags,
          fundingGoalUsdc: String(goal),
          milestones: milestones.map((m) => ({
            title: (m.desc ?? "").slice(0, 200),
            descriptionMd: `${m.desc}\n\nVerification criteria: ${m.crit}`,
            releaseAmountUsdc: String(m.amt * 1_000_000),
            // Backend expects RFC3339 datetime; the <input type="date"> gives
            // us "YYYY-MM-DD" — append a UTC midnight time so Zod's .datetime()
            // validator accepts it. Empty strings pass through as omitted.
            ...(m.due ? { dueDate: new Date(m.due + "T00:00:00Z").toISOString() } : {}),
          })),
        };
        const created = await api.createIntent(body);
        const finalJob = await api.waitForJob(created.job.id, { timeoutMs: 180_000 });
        if (finalJob.status === "failed") {
          setServerError(`AI gatekeeper crashed: ${finalJob.error ?? "unknown"}`);
          return;
        }
        // Surface each agent's real verdict to the UI in arrival order.
        const vs = finalJob.agentVerdicts ?? [];
        setVerdicts(vs);
        for (let i = 0; i < vs.length; i++) {
          const v = vs[i];
          setLogs(([a, b, c]) => [a, b, [...c, `▸ ${v.agent} · ${v.approved ? "approved" : "rejected"} · ${v.score}/100`]]);
          await new Promise((r) => setTimeout(r, 250));
        }
        const approveCount = vs.filter((v) => v.approved).length;
        setLogs(([a, b, c]) => [a, b, [...c, `▸ consensus · ${approveCount}/${vs.length || 5} approve · mean ${finalJob.score ?? 0}/100`]]);
        setPhaseStates(["done", "done", "done"]);
        setSetuDone(true);

        setServerScore(finalJob.score ?? null);
        if ((finalJob.score ?? 0) < 70 || approveCount < 3) {
          setServerRejected(finalJob.rationale ?? "Quorum failed.");
        }
        setServerIntentId(created.intent.intentId as `0x${string}`);
      } catch (e: any) {
        setServerError(e?.message ?? String(e));
      }
    })();

    const t = (ms: number, fn: () => void) => { animTimers.current.push(setTimeout(fn, ms)); };

    // Phase 1: Broadcast (decorative)
    t(400, () => {
      setPhaseStates(["active", "queued", "queued"]);
      setLogs(([_, b, c]) => [["▸ encoding intent payload…"], b, c]);
    });
    t(900,  () => setLogs(([_, b, c]) => [["▸ encoding intent payload…", "▸ payload encoded"], b, c]));
    t(1500, () => setLogs(([_, b, c]) => [["▸ encoding intent payload…", "▸ payload encoded", "▸ broadcasting to network · ok"], b, c]));
    t(2000, () => setPhaseStates(["done", "active", "queued"]));

    // Phase 2: Ledger inscription (decorative)
    t(2300, () => setLogs(([a, _, c]) => [a, ["▸ writing canonical record…"], c]));
    t(3000, () => setLogs(([a, _, c]) => [a, ["▸ writing canonical record…", "▸ anchored to ledger"], c]));
    t(3600, () => setLogs(([a, _, c]) => [a, ["▸ writing canonical record…", "▸ anchored to ledger", "▸ asset id · " + ticker.toLowerCase()], c]));
    t(4100, () => setPhaseStates(["done", "done", "active"]));

    // Phase 3: Agent quorum is filled by the real verdicts above; just
    // seed an opening log line here so the panel isn't empty during the
    // wait between phase 2 ending and the LLM returning.
    t(4400, () => setLogs(([a, b, _]) => [a, b, ["▸ quorum opened · 5 gatekeepers selected", "▸ awaiting agent verdicts…"]]));

    return () => {
      animTimers.current.forEach(clearTimeout);
      animTimers.current = [];
    };
  }, [step, ticker]);

  // Validation
  const canStep2 = title.trim().length >= 4 && hypothesis.trim().length >= 20;
  const canStep3 = milestones.length > 0 && milestones.every((m) => m.desc.trim().length > 0) && totalAmt > 0;
  const canStep4 = attest;

  return (
    <>
      <div className="bportrait-bg" />

      <section className="bpage">
        <div className="bpage-inner fade-in" style={{ maxWidth: 780 }}>
          <div className="pg-head">
            <div className="eyebrow">Create · Intent Asset</div>
            <h1>Define your research <em>milestones.</em></h1>
            <p>Break the work into 3 verifiable milestones, then publish to the Setu Network for agent consensus review.</p>
          </div>

          <Stepper step={step} />

          <div className="form-card">
            {step === 1 && (
              <div className="pane active">
                <div className="sub">Step 01 · Research blueprint</div>
                <h2>
                  <PageIcon kind="blueprint" />
                  Title, hypothesis & tags
                </h2>

                <div className="field">
                  <label>Title <span className="req">*</span></label>
                  <input className="input" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="field">
                  <label>Hypothesis <span className="req">*</span></label>
                  <textarea className="input" value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} />
                </div>
                <div className="field">
                  <label>Tags</label>
                  <div>
                    {tags.map((t) => (
                      <span key={t} className="tag-chip">
                        #{t}
                        <button
                          type="button"
                          className="tag-x"
                          aria-label={`remove tag ${t}`}
                          onClick={() => removeTag(t)}
                        >×</button>
                      </span>
                    ))}
                  </div>
                  <input
                    className="input"
                    type="text"
                    placeholder="Add tag and press Enter..."
                    style={{ marginTop: 8 }}
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        commitTag(tagInput);
                      } else if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
                        // Pop the last tag when the input is empty and user hits backspace.
                        e.preventDefault();
                        setTags((arr) => arr.slice(0, -1));
                      }
                    }}
                    onBlur={() => { if (tagInput.trim()) commitTag(tagInput); }}
                  />
                </div>

                <div className="form-foot">
                  <a className="btn-back" href="/scientist" style={{ textDecoration: "none" }}>← Cancel</a>
                  <button className="btn-next" disabled={!canStep2} onClick={() => setStep(2)}>
                    Continue to milestones <span style={{ fontFamily: "JetBrains Mono, monospace" }}>↗</span>
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="pane active">
                <div className="sub">Step 02 · Milestone definition</div>
                <h2>
                  <PageIcon kind="milestone" />
                  Milestones · {String(milestones.length).padStart(2, "0")}
                </h2>

                {milestones.map((m, i) => (
                  <MilestoneBlock
                    key={i}
                    label={`${ROMAN(i)} — Milestone`}
                    ms={m}
                    setMs={(next) => setMilestoneAt(i, next)}
                  />
                ))}

                <div className="field" style={{ marginTop: 24 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--rust)" }}>
                      <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
                      <rect x="9" y="9" width="6" height="6" />
                    </svg>
                    Resource asks
                  </label>
                  <div className="res-grid">
                    <button
                      type="button"
                      className={"res-card" + (resources.gpu ? " selected" : "")}
                      onClick={() => setResources((r) => ({ ...r, gpu: !r.gpu }))}
                    >
                      <div className="a">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: resources.gpu ? "var(--rust)" : "var(--mute)" }}>
                          <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
                          <rect x="9" y="9" width="6" height="6" />
                        </svg>
                        <span>500 H100 GPU hrs</span>
                      </div>
                      <div className="b">For biomarker dataset training</div>
                    </button>
                    <button
                      type="button"
                      className={"res-card" + (resources.lab ? " selected" : "")}
                      onClick={() => setResources((r) => ({ ...r, lab: !r.lab }))}
                    >
                      <div className="a">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: resources.lab ? "var(--rust)" : "var(--mute)" }}>
                          <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" />
                        </svg>
                        <span>Wet lab access</span>
                      </div>
                      <div className="b">BSL-2 facility for in vitro experiments</div>
                    </button>
                  </div>
                </div>

                <div className="preview-box">
                  <div className="l">Asset ticker · auto-generated from title, click to override</div>
                  <div
                    className="preview-ticker"
                    contentEditable
                    suppressContentEditableWarning
                    onInput={(e) => { setTickerEdited(true); setTicker(e.currentTarget.textContent || ""); }}
                  >
                    {ticker}
                  </div>
                  <div className="preview-meta">Total ask · ${totalAmt.toLocaleString()} USDC · 03 milestones · season 094</div>
                </div>

                <div className="form-foot">
                  <button className="btn-back" onClick={() => setStep(1)}>← Back</button>
                  <button className="btn-next" disabled={!canStep3} onClick={() => setStep(3)}>
                    Continue to review <span style={{ fontFamily: "JetBrains Mono, monospace" }}>↗</span>
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="pane active">
                <div className="sub">Step 03 · Review & submit</div>
                <h2>
                  <PageIcon kind="check" />
                  Review and submit for Setu inscription
                </h2>

                <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--mute)", letterSpacing: "0.06em", margin: "0 0 16px" }}>
                  Editable preview · changes here sync back to step 01 / 02.
                </p>

                <div className="review-grid">
                  <ReviewCell k="Ticker"           v={ticker} mono bold />
                  <ReviewCell k="Total ask"        v={`$${totalAmt.toLocaleString()} USDC`} />
                  <ReviewCell k="Title"            v={title} />
                  <ReviewCell k="Hypothesis"       v={hypothesis} small />
                  <ReviewCell k="Season · review SLA" v="094 · ≤ 48 h" span2 />
                </div>

                <div className="review-list">
                  <div className="k">Milestones · {String(milestones.length).padStart(2, "0")}</div>
                  {milestones.map((m, i) => (
                    <ReviewRow key={i} l={ROMAN(i)} d={m.desc} a={`$${(m.amt / 1000).toFixed(0)}k`} />
                  ))}
                </div>

                <div className="review-list">
                  <div className="k">Resource asks · {Object.values(resources).filter(Boolean).length.toString().padStart(2, "0")}</div>
                  {resources.gpu && <ReviewRow l="GPU" d="500 H100 GPU hrs · biomarker training" a="included" />}
                  {resources.lab && <ReviewRow l="LAB" d="Wet lab access · BSL-2 facility" a="included" />}
                </div>

                <label className="attest">
                  <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
                  <span>I attest the data and milestones above are accurate. On submission, this intent will be inscribed on the Setu network and reviewed by a quorum of Gatekeeper agents before going live in the market. Once funded, milestone releases are agent-verified — no manual override.</span>
                </label>

                <div className="form-foot">
                  <button className="btn-back" onClick={() => setStep(2)}>← Back</button>
                  <button className="btn-next" disabled={!canStep4} onClick={() => setStep(4)}>
                    Submit to Setu network <span style={{ fontFamily: "JetBrains Mono, monospace" }}>↗</span>
                  </button>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="pane active">
                <div className="sub">Step 04 · Publish to Setu</div>
                <h2>
                  <PageIcon kind="globe" />
                  Inscribing <span style={{ color: "var(--rust)" }}>{ticker}</span> on Setu
                </h2>

                <div className="setu-stage">
                  <div className="setu-intro">
                    <div className="pulse-ring"><div className="pulse-core">SETU</div></div>
                    <h3>Your <em>intent asset</em> is going live.</h3>
                    <p>Setu records your milestone blueprint in the trust ledger and routes it to a quorum of Gatekeeper agents for consensus review.</p>
                  </div>

                  <div className="setu-phases">
                    <SetuPhase n="01" title="Broadcast to Setu network"
                      desc="Encoding the intent payload (title, hypothesis, milestones, resource asks) and broadcasting it across Setu nodes."
                      state={phaseStates[0]} log={logs[0]} />
                    <SetuPhase n="02" title="Inscribe on Setu ledger"
                      desc="A canonical record is written to the Setu ledger — your asset gets a permanent ID, hash, and season anchor."
                      state={phaseStates[1]} log={logs[1]} />
                    <SetuPhase n="03" title="Agent consensus review"
                      desc="A quorum of 5 Gatekeeper agents evaluates milestone clarity, scientific plausibility, and verification feasibility. 3 of 5 must approve."
                      state={phaseStates[2]} log={logs[2]}
                      agents={
                        <div className="setu-agents">
                          {AGENTS.map((a) => {
                            const v = verdictByAgent(a);
                            const cls =
                              !v ? "" :
                              v.errored ? " errored" :
                              v.approved ? " voted" : " rejected";
                            return (
                              <span key={a} className={"agent-chip" + cls} title={v?.persona ?? ""}>
                                <span className="dot" />
                                {a}
                                {v && <span className="score">· {v.score}</span>}
                              </span>
                            );
                          })}
                        </div>
                      } />
                  </div>

                  {verdicts && verdicts.length > 0 && (
                    <div className="verdict-list">
                      <div className="vh">Agent rationales · click to expand</div>
                      {verdicts.map((v) => (
                        <details key={v.agent} className={"vrow " + (v.errored ? "err" : v.approved ? "ok" : "no")}>
                          <summary>
                            <span className="va">{v.agent}</span>
                            <span className="vp">{v.persona}</span>
                            <span className="vs">
                              {v.errored ? "error" : v.approved ? "approve" : "reject"} · {v.score}/100
                            </span>
                          </summary>
                          <div className="vr">{v.rationale}</div>
                        </details>
                      ))}
                    </div>
                  )}

                  {setuDone && serverIntentId && !serverRejected && (
                    <div className="setu-done show">
                      <div className="seal">
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                      <div className="text">
                        <div className="a">Inscribed on Setu · <em>{ticker}</em> is live in the market.</div>
                        <div className="b">
                          {serverIntentId.slice(0, 10)}… · gatekeeper score {serverScore ?? "—"}/100 · published
                        </div>
                      </div>
                    </div>
                  )}
                  {setuDone && serverRejected && (
                    <div className="setu-done show" style={{ background: "rgba(220,38,38,0.06)", borderColor: "rgba(220,38,38,0.35)" }}>
                      <div className="seal" style={{ background: "#b91c1c" }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </div>
                      <div className="text">
                        <div className="a" style={{ color: "#7f1d1d" }}>Gatekeeper rejected · {serverScore ?? "?"}/100</div>
                        <div className="b" style={{ color: "#7f1d1d" }}>{serverRejected}</div>
                      </div>
                    </div>
                  )}
                  {serverError && (
                    <div className="setu-done show" style={{ background: "rgba(220,38,38,0.06)", borderColor: "rgba(220,38,38,0.35)" }}>
                      <div className="seal" style={{ background: "#b91c1c" }}>!</div>
                      <div className="text">
                        <div className="a" style={{ color: "#7f1d1d" }}>Publish failed</div>
                        <div className="b" style={{ color: "#7f1d1d" }}>{serverError}</div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="form-foot">
                  {setuDone || serverError ? (
                    <>
                      <button className="btn-back" onClick={() => setStep(3)}>← Back</button>
                      {serverError && !isConnected ? (
                        <button className="btn-next" onClick={openSignIn}>
                          Connect wallet & retry <span style={{ fontFamily: "JetBrains Mono, monospace" }}>↗</span>
                        </button>
                      ) : serverIntentId && !serverRejected ? (
                        <button
                          className="btn-next"
                          onClick={() => router.push(`/intent/${serverIntentId}`)}
                        >
                          Open {ticker} in market <span style={{ fontFamily: "JetBrains Mono, monospace" }}>↗</span>
                        </button>
                      ) : serverRejected ? (
                        <button
                          className="btn-next"
                          onClick={() => { setStep(1); toast.push({ text: "Edit and resubmit", tone: "ok" }); }}
                        >
                          Revise proposal <span style={{ fontFamily: "JetBrains Mono, monospace" }}>↗</span>
                        </button>
                      ) : (
                        <span style={{ color: "var(--mute)", font: "12px JetBrains Mono, monospace" }}>
                          waiting for gatekeeper…
                        </span>
                      )}
                    </>
                  ) : <span /> /* hidden until animation done */}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <PageStyles />
    </>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function Stepper({ step }: { step: Step }) {
  return (
    <div className="stepper">
      {[1, 2, 3, 4].map((n, i) => (
        <span key={n} style={{ display: "contents" }}>
          <div className={"step-num " + (n < step ? "done" : n === step ? "active" : "")}>{n}</div>
          {i < 3 && <div className={"step-line " + (n < step ? "done" : "")} />}
        </span>
      ))}
    </div>
  );
}

function MilestoneBlock({ label, ms, setMs, onRemove }: {
  label: string;
  ms: Milestone;
  setMs: (m: Milestone) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="ms-block">
      <div className="head">
        <span className="ms-num">{label}</span>
        {onRemove && (
          <button className="icon-btn" type="button" title="Remove milestone" onClick={onRemove}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        )}
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>Description</label>
        <input className="input" type="text" value={ms.desc} onChange={(e) => setMs({ ...ms, desc: e.target.value })} />
      </div>
      <div className="ms-row">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Verification criteria</label>
          <input className="input" type="text" value={ms.crit} onChange={(e) => setMs({ ...ms, crit: e.target.value })} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Release amount (USDC)</label>
          <input className="input" type="number" value={ms.amt} onChange={(e) => setMs({ ...ms, amt: Number(e.target.value) })} />
        </div>
      </div>
      <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
        <label>Target completion date <span style={{ color: "var(--mute)", fontWeight: 400 }}>(optional)</span></label>
        <input
          className="input"
          type="date"
          value={ms.due}
          onChange={(e) => setMs({ ...ms, due: e.target.value })}
          min={new Date().toISOString().slice(0, 10)}
        />
      </div>
    </div>
  );
}

function ReviewCell({ k, v, span2, mono, bold, small }: { k: string; v: string; span2?: boolean; mono?: boolean; bold?: boolean; small?: boolean }) {
  return (
    <div className="review-cell" style={span2 ? { gridColumn: "1 / -1" } : undefined}>
      <div className="k">{k}</div>
      <div className="v" style={{
        fontFamily: mono ? "JetBrains Mono, monospace" : undefined,
        fontWeight: bold ? 700 : undefined,
        fontSize: small ? 14 : undefined,
        lineHeight: small ? 1.5 : undefined,
      }}>{v}</div>
    </div>
  );
}

function ReviewRow({ l, d, a }: { l: string; d: string; a: string }) {
  return (
    <div className="review-row">
      <div className="l">{l}</div>
      <div className="d">{d}</div>
      <div className="a">{a}</div>
    </div>
  );
}

function SetuPhase({ n, title, desc, state, log, agents }: {
  n: string;
  title: string;
  desc: string;
  state: PhaseState;
  log: string[];
  agents?: React.ReactNode;
}) {
  const klass = state === "queued" ? "" : state;
  return (
    <div className={"setu-phase " + klass}>
      <div className="marker">{n}</div>
      <div className="body">
        <div className="row1">
          <div className="ttl">{title}</div>
          <div className="stat">
            <span className="blink" />
            {state === "queued" ? "queued" : state === "active" ? "in progress" : "complete"}
          </div>
        </div>
        <p className="desc">{desc}</p>
        {agents}
        <div className="log">
          {log.map((line, i) => (
            <span className="line" key={i}>
              <span className="t">▸</span>{line.replace(/^▸\s*/, "")}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function PageIcon({ kind }: { kind: "blueprint" | "milestone" | "check" | "globe" }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, style: { color: "var(--rust)" } };
  if (kind === "blueprint")
    return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>;
  if (kind === "milestone")
    return <svg {...common}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>;
  if (kind === "check")
    return <svg {...common}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" /></svg>;
}

// ─── Styles ─────────────────────────────────────────────────────────────

function PageStyles() {
  return (
    <style jsx global>{`
      .pg-head { margin-bottom: 30px; }
      .pg-head .eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--rust); letter-spacing: .18em; text-transform: uppercase; margin-bottom: 14px; display: flex; align-items: center; gap: 10px; }
      .pg-head .eyebrow::before { content: ''; width: 18px; height: 1px; background: var(--rust); }
      .pg-head h1 { font-family: 'Newsreader', serif; font-weight: 500; font-size: clamp(2rem, 3.6vw, 2.8rem); color: var(--ink); margin: 0 0 10px; letter-spacing: -0.01em; line-height: 1.05; }
      .pg-head h1 em { font-style: italic; color: var(--rust); }
      .pg-head p { font-size: 15px; color: var(--ink-3); margin: 0; max-width: 580px; line-height: 1.6; }

      .stepper { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 32px; }
      .step-num { width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 600; background: #fdfcf8; color: var(--mute); border: 1px solid var(--line); transition: all .25s; }
      .step-num.active { background: var(--rust); color: #faf3e3; border-color: var(--rust); box-shadow: 0 0 0 4px rgba(194,65,12,0.12); }
      .step-num.done { background: #65a30d; color: #faf3e3; border-color: #65a30d; }
      .step-line { width: 54px; height: 1px; background: rgba(58,36,24,0.2); transition: all .25s; }
      .step-line.done { background: #65a30d; }

      .form-card { padding: 30px; border-radius: 6px; border: 1px solid var(--line); background: #fdfcf8; position: relative; }
      .form-card::before, .form-card::after { content: ''; position: absolute; width: 16px; height: 16px; border: 1.5px solid var(--rust); opacity: .5; }
      .form-card::before { top: -1px; left: -1px; border-right: none; border-bottom: none; }
      .form-card::after { bottom: -1px; right: -1px; border-left: none; border-top: none; }
      .form-card h2 { font-family: 'Newsreader', serif; font-weight: 500; font-size: 22px; color: var(--ink); margin: 0 0 6px; display: flex; align-items: center; gap: 10px; letter-spacing: -0.01em; }
      .form-card .sub { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); margin: 0 0 24px; letter-spacing: .08em; text-transform: uppercase; }

      .pane.active { display: block; }

      .form-card label { display: block; font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 500; color: var(--mute); margin-bottom: 8px; letter-spacing: .12em; text-transform: uppercase; }
      .field { margin-bottom: 20px; }
      .input { width: 100%; padding: 13px 14px; border-radius: 6px; border: 1px solid var(--line); background: #faf3e3; font-family: 'Inter', sans-serif; font-size: 14px; color: var(--ink); transition: all .2s; box-sizing: border-box; }
      .input:focus { outline: none; border-color: var(--rust); background: #fffaee; box-shadow: 0 0 0 3px rgba(194,65,12,0.10); }
      textarea.input { resize: vertical; min-height: 120px; line-height: 1.6; font-family: inherit; }
      .req { color: var(--rust); }

      .tag-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; background: rgba(254,215,170,0.40); border: 1px solid rgba(194,65,12,0.3); color: var(--rust); font-size: 12px; font-weight: 500; font-family: 'JetBrains Mono', monospace; margin-right: 6px; margin-bottom: 6px; }
      .tag-x { background: none; border: none; color: var(--rust); cursor: pointer; opacity: .55; padding: 0; font-size: 14px; line-height: 1; transition: opacity .15s; }
      .tag-x:hover { opacity: 1; }

      .ms-block { padding: 20px; border-radius: 6px; border: 1px solid var(--line); background: #faf3e3; margin-bottom: 14px; position: relative; }
      .ms-block::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--rust); border-radius: 6px 0 0 6px; }
      .ms-block .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
      .ms-num { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600; color: var(--rust); letter-spacing: .14em; text-transform: uppercase; }
      .ms-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      @media (max-width: 600px) { .ms-row { grid-template-columns: 1fr; } }
      .icon-btn { background: none; border: none; color: var(--mute); cursor: pointer; padding: 6px; border-radius: 4px; transition: all .2s; }
      .icon-btn:hover { color: var(--rust); background: rgba(194,65,12,0.06); }
      .add-ms { width: 100%; padding: 14px; border-radius: 6px; border: 1.5px dashed rgba(194,65,12,0.5); background: rgba(254,215,170,0.18); color: var(--rust); font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 500; display: inline-flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; transition: all .2s; }
      .add-ms:hover { background: rgba(254,215,170,0.35); border-color: var(--rust); }
      .add-ms[disabled] { opacity: .5; cursor: not-allowed; }

      .res-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      @media (max-width: 600px) { .res-grid { grid-template-columns: 1fr; } }
      .res-card { padding: 16px; border-radius: 6px; border: 1px solid var(--line); background: #faf3e3; text-align: left; cursor: pointer; transition: all .2s; font-family: inherit; }
      .res-card:hover { border-color: rgba(194,65,12,0.5); }
      .res-card.selected { border-color: var(--rust); background: rgba(254,215,170,0.30); box-shadow: 0 4px 12px rgba(194,65,12,0.10); }
      .res-card .a { font-size: 14px; font-weight: 600; color: var(--ink); margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
      .res-card .b { font-size: 12px; color: var(--mute); line-height: 1.4; }

      .preview-box { margin-top: 24px; padding: 20px; border-radius: 6px; background: rgba(254,215,170,0.30); border: 1px solid rgba(194,65,12,0.35); position: relative; }
      .preview-box .l { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 500; color: var(--rust); letter-spacing: .16em; text-transform: uppercase; margin-bottom: 8px; }
      .preview-ticker { font-family: 'JetBrains Mono', monospace; font-size: 30px; font-weight: 700; color: var(--ink); letter-spacing: -0.01em; outline: none; }
      .preview-meta { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); margin-top: 6px; }

      .review-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
      @media (max-width: 600px) { .review-grid { grid-template-columns: 1fr; } }
      .review-cell { padding: 14px; border-radius: 6px; background: #faf3e3; border: 1px solid var(--line); }
      .review-cell .k { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); letter-spacing: .1em; text-transform: uppercase; margin-bottom: 6px; }
      .review-cell .v { font-family: 'Newsreader', serif; font-size: 17px; color: var(--ink); line-height: 1.4; }
      .review-list { padding: 18px; border-radius: 6px; background: #faf3e3; border: 1px solid var(--line); margin-bottom: 18px; }
      .review-list .k { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); letter-spacing: .1em; text-transform: uppercase; margin-bottom: 10px; }
      .review-row { display: flex; justify-content: space-between; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid rgba(58,36,24,0.08); font-size: 13px; color: var(--ink-2); gap: 12px; }
      .review-row:last-child { border-bottom: none; }
      .review-row .l { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--rust); letter-spacing: .1em; text-transform: uppercase; min-width: 60px; }
      .review-row .d { flex: 1; color: var(--ink); }
      .review-row .a { font-family: 'JetBrains Mono', monospace; font-weight: 600; color: var(--ink); }

      .attest { margin: 18px 0 6px; padding: 16px; border-radius: 6px; background: rgba(101,163,13,0.06); border: 1px solid rgba(101,163,13,0.30); display: flex; align-items: flex-start; gap: 12px; font-size: 13px; color: #3f5e0d; line-height: 1.6; font-family: 'Inter', sans-serif; font-weight: 400; letter-spacing: 0; text-transform: none; }
      .attest input { margin-top: 3px; accent-color: #65a30d; flex: none; }

      .form-foot { margin-top: 32px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
      .btn-back { padding: 13px 22px; border-radius: 6px; background: transparent; border: 1px solid var(--line); color: var(--ink-2); font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 500; cursor: pointer; transition: all .2s; }
      .btn-back:hover { border-color: var(--rust); color: var(--rust); }
      .btn-next { padding: 13px 26px; border-radius: 6px; background: var(--ink); border: none; color: #faf3e3; font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 500; cursor: pointer; transition: all .2s; display: inline-flex; align-items: center; gap: 10px; text-decoration: none; }
      .btn-next:hover { background: var(--rust); }
      .btn-next[disabled] { opacity: .4; cursor: not-allowed; }
      .btn-next[disabled]:hover { background: var(--ink); }

      .setu-stage { position: relative; padding: 8px 0 0; }
      .setu-intro { text-align: center; margin-bottom: 30px; }
      .setu-intro .pulse-ring { position: relative; width: 88px; height: 88px; margin: 0 auto 18px; }
      .setu-intro .pulse-ring::before, .setu-intro .pulse-ring::after { content: ''; position: absolute; inset: 0; border-radius: 50%; border: 1.5px solid var(--rust); animation: setu-pulse 2.4s cubic-bezier(.4,0,.6,1) infinite; opacity: 0; }
      .setu-intro .pulse-ring::after { animation-delay: 1.2s; }
      .setu-intro .pulse-core { position: absolute; inset: 18px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fde6c4, #c2410c 75%); box-shadow: 0 6px 20px -4px rgba(194,65,12,0.45), inset 0 0 16px rgba(255,220,180,0.5); display: flex; align-items: center; justify-content: center; color: #faf3e3; font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; }
      @keyframes setu-pulse { 0% { transform: scale(.9); opacity: .55; } 100% { transform: scale(1.7); opacity: 0; } }
      .setu-intro h3 { font-family: 'Newsreader', serif; font-style: italic; font-weight: 500; font-size: 26px; color: var(--ink); margin: 0 0 8px; letter-spacing: -0.01em; }
      .setu-intro p { font-size: 14px; color: var(--ink-3); margin: 0 auto; max-width: 480px; line-height: 1.6; }

      .setu-phases { position: relative; display: flex; flex-direction: column; gap: 0; border: 1px solid var(--line); border-radius: 8px; background: #faf3e3; overflow: hidden; }
      .setu-phases::before { content: ''; position: absolute; left: 34px; top: 60px; bottom: 60px; width: 2px; background: linear-gradient(180deg, rgba(58,36,24,0.15), rgba(58,36,24,0.05)); z-index: 0; }
      .setu-phase { position: relative; display: flex; gap: 18px; padding: 22px 22px; border-bottom: 1px solid rgba(58,36,24,0.08); transition: background .35s; }
      .setu-phase:last-child { border-bottom: none; }
      .setu-phase.active { background: rgba(254,215,170,0.30); }
      .setu-phase.done { background: rgba(101,163,13,0.05); }

      .setu-phase .marker { position: relative; z-index: 1; width: 32px; height: 32px; border-radius: 50%; border: 1.5px solid rgba(58,36,24,0.30); background: #fdfcf8; display: flex; align-items: center; justify-content: center; font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; color: var(--mute); flex-shrink: 0; transition: all .35s; }
      .setu-phase.active .marker { border-color: var(--rust); background: var(--rust); color: #faf3e3; box-shadow: 0 0 0 5px rgba(194,65,12,0.18); }
      .setu-phase.done .marker { border-color: #65a30d; background: #65a30d; color: #faf3e3; }

      .setu-phase .body { flex: 1; min-width: 0; }
      .setu-phase .row1 { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; margin-bottom: 6px; }
      .setu-phase .ttl { font-family: 'Newsreader', serif; font-size: 18px; font-weight: 500; color: var(--ink); letter-spacing: -0.005em; }
      .setu-phase .stat { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); letter-spacing: .1em; text-transform: uppercase; display: flex; align-items: center; gap: 6px; }
      .setu-phase.active .stat { color: var(--rust); }
      .setu-phase.done .stat { color: #4d7c0f; }
      .setu-phase .stat .blink { width: 6px; height: 6px; border-radius: 50%; background: currentColor; display: inline-block; animation: blink 1s ease-in-out infinite; }
      @keyframes blink { 50% { opacity: .3; } }
      .setu-phase .desc { font-size: 13px; color: var(--ink-3); line-height: 1.55; margin: 0 0 10px; }

      .setu-phase .log { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); letter-spacing: 0; text-transform: none; background: rgba(58,36,24,0.04); border: 1px solid rgba(58,36,24,0.10); border-radius: 4px; padding: 0 10px; max-height: 0; overflow: hidden; transition: max-height .4s ease, padding .4s ease, opacity .25s; opacity: 0; }
      .setu-phase.active .log, .setu-phase.done .log { max-height: 120px; padding: 10px; opacity: 1; }
      .setu-phase .log .line { display: block; line-height: 1.55; color: var(--ink-2); }
      .setu-phase .log .line .t { color: var(--rust); margin-right: 8px; }
      .setu-phase.done .log .line .t { color: #4d7c0f; }

      .setu-agents { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
      .agent-chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 999px; background: #fdfcf8; border: 1px solid rgba(58,36,24,0.18); font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--mute); letter-spacing: .06em; transition: all .3s; }
      .agent-chip .dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(58,36,24,0.25); transition: background .3s, box-shadow .3s; }
      .agent-chip.voted { border-color: rgba(101,163,13,0.45); background: rgba(101,163,13,0.08); color: #4d7c0f; }
      .agent-chip.voted .dot { background: #65a30d; box-shadow: 0 0 0 3px rgba(101,163,13,0.18); }
      .agent-chip.rejected { border-color: rgba(220,38,38,0.45); background: rgba(220,38,38,0.06); color: #b91c1c; }
      .agent-chip.rejected .dot { background: #dc2626; box-shadow: 0 0 0 3px rgba(220,38,38,0.18); }
      .agent-chip.errored { border-color: rgba(154,52,18,0.45); background: rgba(154,52,18,0.06); color: #9a3412; }
      .agent-chip.errored .dot { background: #9a3412; }
      .agent-chip .score { font-weight: 600; opacity: .85; margin-left: 2px; }

      .setu-done { margin-top: 22px; padding: 22px 24px; border-radius: 8px; background: linear-gradient(135deg, rgba(101,163,13,0.10), rgba(101,163,13,0.04)); border: 1px solid rgba(101,163,13,0.40); align-items: center; gap: 18px; display: none; }
      .setu-done.show { display: flex; animation: done-in .5s ease both; }
      @keyframes done-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      .setu-done .seal { width: 54px; height: 54px; border-radius: 50%; background: #65a30d; color: #faf3e3; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 8px 22px -6px rgba(101,163,13,0.45); }
      .setu-done .text { flex: 1; }
      .setu-done .text .a { font-family: 'Newsreader', serif; font-size: 20px; color: var(--ink); font-weight: 500; letter-spacing: -0.01em; margin-bottom: 4px; }
      .setu-done .text .a em { font-style: italic; color: #4d7c0f; }
      .setu-done .text .b { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); letter-spacing: .06em; }

      .verdict-list { margin-top: 18px; border: 1px solid var(--line); border-radius: 6px; background: #faf3e3; overflow: hidden; }
      .verdict-list .vh { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); letter-spacing: .1em; text-transform: uppercase; padding: 12px 14px; border-bottom: 1px solid var(--line-soft); }
      .vrow { border-bottom: 1px solid var(--line-soft); }
      .vrow:last-child { border-bottom: none; }
      .vrow summary { padding: 12px 14px; display: grid; grid-template-columns: 80px 1fr auto; gap: 12px; align-items: baseline; cursor: pointer; list-style: none; font-size: 13px; }
      .vrow summary::-webkit-details-marker { display: none; }
      .vrow .va { font-family: 'JetBrains Mono', monospace; font-weight: 600; color: var(--rust); letter-spacing: .04em; }
      .vrow .vp { color: var(--ink-3); font-size: 12px; }
      .vrow .vs { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--mute); letter-spacing: .04em; }
      .vrow.ok .vs { color: #4d7c0f; }
      .vrow.no .vs { color: #b91c1c; }
      .vrow.err .vs { color: #9a3412; }
      .vrow .vr { padding: 0 14px 14px; font-size: 13px; color: var(--ink-2); line-height: 1.55; }
    `}</style>
  );
}
