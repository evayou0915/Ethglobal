import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireAuth } from "../lib/auth.js";
import { storeBlob, aggregatorBlobUrl } from "../lib/walrus.js";

export const storageRouter = new Hono();

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB — mirrors the submit-proof cap

/**
 * POST /api/storage-upload — generic Walrus upload (cover images, docs,
 * any app media). Prefer /api/intents/:id/milestones/:idx/submit-proof for
 * milestone flows — that route also hashes + advances the state machine.
 *
 * Auth-gated: the publisher pays for blob registration on our behalf, so an
 * open endpoint would let anyone burn the quota.
 */
storageRouter.post("/", requireAuth, async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new HTTPException(400, { message: "field 'file' is required" });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new HTTPException(413, { message: "max 50 MB" });
  }

  const stored = await storeBlob(file);
  return c.json({
    data: {
      blobId: stored.blobId,
      uri: `walrus://${stored.blobId}`,
      url: aggregatorBlobUrl(stored.blobId),
      suiObjectId: stored.suiObjectId,
      alreadyCertified: stored.alreadyCertified,
    },
  });
});
