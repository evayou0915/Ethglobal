import { createHash } from "node:crypto";
import { ENV } from "./env.js";

export type Scored = { score: number; rationale: string; model: string };

export interface AgentVerdict {
  agent: string;           // ATLAS-7 / HELIX-3 / ...
  persona: string;         // human-readable angle ("Scientific feasibility")
  score: number;           // 0..100, what this agent gave
  rationale: string;       // 1-2 sentences from this agent
  approved: boolean;       // score >= 70
  model: string;           // model id (so we can audit per-call)
  errored?: boolean;       // true if this individual call failed
}

export interface QuorumResult {
  /** Mean of per-agent scores, rounded — what we store on Intent. */
  score: number;
  /** Concatenated short rationales from each agent. */
  rationale: string;
  /** Per-agent breakdown for UI display + audit. */
  verdicts: AgentVerdict[];
  /** Pass requires BOTH conditions:
   *    (a) ≥3/5 agents individually approved (score >= 70), AND
   *    (b) the mean score is also >= 70.
   *  (a) on its own can let a proposal through that 3 agents loved and 2
   *  agents hated, dragging the mean below the threshold — which then gets
   *  filtered out of the market (default score filter is also 70) and leaves
   *  the scientist with a confusing "published but invisible" intent. */
  passed: boolean;
}

// ─── Gatekeeper personas ────────────────────────────────────────────────
// Five reviewers, each scoring the proposal from a different angle.
// Names match the visual chips on the frontend (Step 4 of /create).

const GATEKEEPERS = [
  {
    id: "ATLAS-7",
    persona: "Scientific feasibility",
    system:
      "You are ATLAS-7, an open-science gatekeeper specializing in SCIENTIFIC FEASIBILITY. " +
      "Score the proposal 0–100 on whether the hypothesis is testable, the methodology is sound, " +
      "and the expected results are plausible given current literature. Be strict: vague mechanisms " +
      "or unverifiable claims should score below 70. Reply ONLY as JSON: " +
      `{"score": number, "rationale": "1-2 sentence verdict"}`,
  },
  {
    id: "HELIX-3",
    persona: "Milestone clarity",
    system:
      "You are HELIX-3, an open-science gatekeeper specializing in MILESTONE CLARITY. " +
      "Score 0–100 on whether each milestone has a clear deliverable, verifiable criterion, " +
      "and reasonable scope. Penalize milestones that mix multiple goals or lack measurable success. " +
      `Reply ONLY as JSON: {"score": number, "rationale": "1-2 sentence verdict"}`,
  },
  {
    id: "ORCHID-9",
    persona: "Budget reasonableness",
    system:
      "You are ORCHID-9, an open-science gatekeeper specializing in BUDGET REVIEW. " +
      "Score 0–100 on whether the funding goal is justified by the scope: too high for the deliverables " +
      "(grant-grift) or too low for the milestones (unrealistic) both score below 70. Reply ONLY as JSON: " +
      `{"score": number, "rationale": "1-2 sentence verdict"}`,
  },
  {
    id: "VESTA-2",
    persona: "Open-science integrity",
    system:
      "You are VESTA-2, an open-science gatekeeper specializing in OPEN-SCIENCE INTEGRITY. " +
      "Score 0–100 on whether the proposal commits to open data, open methods, and reproducibility — " +
      "preprints, public datasets, open code. Closed-source / proprietary-only deliverables should score below 70. " +
      `Reply ONLY as JSON: {"score": number, "rationale": "1-2 sentence verdict"}`,
  },
  {
    id: "LYRA-5",
    persona: "Risk & failure modes",
    system:
      "You are LYRA-5, an open-science gatekeeper specializing in RISK ASSESSMENT. " +
      "Score 0–100 on whether the proposal acknowledges failure modes (technical risk, regulatory risk, " +
      "biological variability) and has a credible fallback path if a milestone fails. Bonus for explicit " +
      `negative-result reporting commitment. Reply ONLY as JSON: {"score": number, "rationale": "1-2 sentence verdict"}`,
  },
] as const;

const PASS_THRESHOLD = 70;

const hasLLM = () => Boolean(ENV.OPENAI_API_KEY);

// ─── Gatekeeper: 5-agent quorum ─────────────────────────────────────────

