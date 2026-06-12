# AuraSci — Deployment Guide

> Architecture: **frontend on Vercel**, **backend + Postgres + indexer on your own server**.
> Auth across origins is done with **JWT bearer tokens** (no cross-origin cookies).

```
┌──────────────────────────┐         ┌──────────────────────────┐
│ Browser                  │         │ Base chain               │
└────┬────────┬────────────┘         └──────────┬───────────────┘
     │ HTTPS  │ HTTPS                            │
     │  ▼     │   ▼                              │
     │ Vercel │  Your server                     │
     │ (front)│  ┌────────────────────────────┐  │
     │        │  │ Hono API     (port 8787)   │◀─┘
     │        ╰─▶│ Indexer worker             │
     │           │ Postgres                   │
     │           └────────────────────────────┘
     └── reads "NEXT_PUBLIC_API_BASE_URL" → calls your server
```

---

## 1. One-time prep

### 1.1 Deploy the escrow contract

From a local dev box (not the production server — keep the deployer key off the prod box):

```bash
cd contracts
cp .env.example .env
# Fill in:
#   BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
#   DEPLOYER_PRIVATE_KEY=0x...   (funded with Base Sepolia ETH)
#   USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
#   SIGNER_ADDRESS=0x...          (the BACKEND signer's pubkey — see 1.2)
#   BASESCAN_API_KEY=...          (optional)

npm install
npm run compile
npm run test          # 17 tests should pass
npm run deploy:sepolia
```

Note the printed `AuraSciEscrow deployed: 0x...` — that goes into both env files later.

### 1.2 Generate the backend signer key

This is the keypair the **backend** uses to sign EIP-712 release/refund messages. Its pubkey is baked immutably into the contract; if you leak the private key, the attacker can drain every intent.

```bash
node -e "const {generatePrivateKey, privateKeyToAccount} = require('viem/accounts'); const pk = generatePrivateKey(); console.log('PRIVATE_KEY:', pk); console.log('PUBKEY:    ', privateKeyToAccount(pk).address);"
```

Use the printed **PUBKEY** as `SIGNER_ADDRESS` when deploying the contract (step 1.1). Keep the **PRIVATE_KEY** in a password manager — it goes into `backend/.env` as `SIGNER_PRIVATE_KEY` (step 3.4).

### 1.3 Generate a JWT secret

```bash
openssl rand -hex 64
```

64 random hex chars. Becomes `JWT_SECRET` in `backend/.env`. Anyone with this can forge logins, so treat it like a database root password.

---

## 2. Frontend — Vercel

### 2.1 Push the repo to GitHub

The frontend Next.js project lives at the repo root. `backend/` and `contracts/` are sibling workspaces that Vercel will *not* build because they have their own `package.json` and aren't referenced from any Next code.

### 2.2 Connect the repo to Vercel

- New Project → Import your GitHub repo
- **Root Directory**: leave as the repo root (`.`)
- **Framework Preset**: Next.js (auto-detected)
- **Build Command**: leave default (`next build`)
- **Output Directory**: leave default

### 2.3 Environment variables (Vercel dashboard → Settings → Environment Variables)

| Name | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `https://api.yourdomain.com` | Points at your backend (set up in §3) |
| `NEXT_PUBLIC_CHAIN_ID` | `84532` (sepolia) or `8453` (mainnet) | Must match the contract you deployed |
| `NEXT_PUBLIC_USDC_ADDRESS` | base sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | |
| `NEXT_PUBLIC_ESCROW_ADDRESS` | output of `npm run deploy:sepolia` in §1.1 | |
| `NEXT_PUBLIC_BASE_RPC_URL` | optional — your Alchemy/QuickNode URL | falls back to `https://mainnet.base.org` |
| `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` | optional | falls back to `https://sepolia.base.org` |
| `NEXT_PUBLIC_WALLETCONNECT_ID` | project id from <https://cloud.reown.com> | `demo` works but logs warnings |

Set these for **Production**, **Preview**, and **Development** as appropriate. The `NEXT_PUBLIC_*` prefix means every value here is shipped to the browser bundle — there is nothing secret here.

### 2.4 Deploy

Vercel auto-deploys on push to `main`. First deploy: ~2 min. Check the build log; it should land at `https://<your-project>.vercel.app/market`.

---

## 3. Backend — your server

