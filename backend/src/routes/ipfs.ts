import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ENV } from "../lib/env.js";
import { requireAuth } from "../lib/auth.js";

export const ipfsRouter = new Hono();

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB — mirrors the submit-proof cap

/**
 * POST /api/ipfs-upload — generic Pinata pinning. Prefer
 * /api/intents/:id/milestones/:idx/submit-proof for milestone flows.
 *
 * Auth-gated: it pins to OUR Pinata account with OUR PINATA_JWT, so leaving it
 * open let anyone burn our storage/bandwidth quota (and pin arbitrary content
 * under our account). Require a logged-in user and cap the file size.
 */
ipfsRouter.post("/", requireAuth, async (c) => {
  if (!ENV.PINATA_JWT) {
    throw new HTTPException(500, { message: "PINATA_JWT not configured" });
  }
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    throw new HTTPException(400, { message: "field 'file' is required" });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new HTTPException(413, { message: "max 50 MB" });
  }

  const pinataForm = new FormData();
  pinataForm.append("file", file as Blob, (file as any).name ?? "blob");

  const r = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${ENV.PINATA_JWT}` },
    body: pinataForm,
  });
  if (!r.ok) {
    throw new HTTPException(502, { message: `Pinata ${r.status}: ${await r.text()}` });
  }
  const j = (await r.json()) as { IpfsHash: string };
  return c.json({
    data: {
      cid: j.IpfsHash,
      uri: `ipfs://${j.IpfsHash}`,
    },
  });
});