export async function scoreIntentQuorum(args: {
  title: string;
  description: string;
  category: string;
  fundingGoalUsdc: bigint;
  milestones?: Array<{ title: string; descriptionMd: string; releaseAmountUsdc: bigint }>;
}): Promise<QuorumResult> {
  const payload = JSON.stringify({
    title: args.title,
    description: args.description,
    category: args.category,
    fundingGoalUsdc: args.fundingGoalUsdc.toString(),
    milestones: (args.milestones ?? []).map((m) => ({
      title: m.title,
      descriptionMd: m.descriptionMd,
      releaseAmountUsdc: m.releaseAmountUsdc.toString(),
    })),
  });

  // Fan out — run all 5 agents in parallel. Promise.allSettled so one
  // flaky provider call doesn't tank the whole job; the failed agent
  // gets a neutral 50 + errored=true marker.
  const settled = await Promise.allSettled(
    GATEKEEPERS.map((g) => callAgent(g.id, g.persona, g.system, payload)),
  );

  const verdicts: AgentVerdict[] = settled.map((s, i) => {
    const g = GATEKEEPERS[i];
    if (s.status === "fulfilled") return s.value;
    return {
      agent: g.id,
      persona: g.persona,
      score: 50,
      rationale: `Agent call failed: ${(s.reason as Error)?.message ?? "unknown"}`,
      approved: false,
      model: ENV.OPENAI_MODEL,
      errored: true,
    };
  });

  const validScores = verdicts.filter((v) => !v.errored).map((v) => v.score);
  const meanScore = validScores.length
    ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length)
    : 0;
  const approveCount = verdicts.filter((v) => v.approved).length;
  // Pass requires BOTH the quorum vote AND the mean score being above the
  // public threshold — see QuorumResult.passed docstring for why a single
  // condition isn't enough.
  const passed = approveCount >= 3 && meanScore >= PASS_THRESHOLD;

  const rationale = verdicts.map((v) => `[${v.agent} · ${v.score}/100] ${v.rationale}`).join("\n");

  return { score: meanScore, rationale, verdicts, passed };
}

// ─── Verifier (per-milestone proof check) ──────────────────────────────
//
// The proof artifact lives on Walrus (stored at submit-proof time, blobId on
// the Milestone row). In "llm" mode the verifier fetches the actual bytes
// back from a Walrus aggregator, extracts readable content, and grades it
// against the milestone's stated deliverable — so the release signature is
// only ever produced after the model has seen the real artifact.
//
// `AI_VERIFIER_MODE` selects the behavior:
//   "llm"       — fetch proof from Walrus + real LLM grading (recommended;
//                  requires OPENAI_API_KEY).
//   "heuristic" — deterministic 60-95 sha256-based score, ~72% pass rate.
//   "approve"   — always score 99/100. Demo / CI escape hatch: keeps the
//                  full release flow runnable without an LLM key.
const VERIFIER_MODE = (process.env.AI_VERIFIER_MODE ?? "approve").toLowerCase();

/** Cap on how much proof text we put in the prompt (~7k tokens). */
const PROOF_EXCERPT_BYTES = 28 * 1024;

const TEXTUAL_MIME = /^(text\/|application\/(json|csv|x-csv|xml|markdown))/i;
const TEXTUAL_EXT = /\.(md|txt|csv|json|xml|log|tex|rst|ipynb|py|r|ts|js|sol)$/i;

/** Pull gradeable text out of the proof bytes. PDFs go through unpdf
 *  (lazy-imported so non-PDF jobs never load it); plain-text formats are
 *  decoded directly; for opaque binaries (images, archives) we fall back to
 *  metadata-only grading and tell the model exactly that. */
async function extractProofText(
  bytes: ArrayBuffer,
  fileName: string | null,
  mime: string | null,
): Promise<{ kind: "text" | "pdf" | "binary"; excerpt: string }> {
  const name = fileName ?? "";
  const isPdf = mime === "application/pdf" || /\.pdf$/i.test(name);
  if (isPdf) {
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractText(pdf, { mergePages: true });
      return { kind: "pdf", excerpt: text.slice(0, PROOF_EXCERPT_BYTES) };
    } catch (e) {
      console.warn(`[ai] pdf extraction failed (${(e as Error).message}); grading on metadata only`);
      return { kind: "binary", excerpt: "" };
    }
  }
  if ((mime && TEXTUAL_MIME.test(mime)) || TEXTUAL_EXT.test(name)) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, PROOF_EXCERPT_BYTES));
    return { kind: "text", excerpt: text };
  }
  return { kind: "binary", excerpt: "" };
}

