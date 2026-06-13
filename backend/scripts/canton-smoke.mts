// End-to-end smoke test of the Canton bridge (lib/canton.ts) against a
// LIVE sandbox started with `cd canton && daml start`. No Postgres needed.
//
//   CANTON_JSON_API_URL=http://localhost:7575 \
//   DATABASE_URL=postgresql://smoke JWT_SECRET=smoke \
//   npx tsx scripts/canton-smoke.mts
import * as canton from "../src/lib/canton.js";

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("✗ FAIL:", msg); process.exit(1); }
  console.log("✓", msg);
};

// Unique per run so re-running against a live sandbox never double-counts.
const intentId = "0x" + Date.now().toString(16).padStart(16, "0").repeat(4);
const SCIENTIST = "0x" + "11".repeat(20);
const PHARMA_A  = "0x" + "22".repeat(20);
const PHARMA_B  = "0x" + "33".repeat(20);

// 1. Parties resolve (Operator/Verifier pre-allocated by init-script).
const op = await canton.partyFor("Operator");
const vf = await canton.partyFor("Verifier");
assert(op.includes("Operator"), `Operator party resolved: ${op.slice(0, 30)}…`);
assert(vf.includes("Verifier"), `Verifier party resolved: ${vf.slice(0, 30)}…`);

// 2. Mirror an intent onto the ledger.
const intent = await canton.ensureIntent({
  intentId,
  title: "Senolytic clearance in aged murine cardiac tissue",
  fundingGoalUsdc: "50000000000",                       // $50k in 6-dec units
  scientistWallet: SCIENTIST,
  milestones: [
    { idx: 0, title: "Protocol registration", releaseAmountUsdc: "10000000000", status: "in_progress" },
    { idx: 1, title: "Histology submitted",   releaseAmountUsdc: "25000000000", status: "locked" },
  ],
});
assert(Boolean(intent.contractId), `intent mirrored on-ledger: ${intent.contractId.slice(0, 24)}…`);
const again = await canton.ensureIntent({ intentId, title: "x", fundingGoalUsdc: "0", scientistWallet: SCIENTIST, milestones: [] });
assert(again.contractId === intent.contractId, "ensureIntent is idempotent");

// 3. Two competing patrons fund privately.
const cidA = await canton.fund(intent.contractId, PHARMA_A, 30000);
const cidB = await canton.fund(intent.contractId, PHARMA_B, 12000);
assert(Boolean(cidA) && Boolean(cidB) && cidA !== cidB, "two private patronages created");

// 4. Aggregates + per-caller privacy filter.
const sumA = await canton.intentSummary(intentId, PHARMA_A);
assert(sumA.totalUsd === 42000, `aggregate total = $42k (got $${sumA.totalUsd})`);
assert(sumA.patronCount === 2, "patron count = 2");
assert(sumA.mine.length === 1 && sumA.mine[0].amount === 30000, "caller A sees exactly their own $30k");
const sumB = await canton.intentSummary(intentId, PHARMA_B);
assert(sumB.mine.length === 1 && sumB.mine[0].amount === 12000, "caller B sees exactly their own $12k");

// 5. Dual-controlled release (operator + verifier), then double-release must fail.
await canton.releaseMilestone(intent.contractId, 0, 88);
console.log("✓ milestone 0 released with AI score 88");
// The JSON API's query store syncs from the ledger asynchronously — poll
// briefly for the recreated contract (read-after-write lag, not a bug).
let after = null;
for (let i = 0; i < 20; i++) {
  after = await canton.findIntent(intentId);
  if (after && after.contractId !== intent.contractId) break;
  await new Promise((r) => setTimeout(r, 500));
}
assert(after !== null && after!.payload.milestones.find((m) => Number(m.idx) === 0)?.released === true,
  "milestone 0 marked released on recreated contract");
let doubleReleaseFailed = false;
try { await canton.releaseMilestone(after!.contractId, 0, 99); }
catch { doubleReleaseFailed = true; }
assert(doubleReleaseFailed, "double-release rejected by ledger");

console.log("\n★ Canton bridge smoke test: ALL GREEN");
process.exit(0);
