/** Walrus aggregator helpers — read side of the proof storage.
 *  Must point at the same network as the backend's WALRUS_AGGREGATOR_URL. */

export const WALRUS_AGGREGATOR_URL = (
  process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL ??
  "https://aggregator.walrus-testnet.walrus.space"
).replace(/\/$/, "");

/** Public, keyless URL where anyone can fetch a blob back out of Walrus. */
export const walrusBlobUrl = (blobId: string) =>
  `${WALRUS_AGGREGATOR_URL}/v1/blobs/${encodeURIComponent(blobId)}`;

/** Proofs submitted before the Walrus migration stored IPFS CIDs ("bafy…",
 *  "Qm…") in the same column — those would 404 on an aggregator, so the UI
 *  only renders Walrus links for ids that look like Walrus blobIds. */
export const isWalrusBlobId = (id: string) =>
  !/^(bafy|Qm)/.test(id) && /^[A-Za-z0-9_-]{40,48}$/.test(id);