Assumes a Linux VPS / Mac mini / whatever, with:
- Public IP + a domain you control (e.g. `api.yourdomain.com` pointed at it via A record)
- Node.js 20+
- Postgres 14+ running locally (or a managed Postgres reachable from this server)
- `git`, `nginx`, `pm2` (or `systemd`)

### 3.1 Install dependencies on the server

```bash
# Node 20 via nvm (one-time)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 20
nvm use 20

sudo apt install -y postgresql nginx
sudo npm install -g pm2
```

### 3.2 Create the Postgres database

```bash
sudo -u postgres psql
```
```sql
CREATE USER aurasci WITH ENCRYPTED PASSWORD 'CHANGE_THIS_TO_A_STRONG_PASSWORD';
CREATE DATABASE aurasci OWNER aurasci;
GRANT ALL PRIVILEGES ON DATABASE aurasci TO aurasci;
\q
```

### 3.3 Clone the repo and build the backend

```bash
git clone https://github.com/your-org/aurasci.git
cd aurasci/backend
npm install
npm run db:generate
```

### 3.4 Create `backend/.env`

```bash
cp .env.example .env
nano .env
```

Fill in:

| Key | Where it comes from |
|---|---|
| `PORT` | `8787` is fine (nginx proxies to it) |
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | `https://<your-project>.vercel.app,https://yourdomain.com` (comma-separated) |
| `DATABASE_URL` | `postgresql://aurasci:STRONG_PASSWORD@localhost:5432/aurasci?schema=public` |
| `JWT_SECRET` | `openssl rand -hex 64` output from §1.3 |
| `JWT_TTL_SECONDS` | `604800` (7 days) |
| `CHAIN_ID` | `84532` (sepolia) or `8453` |
| `BASE_RPC_URL` / `BASE_SEPOLIA_RPC_URL` | your Alchemy/QuickNode RPC, or the public defaults |
| `ESCROW_ADDRESS` | from §1.1 |
| `USDC_ADDRESS` | base sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| `SIGNER_PRIVATE_KEY` | from §1.2 — **this is the highest-value secret** |
| `PINATA_JWT` | from your Pinata account (or leave blank for dev-mode fake CIDs) |
| `OPENAI_API_KEY` | from your OpenAI account (or leave blank for heuristic scoring) |

### 3.5 Run migrations + seed

```bash
npm run db:migrate          # creates the schema in Postgres
npm run db:seed             # inserts the 3 hero intents
```

### 3.6 Start the API + indexer + AI worker with pm2

```bash
npm run build                                     # produces dist/{server,indexer,ai-worker}.js
pm2 start dist/server.js     --name aurasci-api
pm2 start dist/indexer.js    --name aurasci-indexer
pm2 start dist/ai-worker.js  --name aurasci-ai
pm2 save
pm2 startup                                       # follow the printed instructions
```

The three processes have orthogonal jobs and should run in parallel:

| process | reads | writes | failure impact |
|---|---|---|---|
| `aurasci-api` | HTTP requests | Postgres (intents, sessions, AiJob queue) | site down |
| `aurasci-indexer` | Base chain events | Patronage / Release / RefundRecord / ActivityLog / IndexerCheckpoint | new on-chain activity stops appearing in the UI |
| `aurasci-ai` | `AiJob` rows in `queued` state | scoring results + EIP-712 release signatures back onto AiJob / Milestone / SignedNonce | intents stuck in `ai_screening`, milestone claims hang on "Verifying…" |

### 3.7 nginx reverse proxy + TLS

`/etc/nginx/sites-available/api.yourdomain.com`:

```nginx
server {
  listen 80;
  server_name api.yourdomain.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name api.yourdomain.com;

  ssl_certificate     /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

  # Generous body limit for milestone-proof uploads (50 MB cap is enforced
  # in the route too; nginx must allow at least that much).
  client_max_body_size 64m;

  location / {
    proxy_pass         http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/api.yourdomain.com /etc/nginx/sites-enabled/
sudo certbot --nginx -d api.yourdomain.com
sudo nginx -t && sudo systemctl reload nginx
```

### 3.8 Smoke test

```bash
curl https://api.yourdomain.com/health
# → {"ok":true,"ts":1716...}
curl https://api.yourdomain.com/api/config
# → {"data":{"chainId":84532,"chainName":"Base Sepolia",...}}
```

---

## 4. Wiring frontend ↔ backend

