# AuraSci — Milestone-Based Open-Science Funding on Base

> **From Proof to Capital.** Scientists publish 3-milestone research intents,
> patrons fund them in USDC, an AI gatekeeper screens publish-time and an AI
> verifier grades each milestone proof straight from **Walrus** storage —
> capital is released tranche-by-tranche from a Solidity escrow on Base,
> only after a verifier signature.

[![Base](https://img.shields.io/badge/Base-Sepolia-0052FF?style=for-the-badge&logo=coinbase)](https://sepolia.basescan.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![Hono](https://img.shields.io/badge/Hono-Backend-FF6F00?style=for-the-badge)](https://hono.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-Postgres-2D3748?style=for-the-badge&logo=prisma)](https://www.prisma.io/)
[![Walrus](https://img.shields.io/badge/Walrus-Blob_Storage-7CFBFF?style=for-the-badge)](https://www.walrus.xyz/)
[![Claude](https://img.shields.io/badge/AI-Claude-D97757?style=for-the-badge)](https://www.anthropic.com/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](#-license)

---

## 🔗 Live demo

| | |
| --- | --- |
| **App** | **https://aurasci-ethglobal.vercel.app** |
| **Escrow contract** (Base Sepolia) | [`0x78C62DAd99F1174DAABdD730a6Dd512CDbB44dB4`](https://sepolia.basescan.org/address/0x78C62DAd99F1174DAABdD730a6Dd512CDbB44dB4) |
| **USDC** (Base Sepolia) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| **Chain** | Base Sepolia (84532) |
| **AI verifier** | Anthropic Claude (`claude-haiku-4-5`) — real proof grading in `llm` mode |

> Sign in with a browser wallet (MetaMask / Rabby) on Base Sepolia; grab test
> ETH + USDC from the in-app faucet links. The backend API base URL is a
> rotating dev tunnel during the hackathon, so if the app can't reach the API,
> the demo host needs to be running — see [Deployment](#-deployment).

---

## 🧬 What this is

Grant funding takes 9–18 months and pays in lump sums with no accountability
after the cheque clears. AuraSci replaces the cheque with a **programmable
USDC escrow on Base** that releases capital milestone by milestone, gated by
AI verification of the proof a scientist submits.

Three primitives:

| Primitive | What it is | Where it lives |
| --- | --- | --- |
| **Intent** | A research proposal with funding goal + 3 milestones | DB row + on-chain escrow accounting |
| **Patronage** | A patron's USDC deposit toward an intent | `Deposited` event → DB row |
| **Milestone release** | A tranche payout to the scientist after AI verification | `Released` event signed by the AI verifier key |

No tokens, no governance noise — just **verified milestone → released capital**.

A parallel **Aura** social-points layer ([backend/src/lib/aura.ts](backend/src/lib/aura.ts))
runs alongside escrow: patrons spend season-budgeted Aura to "boost" intents
they believe in, and earn yield Aura when those intents hit milestones. Pure
off-chain reputation, no on-chain token.

---

## 🏛 Architecture

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

**The contract is a vault. The DB is the ledger. Walrus is the archive.**
All intent metadata, AI scores, Aura points and activity logs live in
Postgres. Proof artifacts (papers, datasets, figures) are stored as
[Walrus](https://www.walrus.xyz/) blobs — the DB keeps only their blobId +
SHA-256. The contract only knows: balances keyed by `intentId`, the AI
verifier's public key, and the admin's address.

### Components

| Layer | Path | Stack |
| --- | --- | --- |
| Frontend | [`src/`](src/) | Next.js 14 App Router + wagmi/viem + SIWE wallet login |
| Canton rail | [`canton/`](canton/) | Daml templates for ledger-private patronage (see [canton/README.md](canton/README.md)) |
| Backend API | [`backend/src/server.ts`](backend/src/server.ts) | Hono on Node 20 |
| Chain indexer | [`backend/src/indexer.ts`](backend/src/indexer.ts) | viem `watchContractEvent` |
| AI worker | [`backend/src/ai-worker.ts`](backend/src/ai-worker.ts) | Anthropic Claude grader + EIP-712 signer |
| Proof storage | [`backend/src/lib/walrus.ts`](backend/src/lib/walrus.ts) | Walrus HTTP publisher/aggregator (blobs certified on Sui) |
| Smart contract | [`contracts/src/AuraSciEscrow.sol`](contracts/src/AuraSciEscrow.sol) | Solidity 0.8.24 + OZ |
| DB schema | [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma) | Postgres via Prisma |

---

## 🔐 How money moves

The contract supports four ways to move USDC. Three of them require an
EIP-712 signature from the backend's verifier key:

| Function | Caller | What it does |
| --- | --- | --- |
| `deposit(intentId, amount)` | Anyone (patrons) | Tags USDC against an intentId; emits `Deposited`. |
| `release(intentId, to, amount, nonce, reason, sig)` | Scientist | Pays a milestone tranche to the scientist after the AI verifier signs. Contract checks `sig` recovers to `signer`. |
| `refund(intentId, patron, amount, nonce, reason, sig)` | Patron | Claws back a deposit when intent or milestone is rejected. Same signature check. |
| `adminWithdraw(intentId, to, amount, reason)` | Admin only | Escape hatch / governance — bypasses milestone gating, capped at 100k USDC per tx. |

Admin power is **rotatable** via a two-step `transferAdmin` → `acceptAdmin`
flow. The verifier key is rotatable via `setSigner` (admin-only).

Why signatures and not direct admin calls? So the AI worker can sign release
authorizations without ever holding withdraw power. If the verifier key
leaks, the worst case is forged milestone releases — admin can rotate the
key and pause via `setPaused`. The admin key itself stays cold.

The `reason` field on every milestone `release()` carries the **SHA-256 of
the proof artifact stored on Walrus** — so each on-chain `Released` event is
a permanent commitment to exactly the bytes the AI verifier graded. Fetch
the blob from any Walrus aggregator, hash it, compare with the event: the
whole release trail is independently auditable.

---

## 🐋 Walrus storage

Proof artifacts live on [Walrus](https://www.walrus.xyz/) — decentralized
blob storage certified on Sui, chain-agnostic by design (our money rail
stays on Base). Three integration points:

| Path | Direction | What happens |
| --- | --- | --- |
| [`submit-proof`](backend/src/routes/proofs.ts) | **write** | Scientist's proof file → `PUT {publisher}/v1/blobs` → blobId + SHA-256 recorded on the `Milestone` row |
| [`scoreProof`](backend/src/lib/ai.ts) | **read** | In `llm` mode the verifier fetches the blob back from an aggregator, extracts content (PDF/text), and grades it — **the release signature only exists because Walrus returned the artifact** |
| Frontend | **read** | "Proof on Walrus ↗" links on milestone cards resolve via the public aggregator; the on-chain `reason` anchors the same bytes |

Client: [`backend/src/lib/walrus.ts`](backend/src/lib/walrus.ts) (~100
lines, plain `fetch`, no SDK). Generic media uploads go through
`POST /api/storage-upload` ([`backend/src/routes/storage.ts`](backend/src/routes/storage.ts)).
The public testnet publisher/aggregator are the zero-config defaults — see
[docs/WALRUS_INTEGRATION.md](docs/WALRUS_INTEGRATION.md) for the full
write-up, demo script and design notes.

---

## 🧠 AI gatekeeper & verifier

Two distinct AI jobs, both run by the same worker process
([backend/src/ai-worker.ts](backend/src/ai-worker.ts)):

**Gatekeeper** (at publish time, [backend/src/lib/ai.ts](backend/src/lib/ai.ts#L86))
- 5-agent quorum, each scoring 0–100 from a different angle (feasibility, milestone clarity, scientific rigor, novelty, risk).
- **Pass requires BOTH** ≥3/5 agents approving AND mean score ≥ 70. Otherwise → `status = "rejected"` and the intent is hidden from the market.

Both jobs call **Anthropic Claude** via the official `@anthropic-ai/sdk`
([backend/src/lib/ai.ts](backend/src/lib/ai.ts) `callClaude`). Model is set by
`ANTHROPIC_MODEL` (default `claude-haiku-4-5` — cheap enough to grade every
claim; bump to `claude-sonnet-4-6` / `claude-opus-4-8` for more rigor).

**Verifier** (per-milestone proof)
- In `llm` mode (set `AI_VERIFIER_MODE=llm` + `ANTHROPIC_API_KEY`) the worker
  **fetches the proof artifact back from Walrus**, extracts readable content
  (PDF via unpdf, text formats directly), and grades it against the
  milestone's stated deliverable. A proof that can't be retrieved never
  produces a release signature. `approve` mode remains as a zero-key demo
  escape hatch.
- Verified live: a real milestone proof scores **82/100** and a garbage
  proof **5/100** — `npm run --prefix backend exec tsx scripts/verifier-claude-smoke.mts`.
- On pass, the worker signs an EIP-712 release payload and caches it on the milestone row. The scientist's "Claim" button broadcasts that cached signature — failed broadcasts (cancelled popups, gas issues) become a clean "Resume claim" without re-grading.

The verifier key never touches the frontend. The signed payload + nonce live
in `Milestone.releaseSignature / releaseNonce`.

---

## 🔑 SIWE auth + DB-pinned wallets

Login is Sign-In-With-Ethereum: the browser wallet signs a SIWE message
carrying a one-time server nonce, and the backend
([backend/src/routes/auth.ts](backend/src/routes/auth.ts)) verifies it and
issues a self-signed session JWT whose subject is the wallet address. Every
API call carries that JWT; [backend/src/lib/auth.ts](backend/src/lib/auth.ts)
verifies it and hydrates the local User row.

`User.wallet` is the user's **permanent on-chain identity** — the same
address that signed in is the only one every downstream check (intent
ownership, scientist payout, refund eligibility) accepts.

Frontend mirrors the same rule:
[useEnsureWalletReady](src/client/hooks.ts) refuses to sign transactions
from any address other than `/me.wallet`.

---

## 🚀 Local development

### Prerequisites

- Node 20+
- Postgres 14+ (local or remote)
- Base Sepolia RPC URL (Alchemy, Infura, or public endpoint)
- An Anthropic API key (only needed for real AI scoring in `llm` mode; the default verifier mode is `"approve"`)

### 1. Clone + install

```bash
git clone https://github.com/evayou0915/Ethglobal.git
cd Ethglobal
npm install
cd backend && npm install && cd ..
cd contracts && npm install && cd ..
```

### 2. Configure env

```bash
cp .env.example .env.local          # frontend (public NEXT_PUBLIC_* only)
cp backend/.env.example backend/.env # backend (DB url, signer key, JWT secret, Anthropic key)
```

Critical vars:
- `DATABASE_URL` — Postgres connection string
- `JWT_SECRET` — session-JWT signing secret (`openssl rand -hex 32`)
- `SIGNER_PRIVATE_KEY` — EIP-712 release signer (a fresh dev key is fine for local)
- `ESCROW_ADDRESS` / `USDC_ADDRESS` — set to your deployed contract + USDC on Base Sepolia
- `NEXT_PUBLIC_CHAIN_ID` (84532 for Sepolia)
- `WALRUS_PUBLISHER_URL` / `WALRUS_AGGREGATOR_URL` — default to the public
  Walrus testnet endpoints; no key needed
- `AI_VERIFIER_MODE` — `llm` for real Walrus-fetch + LLM grading (needs
  `ANTHROPIC_API_KEY`), `approve` to demo the flow without one

### 3. Deploy / use the escrow contract

```bash
cd contracts
npm run compile
npm test                                # 17 contract tests should pass
npm run deploy:sepolia                  # outputs the contract address
```

Copy the address into `backend/.env` (`ESCROW_ADDRESS`) and `.env.local`
(`NEXT_PUBLIC_ESCROW_ADDRESS`).

### 4. Init DB + run the backend

```bash
cd backend
npm run db:migrate:dev                  # apply migrations
npm run db:seed                         # optional demo data
npm run dev                             # api + indexer + ai-worker in parallel
```

### 5. Run the frontend

```bash
# in the repo root
npm run dev                             # next dev on :5173
```

Open `http://localhost:5173`, sign in with your browser wallet (MetaMask / Rabby), grab
test USDC from the [Circle Sepolia faucet](https://faucet.circle.com/), and
fund an intent.

---

## 🛠 Repository layout

```
Ethglobal/
├── src/                          # Next.js frontend
│   ├── app/(app)/               # App Router pages (market, intent, create, scientist, portfolio, leaderboard, ...)
│   ├── client/                  # api.ts, hooks.ts, wagmi config
│   ├── components/              # Nav, WalletPanel, SignInModal, Toast, ...
│   └── types/                   # shared API DTOs
│
├── backend/                      # self-hosted Hono backend
│   ├── src/
│   │   ├── server.ts            # HTTP entry point
│   │   ├── indexer.ts           # on-chain event → DB
│   │   ├── ai-worker.ts         # AiJob queue drainer
│   │   ├── routes/              # /api/intents, /auth, /aura, /admin, /refunds, ...
│   │   └── lib/                 # auth (SIWE JWT), ai (LLM quorum), eip712, db, ...
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   └── scripts/                 # one-off ops scripts (purge, simulate-release, ...)
│
├── contracts/                    # Hardhat workspace, decoupled from the Next.js app
│   ├── src/
│   │   ├── AuraSciEscrow.sol
│   │   └── test/MockUSDC.sol
│   ├── test/                    # 17 unit tests
│   └── scripts/deploy.ts
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── BASE_MIGRATION.md        # design rationale + phase log
│   └── DEPLOYMENT.md
│
└── public/                       # static demo data + landing assets
```

---

## 🚢 Deployment

| Tier | Where | Notes |
| --- | --- | --- |
| Frontend | Vercel | Static + SSR Next.js. `NEXT_PUBLIC_*` vars only. |
| Backend (API + indexer + ai-worker) | Self-hosted (Render / Fly / EC2 / your VPS) | Long-running Node processes. `pm2` or `docker-compose` recommended — Vercel can't run them. |
| Database | Postgres on the backend host (or managed) | Single source of truth for off-chain state. |
| Contract | Base Sepolia (testnet) / Base mainnet | See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). |

`backend/ecosystem.config.cjs` is a pm2 config that starts the three Node
processes (api / indexer / ai-worker) as one unit.

---

## 📊 What's done vs. what's deliberately stubbed

**Done**
- Full create → AI gatekeeper → publish → fund → submit-proof → AI verify → release → completed flow
- **Walrus storage end-to-end**: proofs stored as blobs at submit time, AI verifier reads them back through the aggregator before signing, on-chain `Released.reason` anchors the artifact's SHA-256, UI links resolve every proof publicly
- Patron refund (per-rejected-milestone + full intent rejection)
- Admin escape hatches: `refundAll`, `adminWithdraw`
- Aura social-points: seasons, boosts, milestone-yield distribution
- Leaderboard + activity feed (live indexer events)
- Per-user portfolio with Boost from holdings rows
- Scientist dashboard with milestone trajectory, dueDate display + Overdue flag
- DB-pinned wallet enforcement: no more "active wallet drifts under the contract" bugs

**Stubbed by design (v1 demo)**
- **Verifier default mode is `approve`** — real grading (`AI_VERIFIER_MODE=llm`) fetches the proof from Walrus and scores it with an LLM; the default stays permissive so the flow demos without an LLM key. Flip the env var for real verification.
- **Scientist "approved" is implicit** — any user who completes `/onboard` is treated as approved; no admin review queue. See [src/app/(app)/scientist/page.tsx:44-48](src/app/(app)/scientist/page.tsx#L44-L48).

**Not started**
- Automated test coverage for backend + frontend (contract tests do exist)
- Verifier-key KMS / HSM storage (production-grade key custody)
- Phase 3 governance (patron-DAO challenges)

---

## 📚 Further reading

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system-level diagram + data flow
- [docs/WALRUS_INTEGRATION.md](docs/WALRUS_INTEGRATION.md) — Walrus storage design, demo script, verification trail
- [docs/BASE_MIGRATION.md](docs/BASE_MIGRATION.md) — design rationale + phase log
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — deploy + verify on Base

---

## 📄 License

MIT © 2026 AuraSci

---

> **AuraSci — Where breakthroughs find believers, and capital follows proof.**