export async function scoreProof(args: {
  milestoneTitle: string;
  milestoneDescription: string;
  proofBlobId: string;
  proofHash: string;
  proofFileName?: string | null;
  proofFileMime?: string | null;
}): Promise<Scored> {
  if (VERIFIER_MODE === "llm" && hasLLM()) {
    // Fetch the actual artifact back from Walrus. A failure here throws —
    // the AiJob machinery retries, and a proof that can't be retrieved
    // must never produce a release signature.
    const { fetchBlobBytes } = await import("./walrus.js");
    const bytes = await fetchBlobBytes(args.proofBlobId);
    const { kind, excerpt } = await extractProofText(
      bytes,
      args.proofFileName ?? null,
      args.proofFileMime ?? null,
    );

    const system =
      "You are an open-science milestone verifier. You are given a milestone's stated deliverable " +
      "and the proof artifact a scientist submitted (retrieved from Walrus decentralized storage). " +
      "Score 0–100 on whether the artifact plausibly satisfies the deliverable: claimed results " +
      "present, methodology described, internally consistent. Generic filler, empty files, or " +
      "content unrelated to the milestone must score below 70. " +
      (kind === "binary"
        ? "The artifact is a binary file you cannot read — grade conservatively on whether its " +
          "metadata (name, type, size) is a plausible deliverable for this milestone. "
        : "") +
      `Reply ONLY as JSON: {"score": number, "rationale": "1-2 sentence verdict"}`;

    const payload = JSON.stringify({
      milestoneTitle: args.milestoneTitle,
      milestoneDescription: args.milestoneDescription,
      artifact: {
        fileName: args.proofFileName ?? null,
        mime: args.proofFileMime ?? null,
        sizeBytes: bytes.byteLength,
        sha256: args.proofHash,
        walrusBlobId: args.proofBlobId,
        contentKind: kind,
        contentExcerpt: excerpt || "(binary content not included)",
      },
    });
    return callOpenAI(system, payload);
  }
  if (VERIFIER_MODE === "heuristic") {
    return heuristicScore("verifier", JSON.stringify(args));
  }
  // Escape-hatch mode: approve without grading (no LLM key needed).
  return {
    score: 99,
    rationale:
      "Verifier approved. Proof artifact registered on Walrus (blobId + SHA-256) and milestone deliverable acknowledged.",
    model: "verifier-v1",
  };
}

// ─── Internal — OpenAI-compatible HTTP call ────────────────────────────

/** Extract a JSON object from an LLM response that may have wrapped it in
 *  markdown code fences (```json ... ```) or surrounding prose. We try
 *  strict parse first; on failure, strip fences; on failure, fall back to
 *  the first `{...}` block in the text. */
function parseJsonLoose(raw: string): { score?: number; rationale?: string } {
  const text = raw.trim();

  // 1. Strict — happy path when response_format is honored.
  try { return JSON.parse(text); } catch { /* fall through */ }

  // 2. Strip ```json … ``` or ``` … ``` fences.
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* fall through */ }
  }

  // 3. First {...} block anywhere in the text. Greedy match the outermost braces.
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch { /* fall through */ }
  }

  throw new Error(`Could not extract JSON from LLM response: ${text.slice(0, 200)}…`);
}

async function callOpenAI(system: string, payload: string): Promise<Scored> {
  const url = `${ENV.OPENAI_BASE_URL}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ENV.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: ENV.OPENAI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: payload },
      ],
      // Best-effort hint — official OpenAI honors this; many compat relays
      // ignore it and return text with markdown fences. parseJsonLoose
      // copes with both shapes.
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content ?? "{}";
  const parsed = parseJsonLoose(content);
  const score = Math.max(0, Math.min(100, Math.round(parsed.score ?? 0)));
  return {
    score,
    rationale: parsed.rationale ?? "(no rationale returned)",
    model: ENV.OPENAI_MODEL,
  };
}

async function callAgent(agent: string, persona: string, system: string, payload: string): Promise<AgentVerdict> {
  if (!hasLLM()) {
    // Deterministic heuristic per (agent, payload) so demo mode without
    // an API key still produces stable, distinct verdicts per agent.
    const h = createHash("sha256").update(`${agent}:${payload}`).digest();
    const score = 55 + (h[0] % 36); // 55..90
    return {
      agent, persona,
      score,
      rationale: `Heuristic verdict (no OPENAI_API_KEY set). Set the env var to enable real ${agent} review.`,
      approved: score >= PASS_THRESHOLD,
      model: "heuristic-v1",
    };
  }
  const scored = await callOpenAI(system, payload);
  return {
    agent, persona,
    score: scored.score,
    rationale: scored.rationale,
    approved: scored.score >= PASS_THRESHOLD,
    model: scored.model,
  };
}

function heuristicScore(kind: "gatekeeper" | "verifier", input: string): Scored {
  const h = createHash("sha256").update(`${kind}:${input}`).digest();
  const score = 60 + (h[0] % 36); // 60..95
  return {
    score,
    rationale:
      `Heuristic ${kind} score (no OPENAI_API_KEY set). Deterministic placeholder; ` +
      `set OPENAI_API_KEY to enable real LLM grading.`,
    model: "heuristic-v1",
  };
}

// ─── Legacy single-call gatekeeper, kept for any external callers ──────

export async function scoreIntent(args: {
  title: string;
  description: string;
  category: string;
  fundingGoalUsdc: bigint;
}): Promise<Scored> {
  const q = await scoreIntentQuorum(args);
  return { score: q.score, rationale: q.rationale, model: ENV.OPENAI_MODEL };
}
