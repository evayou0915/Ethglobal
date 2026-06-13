import { createHash } from "node:crypto";
import { ENV } from "./env.js";

/**
 * Walrus blob storage — https://docs.wal.app
 *
 * Proof artifacts (and any other app media) are stored as Walrus blobs via
 * the HTTP publisher, and read back through any aggregator. Walrus is
 * chain-agnostic: the app's money rail stays on Base, while blob
 * availability is certified on Sui by the storage nodes.
 *
 *   write:  PUT  {publisher}/v1/blobs?epochs=N&deletable=false
 *   read:   GET  {aggregator}/v1/blobs/{blobId}
 *
 * The public testnet endpoints (default) need no API key. Public publishers
 * cap uploads at ~10 MiB — run your own publisher for bigger artifacts.
 */

export interface StoredBlob {
  /** base64url-encoded u256 blob id — content address, same for identical bytes. */
  blobId: string;
  /** Sui object id of the blob registration (newly created blobs only). */
  suiObjectId: string | null;
  /** Walrus epoch after which the blob may expire. */
  endEpoch: number | null;
  /** True when Walrus already had these exact bytes certified. */
  alreadyCertified: boolean;
  size: number;
}

interface PublisherResponse {
  newlyCreated?: {
    blobObject: {
      id: string;
      blobId: string;
      size: number;
      storage?: { endEpoch?: number };
    };
  };
  alreadyCertified?: {
    blobId: string;
    endEpoch?: number;
  };
}

export async function storeBlob(file: File): Promise<StoredBlob> {
  const url =
    `${ENV.WALRUS_PUBLISHER_URL}/v1/blobs` +
    `?epochs=${ENV.WALRUS_EPOCHS}&deletable=false`;

  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) {
    throw new Error(`Walrus publisher ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const body = (await res.json()) as PublisherResponse;
  if (body.newlyCreated) {
    const b = body.newlyCreated.blobObject;
    return {
      blobId: b.blobId,
      suiObjectId: b.id,
      endEpoch: b.storage?.endEpoch ?? null,
      alreadyCertified: false,
      size: b.size,
    };
  }
  if (body.alreadyCertified) {
    return {
      blobId: body.alreadyCertified.blobId,
      suiObjectId: null,
      endEpoch: body.alreadyCertified.endEpoch ?? null,
      alreadyCertified: true,
      size: file.size,
    };
  }
  throw new Error(`Walrus publisher returned neither newlyCreated nor alreadyCertified`);
}

export async function fetchBlobBytes(blobId: string): Promise<ArrayBuffer> {
  const res = await fetch(aggregatorBlobUrl(blobId));
  if (!res.ok) {
    throw new Error(`Walrus aggregator ${res.status} for blob ${blobId}`);
  }
  return res.arrayBuffer();
}

export function aggregatorBlobUrl(blobId: string): string {
  return `${ENV.WALRUS_AGGREGATOR_URL}/v1/blobs/${encodeURIComponent(blobId)}`;
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const arr = new Uint8Array(buf);
  return "0x" + createHash("sha256").update(arr).digest("hex");
}
