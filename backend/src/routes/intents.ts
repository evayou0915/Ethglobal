import { Hono } from "hono";
import { z } from "zod";
import { keccak256, toBytes } from "viem";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../lib/db.js";
import { ok, parseJson } from "../lib/http.js";
import { optionalAuth, requireAuth, walletFrom } from "../lib/auth.js";

export const intentsRouter = new Hono();

// GET /api/intents — list (filterable, paginated)
intentsRouter.get("/", optionalAuth, async (c) => {
  const q = c.req.query();
  const status   = q.status;
  const category = q.category;
  const scientist = q.scientist ? q.scientist.toLowerCase() : undefined;
  const take = Math.min(Number(q.limit ?? 50), 100);
  const cursor = q.cursor;

  const items = await prisma.intent.findMany({
    where: {
      ...(status ? { status: status as any } : {}),
      ...(category ? { category } : {}),
      ...(scientist ? { scientistWallet: scientist } : {}),
    },
    include: {
      milestones: { orderBy: { idx: "asc" } },
      scientist: { select: { displayName: true, affiliation: true, avatarUrl: true } },
      _count: { select: { patronages: true } },
    },
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(cursor ? { cursor: { intentId: cursor }, skip: 1 } : {}),
  });

  const hasMore = items.length > take;
  const page = hasMore ? items.slice(0, take) : items;
  return ok(c, {
    items: page,
    nextCursor: hasMore ? page[page.length - 1].intentId : null,
  });
});

// GET /api/intents/:id
intentsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const intent = await prisma.intent.findUnique({
    where: { intentId: id },
    include: {
      milestones: { orderBy: { idx: "asc" } },
      scientist: {
        select: {
          wallet: true, displayName: true, affiliation: true, bio: true,
          avatarUrl: true, orcid: true, orcidVerified: true, githubHandle: true,
          reputation: true,
        },
      },
      patronages: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { patronWallet: true, amountUsdc: true, txHash: true, createdAt: true },
      },
    },
  });
  if (!intent) throw new HTTPException(404, { message: "intent not found" });
  return ok(c, intent);
});

const CreateIntentSchema = z.object({
  ticker: z.string().min(2).max(16),
  title: z.string().min(8).max(200),
  descriptionMd: z.string().min(20).max(20_000),
  category: z.string().min(2).max(50),
  tags: z.array(z.string().max(40)).max(12).default([]),
  coverImageUrl: z.string().url().max(500).optional(),
  fundingGoalUsdc: z.string().regex(/^\d+$/),
  milestones: z.array(z.object({
    title: z.string().min(4).max(200),
    descriptionMd: z.string().min(10).max(10_000),
    releaseAmountUsdc: z.string().regex(/^\d+$/),
    dueDate: z.string().datetime().optional(),
  })).length(3),
});

// POST /api/intents
intentsRouter.post("/", requireAuth, async (c) => {
  const wallet = walletFrom(c);
  const body = await parseJson(c, CreateIntentSchema);

  const sum = body.milestones.reduce((acc, m) => acc + BigInt(m.releaseAmountUsdc), 0n);
  const goal = BigInt(body.fundingGoalUsdc);
  if (sum !== goal) throw new HTTPException(400, { message: "milestone amounts must sum to fundingGoalUsdc" });

  const intentId = keccak256(toBytes(`${wallet}:${body.ticker}:${Date.now()}`));

  // Intent enters `ai_screening` state immediately. The ai-worker drains a
  // gatekeeper AiJob and promotes to `published` or `rejected` asynchronously.
  // Frontend should poll the returned job.id (or refetch the intent).
  const { intent, job } = await prisma.$transaction(async (tx) => {
    const intent = await tx.intent.create({
      data: {
        intentId,
        scientistWallet: wallet,
        ticker: body.ticker,
        title: body.title,
        descriptionMd: body.descriptionMd,
        category: body.category,
        tags: body.tags,
        coverImageUrl: body.coverImageUrl,
        fundingGoalUsdc: goal,
        status: "ai_screening",
        milestones: {
          create: body.milestones.map((m, idx) => ({
            idx,
            title: m.title,
            descriptionMd: m.descriptionMd,
            releaseAmountUsdc: BigInt(m.releaseAmountUsdc),
            dueDate: m.dueDate ? new Date(m.dueDate) : null,
            status: "locked",
          })),
        },
      },
      include: { milestones: { orderBy: { idx: "asc" } } },
    });
    const job = await tx.aiJob.create({
      data: { type: "gatekeeper", status: "queued", intentId },
    });
    return { intent, job };
  });

  return ok(c, { intent, job }, 202);
});
