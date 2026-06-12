/**
 * GET /api/leaderboard — patrons ranked by net committed USDC.
 *
 * "Net committed" = sum of Patronage.amountUsdc minus sum of refundedAmount.
 * "Projects" = distinct intentId count per patron.
 *
 * Backend has no notion of "individual vs organisation" or display names for
 * arbitrary wallets — the frontend renders sensible defaults (short address as
 * handle, type=ind unless a Scientist profile exists). If a patron has also
 * registered as a Scientist, we surface their display name.
 */
import { Hono } from "hono";
import { prisma } from "../lib/db.js";
import { ok } from "../lib/http.js";

export const leaderboardRouter = new Hono();

leaderboardRouter.get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

  // Two groupBys: one for sums (collapses to one row per wallet), one for
  // distinct (wallet, intentId) pairs so we can count projects without raw SQL.
  const [sums, walletIntentPairs] = await Promise.all([
    prisma.patronage.groupBy({
      by: ["patronWallet"],
      _sum: { amountUsdc: true, refundedAmount: true },
    }),
    prisma.patronage.groupBy({
      by: ["patronWallet", "intentId"],
    }),
  ]);

  const projectsByWallet = new Map<string, number>();
  for (const r of walletIntentPairs) {
    projectsByWallet.set(r.patronWallet, (projectsByWallet.get(r.patronWallet) ?? 0) + 1);
  }

  const enriched = sums
    .map((r) => {
      const total = r._sum.amountUsdc ?? 0n;
      const refunded = r._sum.refundedAmount ?? 0n;
      const net = total - refunded;
      return {
        wallet: r.patronWallet,
        totalCommittedUsdc: total,
        totalRefundedUsdc: refunded,
        netCommittedUsdc: net,
        projects: projectsByWallet.get(r.patronWallet) ?? 0,
      };
    })
    .filter((r) => r.netCommittedUsdc > 0n)
    .sort((a, b) => (a.netCommittedUsdc < b.netCommittedUsdc ? 1 : -1));

  // Pull display names for any patron who also has a Scientist profile.
  const wallets = enriched.slice(0, limit).map((r) => r.wallet);
  const scientists = wallets.length
    ? await prisma.scientist.findMany({
        where: { wallet: { in: wallets } },
        select: { wallet: true, displayName: true, avatarUrl: true },
      })
    : [];
  const profileByWallet = new Map(scientists.map((s) => [s.wallet, s]));

  const items = enriched.slice(0, limit).map((r, i) => {
    const profile = profileByWallet.get(r.wallet);
    return {
      rank: i + 1,
      wallet: r.wallet,
      displayName: profile?.displayName ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
      totalCommittedUsdc: r.totalCommittedUsdc,
      totalRefundedUsdc: r.totalRefundedUsdc,
      netCommittedUsdc: r.netCommittedUsdc,
      projects: r.projects,
    };
  });

  // Summary: derived from the FULL ranking, not the truncated page, so that
  // "top 10 share" remains correct regardless of `limit`.
  const totalNet = enriched.reduce((acc, r) => acc + r.netCommittedUsdc, 0n);
  const top10Net = enriched.slice(0, 10).reduce((acc, r) => acc + r.netCommittedUsdc, 0n);
  const summary = {
    totalCommittedUsdc: totalNet,
    activePatrons: enriched.length,
    top10ShareBps: totalNet > 0n ? Number((top10Net * 10000n) / totalNet) : 0,
  };

  return ok(c, { items, summary });
});
