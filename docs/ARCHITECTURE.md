# AuraSci Architecture

> **The smart contract is a vault. The backend is the ledger.**
> USDC custody and money movement live on-chain; everything else —
> profiles, intent metadata, milestone state machines, AI scores, proofs,
> activity, Aura points — lives in Postgres behind a Hono API.

## System diagram

```
┌──────────────────┐        ┌────────────────────────────────────┐
│  Next.js front   │  HTTPS │   Hono backend (self-hosted)        │
│  (Vercel)        │◀──────▶│                                     │
│  - SIWE auth     │        │  ┌──────────┐  ┌──────────┐         │
│  - wagmi/viem    │        │  │  /api/*  │  │ ai-worker│         │
│  - injected w.   │        │  │   Hono   │  │  (LLM    │         │
└────────┬─────────┘        │  └────┬─────┘  │  jobs)   │         │
         │ writeContract     │       │        └────┬─────┘         │
         ▼                   │       ▼             │               │
┌──────────────────┐         │  ┌─────────────────────────────┐    │
│ AuraSciEscrow.sol│◀────────┼──│  Postgres  (Prisma client)  │    │
│ on Base (USDC)   │         │  └─────────────────────────────┘    │
│ - deposit        │         │                ▲                    │
│ - release(sig)   │         │  ┌─────────────┴────┐               │
│ - refund(sig)    │         │  │     indexer      │ ── viem ──┐   │
│ - adminWithdraw  │         │  │ (event watcher)  │           │   │
└────────┬─────────┘         │  └──────────────────┘           │   │
         │ Deposited/        └──────────────────────────────────│──┘
         │ Released/                                            │
         │ Refunded                                             │
         └───────────────────────── Base RPC ───────────────────┘
```

Three long-running Node processes (`backend/ecosystem.config.cjs`):

| Process | Entry | Job |
| --- | --- | --- |
| `api` | [`backend/src/server.ts`](../backend/src/server.ts) | Hono HTTP API for the frontend |
| `indexer` | [`backend/src/indexer.ts`](../backend/src/indexer.ts) | `watchContractEvent` → mirrors `Deposited` / `Released` / `Refunded` into Postgres, with a persisted checkpoint |
| `ai-worker` | [`backend/src/ai-worker.ts`](../backend/src/ai-worker.ts) | Drains the `AiJob` queue: gatekeeper scoring, proof verification, EIP-712 release signing |

## Money flow (on-chain)

One contract: [`contracts/src/AuraSciEscrow.sol`](../contracts/src/AuraSciEscrow.sol).
State is deliberately minimal — `balanceOf[intentId]`, `usedNonce[nonce]`,
`admin` / `pendingAdmin`. No metadata, no statuses, no scores on-chain.

| Function | Caller | Gate |
| --- | --- | --- |
| `deposit(intentId, amount)` | Any patron | USDC `approve` + `transferFrom` |
| `release(intentId, to, amount, nonce, reason, sig)` | Scientist (via Claim) | EIP-712 sig from the backend verifier key |
| `refund(intentId, patron, amount, nonce, reason, sig)` | Patron | EIP-712 sig from the backend verifier key |
| `adminWithdraw(intentId, to, amount, reason)` | Admin only | 100k USDC per-tx cap; two-step admin rotation |

Every release/refund consumes a unique `nonce` (anti-replay). The verifier
key only signs payloads — it never holds funds; the admin key never signs
routine releases. Compromise of either is survivable (`setSigner`,
`setPaused`, `transferAdmin` → `acceptAdmin`).

## Off-chain data model

Prisma schema: [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma)

| Group | Models | Notes |
| --- | --- | --- |
| Identity | `User`, `Session`, `Scientist` | `User.wallet` is the permanent on-chain identity; SIWE login pins it |
| Market | `Intent`, `Milestone`, `Patronage` | Intent = proposal + funding goal; exactly 3 milestones each |
| Money mirror | `Release`, `RefundRecord`, `SignedNonce`, `IndexerCheckpoint` | DB reflection of on-chain events, written by the indexer |
| AI | `AiJob` | Queue rows: `gatekeeper` and `verifier` job kinds |
| Social | `AuraSeason`, `AuraSpend`, `AuraYield` | Off-chain reputation: season budgets, boosts, milestone yield |
| Audit | `ActivityLog` | Feeds the live activity UI |

## State machines

### Intent
```
draft → ai_screening → published → funded → completed
                │
                └─ rejected (refund path open)
```

### Milestone
```
locked → in_progress → proof_submitted → verifying → released
                                      │
                                      └─ rejected (per-milestone refund)
```

## AI pipeline

**Gatekeeper** (publish time, [`backend/src/lib/ai.ts`](../backend/src/lib/ai.ts)) —
five agents (ATLAS-7 feasibility, HELIX-3 milestone clarity, ORCHID-9
budget, VESTA-2 open-science integrity, LYRA-5 risk) score the proposal
0–100 in parallel. **Pass requires both** ≥3/5 individual approvals **and**
mean ≥ 70. Fail → intent is `rejected` and hidden from the market.

**Verifier** (per-milestone) — grades the submitted proof artifact and, on
pass, signs an EIP-712 release payload that is cached on the milestone row
(`releaseSignature` / `releaseNonce`). The scientist's Claim button
broadcasts that cached signature, so a cancelled wallet popup resumes
cleanly without re-grading. Mode is controlled by `AI_VERIFIER_MODE`
(`approve` | `heuristic` | `llm`).

## Auth

Sign-In-With-Ethereum ([`backend/src/routes/auth.ts`](../backend/src/routes/auth.ts)):
browser wallet signs a one-time server nonce → backend verifies → issues a
session JWT whose subject is the wallet address. Every API call carries the
JWT; ownership checks (intent owner, payout target, refund eligibility) all
compare against `User.wallet`. The frontend refuses to sign transactions
from any other address ([`src/client/hooks.ts`](../src/client/hooks.ts)).

## Proof artifacts — Walrus

Milestone proofs (PDFs, datasets, images, archives ≤ 50 MB) are uploaded via
`POST /api/intents/:id/milestones/:idx/submit-proof`
([`backend/src/routes/proofs.ts`](../backend/src/routes/proofs.ts)). The
backend computes a SHA-256 of the bytes, stores the file as a
[Walrus](https://www.walrus.xyz/) blob
([`backend/src/lib/walrus.ts`](../backend/src/lib/walrus.ts)), and records
the blobId + hash + filename on the `Milestone` row.

The artifact round-trips through Walrus on the money path: in `llm` mode
the verifier fetches the blob back from an aggregator and grades the actual
content before signing the release. The frontend renders public
"Proof on Walrus ↗" aggregator links, and the on-chain `release()` carries
the artifact's SHA-256 as `reason` — so every `Released` event commits to
the exact bytes stored on Walrus. Full write-up:
[WALRUS_INTEGRATION.md](WALRUS_INTEGRATION.md).

## Deployment topology

| Tier | Where |
| --- | --- |
| Frontend | Vercel (only `NEXT_PUBLIC_*` env) |
| Backend api + indexer + ai-worker | Self-hosted Node 20 (pm2, `backend/ecosystem.config.cjs`) |
| Postgres | Backend host or managed |
| Contract | Base Sepolia (testnet) / Base mainnet — see [DEPLOYMENT.md](DEPLOYMENT.md) |
