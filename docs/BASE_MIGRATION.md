# AuraSci — Migration to Base + Backend Architecture

> **Status — current shipping snapshot:**
> - Phase A (contracts, Hardhat) ✅ 17/17 tests passing
> - Phase B (DB) ✅ moved to `backend/prisma/`
> - Phase C superseded by **Phase F** — standalone Hono backend in `backend/` + JWT auth, frontend deploys to Vercel separately
> - Phase D' (React frontend, 5 interactive pages) ✅ `next build` clean
> - Phase E ✅ Solana code purged
> - Phase G ✅ `public/` cleanup
> - **Phase H ✅ Faithful HTML→React restoration** — 6 pages ported pixel-close to the originals (market / intent-detail / scientist / portfolio / create / onboard), all original mock data inlined
> - **Phase I ✅ Real wallet auth (SIWE)** — the stubbed sign-in modal now runs a real Sign-In-With-Ethereum flow: injected wallet → signed nonce → self-issued session JWT
> - **Phase J ✅ Landing → React auth handoff** — `/index.html` (Halftone Bust) Login button redirects to `/market?signin=open`; auth state mirrored to `localStorage.aurasci_auth` so the landing recognises signed-in users
> - **Phase K (async + leaderboard)** — backend now has a 3rd long-running process (`ai-worker`) that drains the `AiJob` queue (gatekeeper + verifier scoring + EIP-712 signing); `/api/leaderboard` aggregates net committed USDC from `Patronage`/`RefundRecord`
> - README + ARCHITECTURE refresh pending
> **Owner:** Eva (juncheng@advaita.xyz)
> **Started:** 2026-05-27
> **Stack target:** Base (EVM L2) + Postgres + Next.js API

---

## 0. Design principle

> **The smart contract is a vault. The backend is the ledger.**
>
> The contract holds USDC and only moves money under signed authorization. *Everything else* — scientist profiles, intent metadata, milestone descriptions, AI scores, status machines, activity feed — lives in the backend Postgres DB.

This is a deliberate departure from the original Solana program (which co-located metadata, statuses, AI scores, and proof URIs on-chain). On Base, every byte of storage costs gas, so we strip the contract down to **only money movement**.

### Trust model

| Concern | Who is trusted | Mitigation |
|---|---|---|
| Money custody (USDC escrow) | The contract code | Auditable, immutable |
| Authorization to release/refund | The backend `signer` private key | Stored in KMS / HSM, optional per-tx cap + timelock |
| Records (who patronized, what the milestones say) | The backend DB | DB backups; emergency self-refund escape hatch (see §3) |

If the backend signer key is compromised, an attacker could drain every escrow. This is the **accepted tradeoff** for keeping the contract minimal.

---

## 1. Contract surface area (final)

One contract: `AuraSciEscrow.sol`. Three external functions.

### `deposit(bytes32 intentId, uint256 amount)`
- Permissionless. Anyone with USDC can call.
- Pulls USDC via `transferFrom` (patron must `approve` first).
- Increments `balanceOf[intentId]`.
- Emits `Deposited(intentId, patron, amount)`.

### `release(bytes32 intentId, address to, uint256 amount, bytes32 nonce, bytes32 reason, bytes sig)`
- Permissionless to call, but `sig` must be a valid EIP-712 signature from `signer` over `(RELEASE, intentId, to, amount, nonce)`.
- Decrements `balanceOf[intentId]`, transfers USDC to `to`.
- Marks `nonce` as used (anti-replay).
- Emits `Released(intentId, to, amount, reason)`.

### `refund(bytes32 intentId, address patron, uint256 amount, bytes32 nonce, bytes32 reason, bytes sig)`
- Same shape as `release`, but EIP-712 type is `REFUND`.

### State variables (the *only* state)
```solidity
IERC20  public immutable USDC;
address public immutable signer;
mapping(bytes32 => uint256) public balanceOf;   // intentId → escrowed USDC
mapping(bytes32 => bool)    public usedNonce;
```

### What is **NOT** in the contract
- ❌ Scientist registry / addresses
- ❌ Intent metadata, ticker, description
- ❌ Funding goal, milestone count, milestone amounts
- ❌ Status machine (Draft/Published/Funded/Completed/Rejected)
- ❌ AI scores (gatekeeper or verifier)
- ❌ Proof hashes / IPFS CIDs (after debate — kept off-chain; backend signs+publishes proof manifests)
- ❌ NFT / SBT (handled off-chain as a credential record; can be added later as a separate contract if needed)

---

## 2. Backend DB schema (Postgres via Prisma)

Tables:

