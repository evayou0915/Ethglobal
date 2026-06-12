/* eslint-disable no-console */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Convert a USDC value (whole dollars) into 6-decimal BigInt. */
const usdc = (whole: number) => BigInt(whole) * 1_000_000n;

/** Pretend on-chain intentId. In production this would be derived
 *  (e.g. keccak256(scientistWallet + nonce)) and emitted in the publish
 *  event. For seed data we just hand-pick stable bytes32 strings. */
const intentIdOf = (s: string) =>
  "0x" + s.padEnd(64, "0");

async function main() {
  const scientistWallet = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

  await prisma.user.upsert({
    where: { wallet: scientistWallet },
    update: {},
    create: {
      wallet: scientistWallet,
      role: "scientist",
    },
  });

  await prisma.scientist.upsert({
    where: { wallet: scientistWallet },
    update: {},
    create: {
      wallet: scientistWallet,
      displayName: "Dr. Demo Scientist",
      bio: "Seed account used for the AuraSci hackathon demo. Replace with real ORCID-verified researcher in production.",
      affiliation: "Stanford University",
      orcid: "0000-0000-0000-0000",
      orcidVerified: false,
    },
  });

  const intents = [
    {
      intentId: intentIdOf("cell01"),
      ticker: "$CELL-01",
      title: "Lab-grown skeletal muscle for ALS therapy",
      descriptionMd:
        "Pilot study to validate myocyte differentiation protocol on patient-derived iPSCs. Phase 1 of a 3-phase translational program.",
      category: "Bio",
      tags: ["ALS", "stem cells", "muscle regeneration"],
      fundingGoalUsdc: usdc(150_000),
      milestones: [
        { title: "Cell culture protocol validated",      amount: usdc(40_000) },
        { title: "Patient-derived iPSC differentiation", amount: usdc(60_000) },
        { title: "In-vitro contraction assay",           amount: usdc(50_000) },
      ],
    },
    {
      intentId: intentIdOf("neur01"),
      ticker: "$NEUR-01",
      title: "Closed-loop neural decoder for assistive prosthetics",
      descriptionMd:
        "Open-source EEG-driven motor intent decoder, targeting <80 ms latency. Reproducible on consumer-grade hardware.",
      category: "Neuro",
      tags: ["BCI", "EEG", "open-source hardware"],
      fundingGoalUsdc: usdc(80_000),
      milestones: [
        { title: "Dataset collection (n=20 subjects)",      amount: usdc(25_000) },
        { title: "Decoder model + reproducibility package", amount: usdc(30_000) },
        { title: "Cross-subject validation report",         amount: usdc(25_000) },
      ],
    },
    {
      intentId: intentIdOf("gene01"),
      ticker: "$GENE-01",
      title: "CRISPR base-editor screen for rare metabolic disorders",
      descriptionMd:
        "Pooled base-editing CRISPR screen across 12 monogenic metabolic loci. Targets will be released as open MTAs.",
      category: "Genetics",
      tags: ["CRISPR", "base editing", "metabolic"],
      fundingGoalUsdc: usdc(200_000),
      milestones: [
        { title: "Guide library design + validation", amount: usdc(60_000) },
        { title: "Pooled screen execution",           amount: usdc(90_000) },
        { title: "Hit characterization + dataset release", amount: usdc(50_000) },
      ],
    },
  ];

  for (const i of intents) {
    await prisma.intent.upsert({
      where: { intentId: i.intentId },
      update: {},
      create: {
        intentId: i.intentId,
        scientistWallet,
        ticker: i.ticker,
        title: i.title,
        descriptionMd: i.descriptionMd,
        category: i.category,
        tags: i.tags,
        fundingGoalUsdc: i.fundingGoalUsdc,
        status: "published",
        aiGatekeeperScore: 82,
        aiGatekeeperRationale:
          "Demo gatekeeper score. Real scoring lives in /api/ai/gatekeeper.",
        publishedAt: new Date(),
        milestones: {
          create: i.milestones.map((m, idx) => ({
            idx,
            title: m.title,
            descriptionMd: "Seed milestone description.",
            releaseAmountUsdc: m.amount,
            status: idx === 0 ? "in_progress" : "locked",
          })),
        },
      },
    });
    console.log(`✓ seeded ${i.ticker} (${i.intentId})`);
  }

  // NOTE: we intentionally don't pre-create the IndexerCheckpoint here.
  // The indexer self-initializes to `currentTipBlock - 10` on first run if
  // no row exists, which is correct for any chain. If you seed before
  // contract deployment, leaving this absent avoids the "30M block lag"
  // bug where the indexer would try to back-fill from genesis.
  // To force a reset after redeploying the contract, run:
  //   npx tsx scripts/reset-checkpoint.mts

  // Bootstrap the first Aura season — 14-day window, 100 budget, 20 yield/release.
  const now = new Date();
  const endsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  await prisma.auraSeason.upsert({
    where: { name: "season-001" },
    update: { active: true },
    create: {
      name: "season-001",
      startsAt: now,
      endsAt,
      budgetPerPatron: 100,
      yieldPerMilestone: 20,
      active: true,
    },
  });
  console.log("✓ seeded Aura season-001 (active)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
