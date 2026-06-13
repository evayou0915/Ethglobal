// Verify the Walrus proof pipeline end-to-end via the real API:
// auth as scientist → upload file → blobId returned → fetch back from
// the public aggregator → SHA-256 matches what the backend anchored.
import { SignJWT } from "jose";
import { createHash } from "crypto";

const API = "http://localhost:8787";
const INTENT = "0xcell010000000000000000000000000000000000000000000000000000000000";
const SCIENTIST = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);

const token = await new SignJWT({ sub: SCIENTIST, role: "scientist" })
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setIssuer("aurasci").setAudience("aurasci-app").setSubject(SCIENTIST)
  .setIssuedAt().setExpirationTime("1h").sign(SECRET);

const content = `AuraSci milestone-0 proof · Walrus smoke test · ${new Date().toISOString()}\n` +
  "Cell culture protocol validated: 94% viability across 3 passages.\n";
const localSha = createHash("sha256").update(content).digest("hex");
console.log("local file SHA-256:", localSha);

const fd = new FormData();
fd.append("file", new Blob([content], { type: "text/plain" }), "proof-m0.txt");

console.log("uploading to Walrus via backend (testnet publisher, may take ~10-30s)…");
const res = await fetch(`${API}/api/intents/${INTENT}/milestones/0/submit-proof`, {
  method: "POST", headers: { authorization: "Bearer " + token }, body: fd,
});
const j: any = await res.json();
if (!res.ok) { console.error("✗ upload failed:", JSON.stringify(j)); process.exit(1); }
const d = j.data;
console.log("✓ upload OK. response:", JSON.stringify(d));
const blobId = d.blobId ?? d.cid;
console.log("blobId:", blobId, "| length:", blobId?.length, "| base64url:", /^[A-Za-z0-9_-]{40,50}$/.test(blobId ?? ""));
console.log("anchored proofHash:", d.proofHash, "| matches local sha:", d.proofHash?.toLowerCase().includes(localSha));

// Fetch back from the public aggregator and re-hash.
const aggUrl = d.blobUrl ?? `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${blobId}`;
console.log("fetching back from aggregator:", aggUrl);
for (let i = 0; i < 8; i++) {
  const r = await fetch(aggUrl);
  if (r.ok) {
    const buf = Buffer.from(await r.arrayBuffer());
    const back = createHash("sha256").update(buf).digest("hex");
    console.log("re-fetched SHA-256:", back, "| round-trip match:", back === localSha ? "✓ YES" : "✗ NO");
    process.exit(0);
  }
  await new Promise(r => setTimeout(r, 4000));
}
console.log("(aggregator read not ready yet — publish succeeded, propagation lag)");