| Table | Purpose |
|---|---|
| `User` | Wallet-keyed identity (SIWE login), role flag |
| `Scientist` | Public scientist profile (display name, bio, affiliation, ORCID) |
| `Intent` | Research proposal: title, description, category, funding goal, status, AI gatekeeper score & rationale |
| `Milestone` | Per-intent milestone (idx 0/1/2): title, description, due date, release amount, status, proof CID & hash, AI verifier score & rationale |
| `Patronage` | Per-(intent, patron) deposit record, mirrored from `Deposited` events |
| `ActivityLog` | Flat event feed populated by the indexer worker |
| `AiJob` | Async queue for LLM grading (gatekeeper + verifier) |
| `Release` | Per-milestone release record, mirrored from `Released` events |
| `RefundRecord` | Mirrored from `Refunded` events |
| `Nonce` | Track issued EIP-712 nonces (idempotency + replay defense at API layer) |

See [`prisma/schema.prisma`](../prisma/schema.prisma) for the canonical definition.

---

## 3. Open design questions (for follow-up)

- **Emergency self-refund**: if the backend goes dark, can patrons recover funds? Two options:
  - (a) Add a `selfRefund(intentId, deposits[], merkleProof, sig)` function that lets a patron prove their cumulative deposit and pull funds after a timeout.
  - (b) Accept the centralization risk for MVP; rely on operational backups.
  - **Decision: defer to Phase 2** (after MVP works).
- **Per-tx release cap**: hard-cap `release` amount in the contract to limit blast radius of a compromised signer.
  - **Decision: add `MAX_RELEASE_PER_TX = 100_000 USDC` as a constant.** Reviewable.
- **Signer rotation**: `signer` is immutable. To rotate, deploy a new contract and migrate. Trade-off accepted for simplicity.

---

## 4. Implementation checklist

Mark each item complete **only** when the artifact exists, tests pass, and the doc-reader could verify it.

### Phase A — Smart contract

- [x] **A1.** Write this design doc (`docs/BASE_MIGRATION.md`)
- [x] **A2.** ~~Scaffold Foundry project~~ **Switched to Hardhat** ([contracts/hardhat.config.ts](../contracts/hardhat.config.ts), [contracts/package.json](../contracts/package.json)) — solidity 0.8.24, evm `cancun`, sources at `./src`. Rationale recorded in §0.
- [x] **A3.** Implement [`contracts/src/AuraSciEscrow.sol`](../contracts/src/AuraSciEscrow.sol) per §1
- [x] **A4.** Write Hardhat tests in [`contracts/test/AuraSciEscrow.test.ts`](../contracts/test/AuraSciEscrow.test.ts) (ethers v6 + chai-matchers). Coverage:
  - happy-path deposit (×3 cases) + zero-amount revert
  - happy-path release w/ valid sig
  - reject release/refund with wrong signer
  - reject replay (used nonce)
  - reject release exceeding `balanceOf[intentId]`
  - reject `release` amount > `MAX_RELEASE_PER_TX`
  - reject zero amount / zero recipient
  - reject cross-instruction signature reuse (release sig used as refund)
  - EIP-712 domain separator exposed + `hashRelease` matches off-chain `TypedDataEncoder.hash`
  - **✅ All 17 tests passing** via `npx hardhat test` (run on this machine, 2026-05-27).
- [x] **A5.** Hardhat npm scripts (`compile`, `test`, `coverage`, `deploy:sepolia`, `deploy:base`, `verify:sepolia`) wired in [contracts/package.json](../contracts/package.json). Deploy script: [contracts/scripts/deploy.ts](../contracts/scripts/deploy.ts).

### Phase B — Backend DB

- [x] **B1.** Add Prisma to root `package.json` (`prisma` dev dep + `@prisma/client` + `tsx`, plus `db:*` npm scripts)
- [x] **B2.** Write [`prisma/schema.prisma`](../prisma/schema.prisma) for all tables in §2 — validated with `prisma validate`
- [ ] **B3.** Create an initial migration (`prisma migrate dev --name init`) — record SQL output in `prisma/migrations/`. ⚠ **Blocked:** requires a running Postgres instance + `DATABASE_URL`. Run locally to generate.
- [x] **B4.** Seed script [`prisma/seed.ts`](../prisma/seed.ts) reproducing the 3 hero intents (`$CELL-01`, `$NEUR-01`, `$GENE-01`)

### Phase C — Backend API

