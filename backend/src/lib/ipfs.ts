import { createHash } from "node:crypto";
import { ENV } from "./env.js";

export async function pinFileToIpfs(file: File): Promise<{ cid: string; size: number }> {
  if (!ENV.PINATA_JWT) {
    // Dev fallback — deterministic fake CID so the flow can run without Pinata.
    const arr = new Uint8Array(await file.arrayBuffer());
    const hash = createHash("sha256").update(arr).digest("hex");
    return { cid: `bafy-dev-${hash.slice(0, 32)}`, size: file.size };
  }

  const form = new FormData();
  form.append("file", file, file.name);
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { authorization: `Bearer ${ENV.PINATA_JWT}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Pinata ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { IpfsHash: string; PinSize: number };
  return { cid: json.IpfsHash, size: json.PinSize };
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const arr = new Uint8Array(buf);
  return "0x" + createHash("sha256").update(arr).digest("hex");
}
