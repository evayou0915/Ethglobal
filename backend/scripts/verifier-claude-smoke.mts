// Proves the Claude-backed verifier scores a real proof high and garbage low,
// through the FULL real pipeline: publish each proof to Walrus, then grade
// via scoreProof() (which fetches the bytes back + calls Claude).
// Requires ANTHROPIC_API_KEY + AI_VERIFIER_MODE=llm.
import { scoreProof } from "../src/lib/ai.js";
import { storeBlob } from "../src/lib/walrus.js";

const GOOD =
  "Milestone 0 — Cell culture protocol validated.\n\n" +
  "Methods: iPSC-derived cardiomyocytes cultured across 3 passages (P4–P6) on " +
  "Matrigel-coated plates in RPMI/B27. Viability assessed by trypan blue + flow " +
  "cytometry (live/dead). Results: mean viability 94.2% (SD 1.8, n=9 wells across " +
  "3 biological replicates); beating monolayers observed by day 12 in 8/9 wells. " +
  "Raw flow data + plate maps attached as CSV. Protocol deposited to protocols.io. " +
  "Negative control (no B27) showed 41% viability as expected.\n";
const BAD = "asdf asdf todo write this later lorem ipsum\n\n\n placeholder\n";

const common = {
  milestoneTitle: "Cell culture protocol validated",
  milestoneDescription:
    "Demonstrate a reproducible iPSC-cardiomyocyte culture protocol with >90% viability across ≥3 passages, with raw data attached.",
  proofFileName: "proof.txt",
  proofFileMime: "text/plain",
};

async function grade(label: string, text: string) {
  const stored = await storeBlob(new File([text], "proof.txt", { type: "text/plain" }));
  const r = await scoreProof({ ...common, proofBlobId: stored.blobId, proofHash: stored.proofHash });
  console.log(`${label} → score ${r.score}/100  (${r.model})`);
  console.log(`   rationale: ${r.rationale}\n`);
  return r.score;
}

console.log("Grading via the real Walrus→Claude pipeline with", process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5", "…\n");
const goodScore = await grade("✓ real proof   ", GOOD);
const badScore  = await grade("✓ garbage proof", BAD);
const pass = goodScore >= 70 && badScore < 70;
console.log(pass
  ? "★ Claude verifier works: real proof passes (≥70), garbage rejected (<70)"
  : `✗ Unexpected: good=${goodScore}, bad=${badScore} (wanted good≥70, bad<70)`);
process.exit(pass ? 0 : 1);
