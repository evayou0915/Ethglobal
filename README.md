# AuraSci — Milestone-Based Open-Science Funding on Base

> **From Proof to Capital.** Scientists publish 3-milestone research intents,
> patrons fund them in USDC, an AI gatekeeper screens publish-time and an AI
> verifier scores each milestone proof — capital is released tranche-by-tranche
> from a Solidity escrow on Base, only after a verifier signature.

[![Base](https://img.shields.io/badge/Base-Sepolia-0052FF?style=for-the-badge&logo=coinbase)](https://sepolia.basescan.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![Hono](https://img.shields.io/badge/Hono-Backend-FF6F00?style=for-the-badge)](https://hono.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-Postgres-2D3748?style=for-the-badge&logo=prisma)](https://www.prisma.io/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](#-license)

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

**The contract is a vault. The DB is the ledger.** All intent metadata,
milestone proofs, AI scores, Aura points and activity logs live in Postgres.
The contract only knows: balances keyed by `intentId`, the AI verifier's
public key, and the admin's address.

### Components

| Layer | Path | Stack |
| --- | --- | --- |
| Frontend | [`src/`](src/) | Next.js 14 App Router + wagmi/viem + SIWE wallet login |
| Backend API | [`backend/src/server.ts`](backend/src/server.ts) | Hono on Node 20 |
| Chain indexer | [`backend/src/indexer.ts`](backend/src/indexer.ts) | viem `watchContractEvent` |
| AI worker | [`backend/src/ai-worker.ts`](backend/src/ai-worker.ts) | OpenAI-compatible LLM + EIP-712 signer |
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

---

## 🧠 AI gatekeeper & verifier

Two distinct AI jobs, both run by the same worker process
([backend/src/ai-worker.ts](backend/src/ai-worker.ts)):

**Gatekeeper** (at publish time, [backend/src/lib/ai.ts](backend/src/lib/ai.ts#L86))
- 5-agent quorum, each scoring 0–100 from a different angle (feasibility, milestone clarity, scientific rigor, novelty, risk).
- **Pass requires BOTH** ≥3/5 agents approving AND mean score ≥ 70. Otherwise → `status = "rejected"` and the intent is hidden from the market.

**Verifier** (per-milestone proof)
- Default mode is `"approve"` — milestones auto-pass once a proof artifact is uploaded. This is a v1 demo choice; switching to real grading needs IPFS proof-body fetch (see TODO at [backend/src/lib/ai.ts:178](backend/src/lib/ai.ts#L178)).
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
- An OpenAI-compatible API key (only needed if you want real AI scoring; the default verifier mode is `"approve"`)

### 1. Clone + install

```bash
git clone https://github.com/Bicabo98/aurasciSL.git
cd aurasciSL
npm install
cd backend && npm install && cd ..
cd contracts && npm install && cd ..
```

### 2. Configure env

```bash
cp .env.example .env.local          # frontend (public NEXT_PUBLIC_* only)
cp backend/.env.example backend/.env # backend (DB url, signer key, JWT secret, OpenAI key)
```

Critical vars:
- `DATABASE_URL` — Postgres connection string
- `JWT_SECRET` — session-JWT signing secret (`openssl rand -hex 32`)
- `SIGNER_PRIVATE_KEY` — EIP-712 release signer (a fresh dev key is fine for local)
- `ESCROW_ADDRESS` / `USDC_ADDRESS` — set to your deployed contract + USDC on Base Sepolia
- `NEXT_PUBLIC_CHAIN_ID` (84532 for Sepolia)

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
aurasciSL/
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
│   ├── DEPLOYMENT.md
│   └── FORK_GUIDE.md
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
processes (api / indexer / ai-worker) as one unit. See
[docs/FORK_GUIDE.md](docs/FORK_GUIDE.md) for a step-by-step.

---

## 📊 What's done vs. what's deliberately stubbed

**Done**
- Full create → AI gatekeeper → publish → fund → submit-proof → AI verify → release → completed flow
- Patron refund (per-rejected-milestone + full intent rejection)
- Admin escape hatches: `refundAll`, `adminWithdraw`
- Aura social-points: seasons, boosts, milestone-yield distribution
- Leaderboard + activity feed (live indexer events)
- Per-user portfolio with Boost from holdings rows
- Scientist dashboard with milestone trajectory, dueDate display + Overdue flag
- DB-pinned wallet enforcement: no more "active wallet drifts under the contract" bugs

**Stubbed by design (v1 demo)**
- **AI verifier always approves** — the rubric path is wired but defaults to `"approve"` because IPFS proof-body fetch isn't implemented yet. See [backend/src/lib/ai.ts:149-157](backend/src/lib/ai.ts#L149-L157).
- **Scientist "approved" is implicit** — any user who completes `/onboard` is treated as approved; no admin review queue. See [src/app/(app)/scientist/page.tsx:44-48](src/app/(app)/scientist/page.tsx#L44-L48).

**Not started**
- Automated test coverage for backend + frontend (contract tests do exist)
- Verifier-key KMS / HSM storage (production-grade key custody)
- Phase 3 governance (patron-DAO challenges)

---

## 📚 Further reading

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system-level diagram + data flow
- [docs/BASE_MIGRATION.md](docs/BASE_MIGRATION.md) — why this stack, what changed from the original Solana version
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — deploy + verify on Base
- [docs/FORK_GUIDE.md](docs/FORK_GUIDE.md) — clone, point at your own DB/contract, ship in an afternoon

---

## 📄 License

MIT © 2026 AuraSci

---

> **AuraSci — Where breakthroughs find believers, and capital follows proof.**