Shared backend libraries (all under [src/server/](../src/server/)):
- [x] **C0a.** [db.ts](../src/server/db.ts) — Prisma client singleton (Next.js HMR-safe)
- [x] **C0b.** [chain.ts](../src/server/chain.ts) — viem public + signer wallet clients, chain selector (Base / Base Sepolia)
- [x] **C0c.** [escrow-abi.ts](../src/server/escrow-abi.ts) — typed ABI subset used by indexer + signer
- [x] **C0d.** [eip712.ts](../src/server/eip712.ts) — `signRelease`, `signRefund`, `deriveNonce`, `reasonTag`
- [x] **C0e.** [session.ts](../src/server/session.ts) — iron-session cookie config (`aurasci.sid`)
- [x] **C0f.** [http.ts](../src/server/http.ts) — `ok` / `fail` / `parseBody` (zod) / `serialize` (BigInt-safe) / `handle` wrapper
- [x] **C0g.** [ai.ts](../src/server/ai.ts) — pluggable LLM scorer (heuristic by default, OpenAI when `OPENAI_API_KEY` set)
- [x] **C0h.** [ipfs.ts](../src/server/ipfs.ts) — Pinata uploader (with dev-mode fake CID fallback)

Routes:
- [x] **C1.** SIWE auth — [`/api/auth/siwe/nonce`](../src/app/api/auth/siwe/nonce/route.ts), [`/api/auth/siwe/verify`](../src/app/api/auth/siwe/verify/route.ts), [`/api/auth/me`](../src/app/api/auth/me/route.ts), [`/api/auth/logout`](../src/app/api/auth/logout/route.ts)
- [x] **C2.** Scientists CRUD — [`/api/scientists/[wallet]`](../src/app/api/scientists/[wallet]/route.ts) (`GET` public, `PUT` self-only)
- [x] **C3.** Intents — [`/api/intents`](../src/app/api/intents/route.ts) (`GET` list w/ cursor pagination + filters; `POST` create with auto-gatekeeper scoring), [`/api/intents/[id]`](../src/app/api/intents/[id]/route.ts) detail
- [x] **C4.** Proof submission — [`/api/intents/[id]/milestones/[idx]/submit-proof`](../src/app/api/intents/[id]/milestones/[idx]/submit-proof/route.ts) (multipart, computes SHA-256, pins to IPFS, advances milestone to `proof_submitted`)
- [x] **C5.** AI gatekeeper — [`/api/ai/gatekeeper`](../src/app/api/ai/gatekeeper/route.ts) (re-scores an existing intent; also runs inline on intent create)
- [x] **C6.** AI verifier + EIP-712 signer — [`/api/ai/verifier`](../src/app/api/ai/verifier/route.ts). On `score ≥ 70`, signs `Release(intentId, to, amount, nonce)` with the backend key and returns the signature for the frontend to submit on-chain.
- [x] **C7.** Activity feed — [`/api/activity`](../src/app/api/activity/route.ts) (paginated, filterable by intentId / actor)
- [x] **C8.** Indexer worker — [`scripts/indexer.ts`](../scripts/indexer.ts). Polls `getContractEvents` in 1k-block windows, handles `Deposited` / `Released` / `Refunded`, mirrors into Postgres, promotes milestone status on release, advances intent to `completed` after the 3rd release. Resumes from `IndexerCheckpoint`. Run via `npm run indexer`.

**Verification:** `npx tsc --noEmit` passes cleanly across the new backend code (verified 2026-05-27).

### Phase D' — Frontend rewire **(React + wagmi + RainbowKit)**

> **Approach change v2:** Phase D originally delivered a vanilla-JS integration ([public/base-integration.js](../public/base-integration.js)) to match the existing static-HTML bundle. The product owner wanted the wagmi/RainbowKit UX (network switch, ENS, pending-tx indicators) + cross-stack type sharing + HMR. Re-done as a proper React migration of the 5 interactive pages; landing pages remain static in `/public` and reach the React app via clean URLs.

**Stack added**
- `wagmi@^2.13`, `@rainbow-me/rainbowkit@^2.2`, `@tanstack/react-query@^5.62`
- Wagmi config: [src/wagmi/config.ts](../src/wagmi/config.ts) (active chain = Base Sepolia by default; `NEXT_PUBLIC_CHAIN_ID=8453` flips to mainnet)
- ABI exports: [src/wagmi/abi.ts](../src/wagmi/abi.ts)
- Providers tree: [src/app/providers.tsx](../src/app/providers.tsx) (`WagmiProvider → QueryClientProvider → RainbowKitProvider → ToastProvider`)
- Root layout: [src/app/layout.tsx](../src/app/layout.tsx) loads Newsreader/Inter/JetBrains Mono + `/bust-theme.css` so React pages reuse the existing visual language

