# Walrus Integration — Proof Artifacts on Decentralized Storage

> AuraSci is a milestone-escrowed research-funding product: patrons fund
> scientists in USDC on Base, and an AI verifier gates each tranche release
> on the proof artifact the scientist submits. **Those proof artifacts are
> the most load-bearing data in the product — and they now live on Walrus.**
> This was a storage migration on an existing product (previously Pinata/IPFS),
> done during ETHGlobal New York 2026.

## Why Walrus is core here, not bolted on

The proof artifact is what the money decision is made on. After this
integration, Walrus sits on the release path itself:

```
scientist uploads proof
        │
        ▼
PUT {publisher}/v1/blobs        ← WRITE: artifact becomes a Walrus blob
        │ blobId + sha256 → Milestone row (Postgres)
        ▼
ai-worker verifier job
        │
GET {aggregator}/v1/blobs/{id}  ← READ: verifier fetches the REAL bytes back
        │ extract text (PDF/markdown/csv/…) → LLM grades vs deliverable
        ▼
score ≥ 70 → EIP-712 release signature (and only then)
        │
        ▼
escrow.release(intentId, to, amount, nonce, reason = sha256(blob), sig)
        │
        ▼
Released event on Base — reason anchors the Walrus blob content forever
```

If Walrus can't return the artifact, no release signature is ever produced
(`scoreProof` throws, the job retries and then fails visibly). The
storage layer is not a mirror — it's the input to the spend authorization.

## The three integration points

| # | Direction | Where | What |
| --- | --- | --- | --- |
| 1 | **Write** | [`backend/src/routes/proofs.ts`](../backend/src/routes/proofs.ts) | `submit-proof` streams the file to the Walrus publisher (`epochs` configurable, `deletable=false`), stores `blobId` + `sha256` on the milestone |
| 2 | **Read (machine)** | [`backend/src/lib/ai.ts`](../backend/src/lib/ai.ts) `scoreProof` | Verifier fetches the blob from the aggregator, extracts content (PDF via `unpdf`, text formats directly, binary → metadata-only conservative grading), includes it in the LLM rubric prompt |
| 3 | **Read (human)** | [`src/app/(app)/scientist/page.tsx`](../src/app/(app)/scientist/page.tsx), [`src/app/(app)/intent/[id]/page.tsx`](../src/app/(app)/intent/[id]/page.tsx) | "Proof on Walrus ↗" links resolve through the public aggregator — any patron or judge can open the exact artifact |

Plus a generic media endpoint (`POST /api/storage-upload`,
[`backend/src/routes/storage.ts`](../backend/src/routes/storage.ts)) for
cover images and other app assets.

The client ([`backend/src/lib/walrus.ts`](../backend/src/lib/walrus.ts)) is
~100 lines over the Walrus HTTP API — no SDK dependency, works in any Node
runtime. Walrus being chain-agnostic is the point: **the money rail stays on
Base (EVM), storage certification happens on Sui,** and neither side needs
to know about the other.

## On-chain anchoring (Base ↔ Walrus)

`AuraSciEscrow.release()` takes a `bytes32 reason` that is emitted in the
`Released` event. The claim flow ([`src/client/hooks.ts`](../src/client/hooks.ts))
now passes **the SHA-256 of the proof artifact** as `reason`. Verification
is therefore independently reproducible by anyone:

```bash
# 1. take blobId from the milestone (UI or API)
curl -s https://aggregator.walrus-testnet.walrus.space/v1/blobs/<blobId> | shasum -a 256
# 2. compare with the `reason` topic of the Released event on BaseScan
```

No contract changes were needed — the escrow's event schema already carried
an opaque reason field; it now carries a content commitment.

## Config

```bash
# backend/.env — public testnet endpoints are the zero-config defaults
WALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space
WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
WALRUS_EPOCHS=5                  # blob lifetime (testnet epoch ≈ 1 day)
AI_VERIFIER_MODE=llm             # fetch-from-Walrus + real LLM grading

# .env.local (frontend)
NEXT_PUBLIC_WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
```

Notes:
- Public testnet publishers cap uploads at ~10 MiB; the app-level cap is
  50 MB — run your own publisher to use the full range.
- Identical bytes re-upload as `alreadyCertified` with the same blobId
  (content addressing), which the client handles.

## Demo script (3 minutes)

1. **Scientist** opens `/scientist`, picks an `in_progress` milestone,
   uploads a results PDF → toast shows the Walrus blobId, milestone shows
   "Proof on Walrus ↗" (opens the raw artifact via the aggregator).
2. **AI verifier** (`AI_VERIFIER_MODE=llm`): click "Run AI verifier →
   claim" — the worker fetches the blob from the aggregator, grades the
   content, signs the EIP-712 release.
3. **Claim** broadcasts the release on Base Sepolia → BaseScan: the
   `Released` event's `reason` equals the SHA-256 of the blob you can fetch
   in step 1.
4. (Adversarial case) upload an empty/junk file as proof → verifier scores
   below 70 → milestone `rejected`, no signature exists, patron refund path
   opens.

## What changed vs. the pre-hackathon product

| Before (existing product) | After (this weekend) |
| --- | --- |
| Proofs pinned to IPFS via Pinata (account-bound JWT, gateway dependent) | Proofs stored as Walrus blobs (keyless public endpoints, any aggregator serves them) |
| Verifier couldn't fetch proof bodies → permanently stubbed to auto-approve | Verifier reads the artifact from Walrus and grades real content before signing |
| `release(reason)` carried an arbitrary tag | `reason` = SHA-256 of the Walrus-stored artifact (auditable end-to-end) |
| No public proof links in the UI | "Proof on Walrus ↗" on milestone cards in both dashboards |

## Future work

- **Own publisher** for >10 MiB datasets + custody of blob objects (extend/renew lifetimes).
- **Seal** encryption for embargoed datasets (decrypt rights gated on funding or release events).
- **Quilt** batching for many-small-file proof bundles (figures + notebooks + CSVs in one unit).
- Walrus blobId registry contract on Base for fully on-chain proof manifests (per the [evm-sui patterns](https://mystenlabs.github.io/evm-sui/)).