The Vercel deployment is already pointing at the backend via `NEXT_PUBLIC_API_BASE_URL` (set in §2.3). Re-deploy the Vercel project (push a no-op commit, or click "Redeploy") so it picks up that env var.

Now visit `https://your-vercel-domain/market`:
- The page calls `${NEXT_PUBLIC_API_BASE_URL}/api/intents` directly — should show the 3 seeded intents.
- Click an intent → `/intent/<id>` hydrates from `/api/intents/:id`.
- Click "Connect" → MetaMask → SIWE message → backend issues a JWT → cached in `localStorage` (`aurasci.jwt`) → all subsequent calls send `Authorization: Bearer <jwt>`.

If you see CORS errors in the browser console, double-check `CORS_ORIGIN` in `backend/.env` matches the Vercel domain *exactly* (no trailing slash).

---

## 5. Operating the indexer

The indexer is a long-running process that polls Base for `Deposited / Released / Refunded` events and mirrors them into Postgres. Without it, `/api/activity` returns nothing and patronage progress on intents never updates.

```bash
pm2 logs aurasci-indexer
pm2 restart aurasci-indexer       # safe — resumes from IndexerCheckpoint
pm2 stop aurasci-indexer
```

If the contract is redeployed at a different address, update `ESCROW_ADDRESS` in `backend/.env`, **delete the checkpoint row** (`DELETE FROM "IndexerCheckpoint";` in psql), and restart the indexer so it starts from the new contract's deploy block.

---

## 5b. Operating the AI worker

The `aurasci-ai` process drains the `AiJob` table — gatekeeper jobs (intent screening) and verifier jobs (milestone proof scoring + EIP-712 release signing). HTTP handlers enqueue, the worker dequeues. Without it, intents stay in `ai_screening` forever and milestone claims time out.

```bash
pm2 logs aurasci-ai
pm2 restart aurasci-ai            # safe — running jobs older than 5 min are reclaimed
pm2 stop aurasci-ai
```

Tunable via env on the worker (defaults shown):

| var | default | purpose |
|---|---|---|
| `AI_WORKER_TICK_MS` | `2000` | idle poll interval |
| `AI_WORKER_STALE_MS` | `300000` (5 min) | `running` jobs older than this get reclaimed back to `queued` on next tick |
| `AI_WORKER_MAX_ATTEMPTS` | `3` | per-job retry cap; failures after this stay in `failed` terminal state |

The worker is **single-instance**. Don't run two `aurasci-ai` processes against the same Postgres — they will race on `claimOne()`.

To force a re-score (after fixing a bad prompt, swapping models, or because OPENAI_API_KEY was missing the first time):

```sql
-- in psql
UPDATE "AiJob" SET status='queued', attempts=0, error=NULL, finishedAt=NULL
WHERE status='failed' AND type='gatekeeper';
```

The worker will pick them up on its next tick.

---

## 6. Updating

```bash
# On the server
cd aurasci
git pull
cd backend
npm install
npm run db:migrate     # only if prisma/schema.prisma changed
npm run build
pm2 restart aurasci-api aurasci-indexer

# On Vercel: pushes to main auto-deploy.
```

---

## 7. Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Browser: `CORS policy: No 'Access-Control-Allow-Origin'` | Vercel domain not in `CORS_ORIGIN` | Edit `backend/.env`, restart `aurasci-api` |
| SIWE login fails with `401: siwe verification failed: invalidSignature` | wallet on wrong chain | switch network in MetaMask, retry |
| Fund button reverts with `Insufficient escrow allowance` | USDC approval didn't go through | retry — wagmi handles approve in the same flow |
| Indexer keeps printing "tip <= from" | nothing happening on-chain — normal idle | |
| Indexer crashloops with `Cannot find module './lib/db.js'` | ran `tsx src/indexer.ts` instead of `node dist/indexer.js`, or vice versa | match the script to the env (dev uses tsx, prod uses node + built dist) |
| Refund signed but `release: replayed` | nonce reused — derive a new salt | indexer auto-handles; verifier route picks a deterministic nonce |
| Intent stuck in `ai_screening` for minutes | `aurasci-ai` not running, or failing | `pm2 status aurasci-ai` → `pm2 logs aurasci-ai`; check `OPENAI_API_KEY` if you set one |
| `AiJob` rows piling up with `status='running'` and no progress | worker crashed mid-job | next tick auto-reclaims jobs `running` for > `AI_WORKER_STALE_MS`; or `pm2 restart aurasci-ai` |
