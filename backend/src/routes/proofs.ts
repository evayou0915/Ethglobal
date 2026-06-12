import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../lib/db.js";
import { ok } from "../lib/http.js";
import { assertIntentOwner, requireAuth } from "../lib/auth.js";
import { pinFileToIpfs, sha256Hex } from "../lib/ipfs.js";

export const proofsRouter = new Hono();

/**
 * POST /api/intents/:id/milestones/:idx/submit-proof
 * multipart/form-data with a single `file` field.
 */
proofsRouter.post("/intents/:id/milestones/:idx/submit-proof", requireAuth, async (c) => {
  const intentId = c.req.param("id");
  const idx = Number(c.req.param("idx"));
  if (!Number.isInteger(idx) || idx < 0 || idx > 2) {
    throw new HTTPException(400, { message: "milestone index must be 0..2" });
  }

  const intent = await prisma.intent.findUnique({
    where: { intentId },
    select: { scientistWallet: true, status: true },
  });
  if (!intent) throw new HTTPException(404, { message: "intent not found" });
  await assertIntentOwner(c, intent.scientistWallet);

  const milestone = await prisma.milestone.findUnique({
    where: { intentId_idx: { intentId, idx } },
  });
  if (!milestone) throw new HTTPException(404, { message: "milestone row missing" });
  if (milestone.status !== "in_progress") {
    throw new HTTPException(409, { message: `milestone is ${milestone.status}, expected in_progress` });
  }

  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HTTPException(400, { message: "field 'file' is required" });
  if (file.size > 50 * 1024 * 1024) throw new HTTPException(413, { message: "max 50 MB" });

  const bytes = await file.arrayBuffer();
  const proofHash = await sha256Hex(bytes);
  const repacked = new File([bytes], file.name, { type: file.type });
  const { cid } = await pinFileToIpfs(repacked);

  const updated = await prisma.milestone.update({
    where: { id: milestone.id },
    data: {
      proofCid: cid,
      proofHash,
      proofFileName: file.name.slice(0, 255),
      proofFileMime: file.type.slice(0, 100) || null,
      proofUploadedAt: new Date(),
      status: "proof_submitted",
    },
  });

  return ok(c, { cid, proofHash, milestone: updated });
});