**Shared client layer**
- [src/types/api.ts](../src/types/api.ts) — DTO shapes derived from backend responses (BigInt fields serialized as strings)
- [src/client/api.ts](../src/client/api.ts) — fetch wrapper for every `/api/*` endpoint
- [src/client/hooks.ts](../src/client/hooks.ts) — `useSiweLogin`, `useAutoSiwe`, `useSession`, `useIntent(s)`, `useActivity`, `useFund`, `useClaim`, `useSubmitProof`, formatting helpers
- [src/components/Nav.tsx](../src/components/Nav.tsx) — sticky nav with `<ConnectButton/>`; auto-runs SIWE the first time a wallet connects
- [src/components/Toast.tsx](../src/components/Toast.tsx) — small toast queue for tx/error notifications

**Pages** (all under `src/app/(app)/`)
- [x] **D'.1** [/market](../src/app/(app)/market/page.tsx) — paginated intent grid (`useIntents`), category chips, links to detail
- [x] **D'.2** [/intent/[id]](../src/app/(app)/intent/[id]/page.tsx) — full detail view, milestone trajectory, sticky fund card with quick-amount buttons; `useFund` runs the USDC `approve` + `escrow.deposit` end-to-end
- [x] **D'.3** [/scientist](../src/app/(app)/scientist/page.tsx) — owned intents, per-milestone "Upload proof" + "Run AI verifier → claim" buttons (`useSubmitProof`, `useClaim`)
- [x] **D'.4** [/portfolio](../src/app/(app)/portfolio/page.tsx) — patron activity feed from `/api/activity` with BaseScan tx links
- [x] **D'.5** [/create](../src/app/(app)/create/page.tsx) — 3-milestone publish form; backend AI gatekeeper scores on POST and either publishes or rejects

