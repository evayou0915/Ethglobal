import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../lib/db.js";
import { ok, parseJson } from "../lib/http.js";
import { requireAuth, walletFrom } from "../lib/auth.js";
import { fetchOrcidProfile, isValidOrcidFormat } from "../lib/orcid.js";

export const scientistsRouter = new Hono();

scientistsRouter.get("/:wallet", async (c) => {
  const wallet = c.req.param("wallet").toLowerCase();
  const scientist = await prisma.scientist.findUnique({
    where: { wallet },
    include: { intents: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
  if (!scientist) throw new HTTPException(404, { message: "scientist not found" });
  return ok(c, scientist);
});

const PutSchema = z.object({
  displayName: z.string().min(2).max(80),
  bio: z.string().max(2000).optional(),
  avatarUrl: z.string().url().max(500).optional(),
  orcid: z.string().regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/).optional(),
  affiliation: z.string().max(200).optional(),
});

scientistsRouter.put("/:wallet", requireAuth, async (c) => {
  const requested = c.req.param("wallet").toLowerCase();
  const me = walletFrom(c);
  if (me !== requested) throw new HTTPException(403, { message: "you can only edit your own profile" });

  const body = await parseJson(c, PutSchema);

  // Verify ORCID iD against the public registry. This only proves the iD
  // exists — not that the caller owns it. The UI tells users a Council
  // member will cross-check identity manually within 48h.
  let orcidVerified = false;
  let orcidRegistryName: string | null = null;
  if (body.orcid) {
    if (!isValidOrcidFormat(body.orcid)) {
      throw new HTTPException(400, { message: "invalid ORCID iD format (expected 0000-0000-0000-0000)" });
    }
    const profile = await fetchOrcidProfile(body.orcid);
    if (!profile.exists) {
      throw new HTTPException(400, { message: `ORCID iD ${body.orcid} not found in the public registry` });
    }
    orcidVerified = true;
    orcidRegistryName = profile.fullName;
  }

  // Require a verified ORCID iD — without it we'd have no anti-Sybil
  // signal at all.
  if (!orcidVerified) {
    throw new HTTPException(400, {
      message: "Verify your identity with ORCID before submitting.",
    });
  }

  // Promote the caller to `scientist` — the role gate downstream features
  // (Create Intent, Submit Proof) use to decide who's allowed to publish.
  await prisma.user.upsert({
    where: { wallet: me },
    update: { role: "scientist" },
    create: { wallet: me, role: "scientist" },
  });

  const updated = await prisma.scientist.upsert({
    where: { wallet: me },
    update: { ...body, orcidVerified },
    create: { wallet: me, ...body, displayName: body.displayName, orcidVerified },
  });

  return ok(c, { ...updated, orcidRegistryName });
});
