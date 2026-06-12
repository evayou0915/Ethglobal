import { Hono } from "hono";
import { prisma } from "../lib/db.js";
import { ok } from "../lib/http.js";

export const activityRouter = new Hono();

activityRouter.get("/", async (c) => {
  const q = c.req.query();
  const intentId = q.intentId;
  const actor = q.actor ? q.actor.toLowerCase() : undefined;
  const take = Math.min(Number(q.limit ?? 50), 200);
  const cursor = q.cursor;

  const rows = await prisma.activityLog.findMany({
    where: {
      ...(intentId ? { intentId } : {}),
      ...(actor ? { actorWallet: actor } : {}),
    },
    orderBy: { id: "desc" },
    take: take + 1,
    ...(cursor ? { cursor: { id: BigInt(cursor) }, skip: 1 } : {}),
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  return ok(c, {
    items: page,
    nextCursor: hasMore ? page[page.length - 1].id.toString() : null,
  });
});