**Legacy URLs / static landings**
- [x] [next.config.js](../next.config.js) redirects `.html` → clean URLs (`market.html` → `/market`, etc.)
- [x] [src/middleware.ts](../src/middleware.ts) rewrites `/intent-detail.html?id=X` → `/intent/X` (query-into-path conversion that `redirects()` can't do)
- [x] `/` still redirects to `/index.html` so the existing Halftone Bust landing survives untouched. Landing/leaderboard/onboarding pages remain static in `/public` and are linked from the new `<Nav>` via legacy paths.
- [x] Legacy [public/base-integration.js](../public/base-integration.js) + [public/solana-integration.js](../public/solana-integration.js) deleted; all `<script>` references stripped from the static HTML.

**Verification**
- `npx tsc --noEmit` ✅ clean
- `npx next build` ✅ 18 routes built (5 React pages + 12 API routes + middleware), no errors. Run on this machine 2026-05-27.
- Functional verification of the full money flow still requires (a) deployed `AuraSciEscrow` + `NEXT_PUBLIC_ESCROW_ADDRESS` set, (b) running Postgres + `npm run db:migrate && npm run db:seed`, (c) `npm run dev` + `npm run indexer` in another terminal, (d) browser session with MetaMask on Base Sepolia and devnet USDC.

> **Approach change:** the original D1 called for wagmi + RainbowKit. The existing UI is a static HTML bundle under [public/](../public/) loaded via `<script>` tags (the prior Solana integration was [public/solana-integration.js](../public/solana-integration.js) — vanilla JS, ethers/web3 from a CDN). A full React rewrite is out of scope for this PR, so D1 was reframed as **vanilla JS + ethers v6 (UMD from jsDelivr) + `window.ethereum`**. Same pattern, EVM stack instead of Solana stack.

- [x] **D1.** [public/base-integration.js](../public/base-integration.js) — vanilla integration replacing `solana-integration.js`. Loads ethers UMD on demand, drives MetaMask / Coinbase / any EIP-1193 wallet, manages chain switch (Base Sepolia by default, configurable). Exposes `window.AuraBase = { connect, disconnect, deposit, claim, address, config }`.
- [x] **D1a.** [src/app/api/config/route.ts](../src/app/api/config/route.ts) — public `GET /api/config` returns `{ chainId, usdcAddress, escrowAddress, explorerBase }` so the static bundle doesn't need hard-coded addresses; `base-integration.js` calls it on boot.
- [x] **D2.** Patched the 8 HTML pages that previously loaded `solana-integration.js` ([create-intent](../public/create-intent.html), [dashboard-patron](../public/dashboard-patron.html), [dashboard-scientist](../public/dashboard-scientist.html), [index](../public/index.html), [intent-detail](../public/intent-detail.html), [leaderboard](../public/leaderboard.html), [market](../public/market.html), [onboarding-scientist](../public/onboarding-scientist.html)) → all now load `base-integration.js`. `auth-stub.js` is intentionally kept (the modal's CSS + DOM are reused; we hijack only the "Connect wallet" option inside it). The legacy `public/solana-integration.js` file is retained but unreferenced; deletion deferred to Phase E.
- [x] **D3.** Fund / Patronize flow:
  - Auth-stub's `.fund-cta` modal capture is bypassed by my own capture-phase listener (registered earlier than auth-stub's; sees `data-aura-intent-id` on the page).
  - If no wallet connected → triggers `connectWallet()` (which runs SIWE login against `/api/auth/siwe/*` and persists session cookie).
  - Reads the USDC amount from the existing `.fund-input input`.
  - `USDC.approve(escrow, amount)` if allowance is insufficient → `escrow.deposit(intentId, amount)`.
  - Toasts the tx and links it to BaseScan. Indexer worker mirrors `Deposited` event into the DB.
- [x] **D4.** Scientist proof-upload flow:
  - `dashboard-scientist.html` now gets an injected "Your intents" list (from `/api/intents?scientist=<wallet>`).
  - Each milestone in `in_progress` shows an "Upload proof" button → opens file picker → multipart POST to `/api/intents/:id/milestones/:idx/submit-proof` (computes SHA-256 server-side, pins to IPFS via Pinata, advances milestone to `proof_submitted`).
  - Each milestone in `proof_submitted` shows "Run AI verifier → claim" → calls `/api/ai/verifier` (gets EIP-712 release signature) → calls `escrow.release(...)` on-chain. Indexer flips the milestone to `released`.
- [x] **D5.** Market + dashboards now pull from the backend:
  - `market.html` — injected "Live intents · backend" grid above the existing hardcoded mock cards (renders from `/api/intents`). Each card links to `intent-detail.html?id=<intentId>`.
  - `intent-detail.html` — when called with `?id=<intentId>`, the page's title, funding stamp, raised amount, and goal are patched in from `/api/intents/:id`. Body gets `data-aura-intent-id` so the Fund button targets the right escrow slot.
  - `dashboard-patron.html` — injected "Your activity" feed from `/api/activity?actor=<wallet>` with on-chain tx links.
  - ⚠ **Partial:** the *hardcoded* mock content elsewhere on these pages (sample milestone trajectories, design-mock charts, etc.) is **kept side-by-side** with the real data. Fully removing the mock layouts requires per-page rewrites that I deferred — it's a polish task, not a correctness one. The money flow + scientist workflow round-trip through the real stack.

**Verification:** `npx tsc --noEmit` clean. Functional verification of the on-chain flow requires (a) deployed `AuraSciEscrow` on Base Sepolia, (b) `NEXT_PUBLIC_ESCROW_ADDRESS` set in `.env.local`, (c) running Postgres + `npm run db:migrate && npm run db:seed`, (d) `npm run dev` + `npm run indexer`. The doc-reader can then open `http://localhost:3000/market.html`, click an intent, and Fund it with Base Sepolia USDC.

### Phase E — Cleanup

- [x] **E1.** Deleted `programs/aurasci/` (Anchor program source — replaced by `contracts/`)
- [x] **E2.** Deleted `Anchor.toml`
- [x] **E1b.** Deleted `src/solana/` (Solana React hooks + lib — replaced by `src/client/hooks.ts` + wagmi)
- [x] **E1c.** Deleted `src/app/api/ai-verifier/route.ts` (old Solana AI verifier — replaced by `src/app/api/ai/verifier/route.ts`)
- [x] **E1d.** Deleted `scripts/seed-devnet.ts` (old Solana seed — replaced by `prisma/seed.ts`)
- [x] **E1e.** Deleted `public/base-integration.js` + `public/solana-integration.js`
- [ ] **E3.** Update root `README.md` to reflect Base-on-EVM architecture *(pending)*
- [ ] **E4.** Update `docs/ARCHITECTURE.md` or supersede it *(pending)*

---

### Phase F — Backend extraction (frontend on Vercel, backend on self-hosted server)

> **Why this exists:** Phase C kept the backend co-located inside the Next.js app (`src/app/api/**`). The product owner doesn't want Vercel running the backend — they have their own server with a domain. We split the API out into a standalone Hono workspace at [backend/](../backend/) and switched cross-origin session from iron-session cookies to JWT bearer tokens.

**Backend workspace** at [backend/](../backend/) — its own `package.json` / `tsconfig.json` / `.env`:

- [x] **F1.** [backend/src/server.ts](../backend/src/server.ts) — Hono app, CORS via `CORS_ORIGIN`, central error handler, mounted under `/api/*`. Runs `@hono/node-server` on `PORT` (default 8787).
- [x] **F2.** Shared libs at [backend/src/lib/](../backend/src/lib/):
  - `env.ts` — central env parsing (throws on missing required vars)
  - `db.ts` — Prisma singleton
  - `chain.ts` — viem clients (driven by `CHAIN_ID`, not `NEXT_PUBLIC_*`)
  - `escrow-abi.ts` / `eip712.ts` — same as before, paths fixed for NodeNext modules
  - `ai.ts` / `ipfs.ts` — same logic, switched to `node:crypto`
  - **`auth.ts` (new)** — JWT issue/verify via `jose`, plus `requireAuth` / `optionalAuth` Hono middleware. Replaces the old iron-session module.
  - `http.ts` — Hono-flavored `ok` / `fail` / `parseJson` / BigInt-safe `serialize`
- [x] **F3.** Routes at [backend/src/routes/](../backend/src/routes/) — direct ports of the old `src/app/api/**` routes:
  - `config.ts`, `auth.ts` (SIWE → JWT), `intents.ts`, `proofs.ts`, `ai.ts`, `scientists.ts`, `activity.ts`, `ipfs.ts`
- [x] **F4.** Indexer at [backend/src/indexer.ts](../backend/src/indexer.ts) — moved from `scripts/`, imports adjusted for new locations and ENV.
- [x] **F5.** [backend/prisma/](../backend/prisma/) — schema + seed moved here; migrations will be created with `npm run db:migrate:dev` after pointing at a real Postgres.

**Frontend changes** (in the existing Next workspace):

- [x] **F6.** Deleted `src/app/api/` and `src/middleware.ts` — no more API routes in the Next bundle.
- [x] **F7.** [src/client/api.ts](../src/client/api.ts) rewired: all requests go to `process.env.NEXT_PUBLIC_API_BASE_URL`, JWT pulled from `localStorage` and sent as `Authorization: Bearer …`. `auth.set / auth.clear` helpers added; 401 auto-clears the token.
- [x] **F8.** [src/client/hooks.ts](../src/client/hooks.ts) updated: `useSiweLogin` now passes the nonce through to `verify`; `useAutoSiwe` clears the JWT on wallet disconnect.
- [x] **F9.** Root `package.json` pruned: removed `prisma`, `@prisma/client`, `iron-session`, `siwe`, `zod`, `tsx` and the `db:*` / `indexer` scripts. Saved 23 packages.
- [x] **F10.** Root [.env.example](../.env.example) now contains only `NEXT_PUBLIC_*` vars (for Vercel). Server-side secrets live in [backend/.env.example](../backend/.env.example).

**Verification**
- `cd backend && npx tsc --noEmit` ✅ clean
- `cd backend && npm run build` ✅ produces `dist/server.js` + `dist/indexer.js`
- `npx next build` from project root ✅ 5 React pages, no API routes (`next build` output shows no `ƒ /api/*` rows)
- See [docs/DEPLOYMENT.md](DEPLOYMENT.md) for end-to-end deploy steps (Vercel + Postgres + nginx + pm2).

---

### Phase G — `public/` cleanup + leaderboard/onboarding React port

> Removed every static HTML file in `public/` except the Halftone Bust landing (`index.html`). Each removed file either had a React replacement or was unused. The Halftone Bust landing stays because it's a self-extracting bundle (its loader runs `document.documentElement.replaceWith(...)`), incompatible with React reconciliation — porting it would require unpacking the manifest and rewriting visually, not in scope here.

Deleted:
- [x] **G1.** 5 zombie pages that already redirect to React routes: `market.html`, `dashboard-scientist.html`, `dashboard-patron.html`, `create-intent.html`, `intent-detail.html`
- [x] **G2.** 3 unused landing design variants: `landing.html`, `landing-v2-blob.html`, `landing-v2-terminal.html`
- [x] **G3.** 2 dev/utility pages: `shared-nav.html`, `all-pages.html`

React-ified:
- [x] **G4.** [src/app/(app)/leaderboard/page.tsx](../src/app/(app)/leaderboard/page.tsx) — full visual fidelity port of the patron leaderboard (KPI cards, filter chips, search, ranked table with progress bars, "your standing" card when wallet connected). Demo seed data inlined; swap for a real `/api/leaderboard` aggregator when the backend has one.
- [x] **G5.** [src/app/(app)/onboard/page.tsx](../src/app/(app)/onboard/page.tsx) — scientist registration form. Wallet IS identity (SIWE), so the old GitHub/ORCID OAuth-stub step is gone; one form posts to `PUT /api/scientists/:wallet` and the 2-step "submitted → council review" UI is preserved.

Wiring:
- [x] **G6.** Re-created [src/middleware.ts](../src/middleware.ts) — handles `intent-detail.html?id=X` → `/intent/X` for any external link that still points at the old URL.
- [x] **G7.** [src/components/Nav.tsx](../src/components/Nav.tsx) Leaderboard link: `/leaderboard.html` → `/leaderboard`.
- [x] **G8.** Deleted `public/leaderboard.html` + `public/onboarding-scientist.html` after the React versions shipped.

**Final state of `public/`:**
```
public/
├─ index.html          ← Halftone Bust landing (self-extracting bundle; stays)
├─ auth-stub.js        ← used by index.html
├─ coming-soon.js      ← used by index.html
├─ partners.js         ← used by index.html
├─ bust-theme.css      ← also imported by src/app/layout.tsx
├─ images/, models/, uploads/   ← assets
```

**Verification:** `npx next build` ✅ — 10 routes (5 original + `/leaderboard` + `/onboard` + `/_not-found` + `/` + `/intent/[id]`), middleware re-attached at 26.5 KB.

---

### Phase H — Faithful HTML→React restoration (pixel-close ports of the 6 originals)

> **Why:** Phase D' shipped a *simplified* React rewrite of each page (basic cards, no sidebar, no rich mock data). The product owner flagged this — the original `public/*.html` designs had hand-crafted visuals (rich intent cards, Season ranking sidebar, Live feed, 6-step milestone trajectory, Setu publish animation, 2-step OAuth wizard) that the simplified version threw away. Phase H recovers each old HTML from git history (`git show a6bd2374:public/*.html`) and **translates it faithfully** to React with `<style jsx global>` blocks — class names match, mock data is inlined, original CSS is preserved verbatim.

- [x] **H1.** `git show a6bd2374:public/*.html` recovered the 6 deleted files into `.recovered/`
- [x] **H2.** [/market](../src/app/(app)/market/page.tsx) — restored: hero + search + filter drawer (4 chip groups + score slider) + 3 richly-detailed cards (tags + Verified badge + funding progress + patrons count) + Open-slot placeholder + bottom Scientist CTA + **sidebar with Season ranking and Live feed**
- [x] **H3.** [/intent/[id]](../src/app/(app)/intent/[id]/page.tsx) — restored: ticker line + em-styled title + scientist row + tag pills + hypothesis + ev-links + backers strip + Resource asks · sticky Fund card + Aura heat card · **full 6-stage milestone trajectory** (M0 done / M1 active / M2-SSR locked, with vertical timeline)
- [x] **H4.** [/scientist](../src/app/(app)/scientist/page.tsx) — pending-review banner + profile card + info grid + bio box + Actions (Create intent gated until approved) + **[Dev] Mock admin approve** button
- [x] **H5.** [/portfolio](../src/app/(app)/portfolio/page.tsx) — 2 role tabs (As patron / As scientist) · Patron pane: 4 stats + funded holdings + Aura allocation · Scientist pane: empty state OR registered state (profile + Research Identity 4 cards + 3 metrics + published intents)
- [x] **H6.** [/create](../src/app/(app)/create/page.tsx) — **4-step wizard**: Blueprint → Milestones (3 ms-blocks + resource asks + auto-ticker preview) → Review (editable preview + attest) → **Setu publish animation** (pulse SETU core + 3-phase progress + 5-agent quorum vote + done banner)
- [x] **H7.** [/onboard](../src/app/(app)/onboard/page.tsx) — 2-step wizard: GitHub/ORCID OAuth-style connect → Lab profile form (name/email/affiliation/bio with word count) → Council-review status screen
- [x] **H8.** [Nav.tsx](../src/components/Nav.tsx) updated to match the original `.bnav` 4-link layout (Market · Governance(muted) · Leaderboard + Login on far right, Portfolio/Scientist hidden when logged out — surfaces in user dropdown)

**Verification:** `npx next build` ✅ — all 10 routes still build; `/intent/[id]` is the largest bundle (First Load JS dominated by wagmi).

---

### Phase I — Real wallet auth (SIWE) replaces the stubbed sign-in

> **Why:** Phase D' wired up a fake `<SignInModal/>` whose buttons just set a `localStorage.aurasci_auth=1` flag. Real product needs real auth. Sign-In-With-Ethereum (EIP-4361) keeps the stack wallet-native: the same key that funds and claims on-chain is the identity that signs in — no extra accounts, no third-party auth service.

**What changed**
- [x] **I1.** [src/wagmi/config.ts](../src/wagmi/config.ts) — `createConfig` with the `injected()` connector; only `ACTIVE_CHAIN` registered so reads/writes can't drift to the wrong network.
- [x] **I2.** [src/app/providers.tsx](../src/app/providers.tsx) — `WagmiProvider` → `QueryClientProvider` → `ToastProvider`.
- [x] **I3.** [src/components/SignInModal.tsx](../src/components/SignInModal.tsx) — single "Connect wallet & sign in" action: connect the injected wallet, fetch a one-time nonce from `/api/auth/nonce`, sign a SIWE message (viem `createSiweMessage`), exchange it at `/api/auth/siwe` for a session JWT.
- [x] **I4.** [src/client/auth.ts](../src/client/auth.ts) — JWT persisted in `localStorage.aurasci.jwt`, mirrored into a zustand store; `useAuth()` exposes `{ ready, authenticated }` and `jsonFetch` attaches the token as `Authorization: Bearer …` on every request.
- [x] **I5.** [src/client/sign-in-store.ts](../src/client/sign-in-store.ts) — tiny zustand store so any page (e.g. `/intent/[id]`'s Fund button) can open the same SignInModal that Nav owns.
- [x] **I6.** [backend/src/routes/auth.ts](../backend/src/routes/auth.ts) — `GET /nonce` (5-minute single-use nonces) + `POST /siwe` (verify signature + chainId, upsert the User row, issue the JWT); [backend/src/lib/auth.ts](../backend/src/lib/auth.ts) verifies the JWT on every authenticated route and re-reads the role from the DB.
- [x] **I7.** [src/client/hooks.ts](../src/client/hooks.ts) — `useEnsureWalletReady()` refuses to sign transactions from any address other than `/me.wallet`, so the on-chain `scientistWallet`/patron address can never drift out from under the contract.

### Phase J — Landing → React auth handoff

> **Problem:** `public/index.html` (the Halftone Bust self-extracting bundle) and the React app at `/market` are two separate auth systems. Without bridging them, a user could sign in on landing's stub modal but the React app wouldn't know, and vice versa.

- [x] **J1.** [public/auth-stub.js](../public/auth-stub.js) — replaced `openModal()` with `window.location.href = "/market?signin=open"`. This means every auth trigger on the landing (the Login button + the click-intercepted `.fund-cta` / Portfolio links) routes the user into the React app with a request to pop the sign-in modal.
- [x] **J2.** [/market](../src/app/(app)/market/page.tsx) — added a `<Suspense><SignInLauncher/></Suspense>` child that reads `?signin=open` from the URL via `useSearchParams`, calls `useSignInModal().open()`, then `router.replace()` to strip the query param. Wrapped in Suspense so /market still prerenders statically (Next 14 requirement).
- [x] **J3.** [src/components/Nav.tsx](../src/components/Nav.tsx) — adds a `useEffect` that mirrors auth state into the legacy localStorage keys (`aurasci_auth` / `aurasci_handle` / `aurasci_auth_method`) so the static landing's auth-stub renders the user pill (not the Login button) when a user is signed in via the React app. Logout clears those too.

**Result:** session crosses both directions seamlessly. The React app holds the truth (session JWT); both pages read it (React via `useAuth`, landing via the localStorage mirror).

---

### Phase K — Async AI scoring + leaderboard aggregator

> **Why:** Original `/api/intents` POST handler ran the OpenAI gatekeeper call inline before returning. For real LLM calls (5-30s) this blocks the response and burns Vercel function time. Moved to a queue.

- [x] **K1.** [backend/src/routes/intents.ts](../backend/src/routes/intents.ts) — `POST /api/intents` now creates the intent with `status: "ai_screening"`, enqueues an `AiJob(type: "gatekeeper")`, and returns **202 Accepted** immediately with `{ intent, job }`. The frontend polls the job id (or refetches the intent) to know when scoring is done.
- [x] **K2.** [backend/src/ai-worker.ts](../backend/src/ai-worker.ts) — **new long-running process** (third sibling alongside `server` and `indexer`). Polls Postgres for `AiJob` rows in `queued` state, runs gatekeeper or verifier scoring, on pass produces an EIP-712 release signature, writes results back. `pm2 start dist/ai-worker.js --name aurasci-ai`.
- [x] **K3.** [backend/src/routes/leaderboard.ts](../backend/src/routes/leaderboard.ts) — `GET /api/leaderboard` aggregates net committed USDC (`sum(amountUsdc) - sum(refundedAmount)`) per patron wallet, joined to Scientist (for display name + avatar) and Patronage rows (for `projects` count). Returns top 50 plus summary stats (total committed, active patron count, top-10 share in basis points).
- [x] **K4.** [/leaderboard page](../src/app/(app)/leaderboard/page.tsx) — fetches the live data; falls back to the seed dataset when the backend returns empty (so the page still demos the layout on a fresh deployment).
- [x] **K5.** [docs/DEPLOYMENT.md](DEPLOYMENT.md) §3.6 — updated to start all 3 processes (`aurasci-api`, `aurasci-indexer`, `aurasci-ai`) and explains their orthogonal roles + failure impact.

---

## 5. Reference

- USDC on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals)
- USDC on Base Sepolia (testnet): `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Hardhat docs: <https://hardhat.org/docs>
- viem book: <https://viem.sh/>
- Hono docs: <https://hono.dev/>
- EIP-712: <https://eips.ethereum.org/EIPS/eip-712>
- SIWE: <https://eips.ethereum.org/EIPS/eip-4361>
