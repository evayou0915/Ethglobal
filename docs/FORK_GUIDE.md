# Fork & Deploy Guide — AuraSci on Solana

This guide walks you through forking the original frontend, dropping in
the Solana integration layer from this repo, and deploying everything to
devnet for the Colosseum submission.

> ⚠️ I (Claude) cannot fork to your GitHub on your behalf. The steps below
> are what you (or your dev team) run locally. Each command is annotated so
> a human reviewer can audit it.

---

## 0. Prereqs

```bash
# Node
brew install node             # or use nvm
node --version                # ≥ 20

# Solana
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
solana --version              # ≥ 1.18
solana config set --url devnet
solana-keygen new -o ~/.config/solana/id.json   # save BIP-39 phrase!
solana airdrop 2

# Anchor
cargo install --git https://github.com/coral-xyz/anchor --tag v0.30.1 anchor-cli --locked
anchor --version              # 0.30.1
```

---

## 1. Fork the original repo into 1vayou

Go to <https://github.com/zizizizazaza/aurasci> while signed in as
`1vayou`, click **Fork** in the top right, and uncheck *"Copy the main
branch only"* if you want all branches. The forked repo will live at
<https://github.com/1vayou/aurasci>.

```bash
cd ~/code
git clone git@github.com:1vayou/aurasci.git
cd aurasci

# Add the upstream remote so you can pull future updates from the original team
git remote add upstream https://github.com/zizizizazaza/aurasci.git
git fetch upstream
```

Create a feature branch for the Solana work so the diff is reviewable:

```bash
git checkout -b feature/solana-integration
```

---

## 2. Drop in the Solana integration layer

Unzip the bundle Claude produced (the `aurasci-solana/` folder) and copy
the new files into your fork. The structure mirrors the existing repo, so
copying is straightforward:

```bash
# From the unzipped aurasci-solana folder:
cp -r programs                ~/code/aurasci/
cp -r scripts                 ~/code/aurasci/
cp -r docs                    ~/code/aurasci/
cp -r src/solana              ~/code/aurasci/src/
cp -r src/app/api             ~/code/aurasci/src/app/

cp Anchor.toml                ~/code/aurasci/
cp .env.local.example         ~/code/aurasci/
cp README.md                  ~/code/aurasci/   # overwrites; keep a backup if you want
```

Then merge the new dependencies into `package.json`. The simplest path is
to overwrite it with the version in this bundle (it preserves all original
deps and only adds Solana ones), then run:

```bash
cp package.json ~/code/aurasci/
cd ~/code/aurasci
rm -rf node_modules package-lock.json
npm install
```

### Patch `src/app/layout.tsx`

Open the file and follow the 3 steps in `src/app/layout.tsx.patch`:

1. Add `import { AuraSciWalletProvider } from '@/solana/components/WalletProvider'`
2. Wrap the existing `{children}` inside `<AuraSciWalletProvider>…</AuraSciWalletProvider>`
3. Verify `tsconfig.json` has the `@/*` path alias

### Wire up the new components

Two existing pages need a small edit:

**`src/app/intent/[id]/page.tsx`** — replace the mock fund button with the
real Solana one:

```tsx
import { PatronizeButton } from '@/solana/components/PatronizeButton';

// …inside the Intent detail JSX:
<PatronizeButton
  scientist={intent.scientistWallet}      // populated from on-chain or mock
  intentId={intent.intentId.toString()}
  amountUsdc={250}
  onSuccess={(sig) => console.log('patronized', sig)}
/>
```

**Top nav (e.g. `src/components/Nav.tsx`)** — drop in the wallet button:

```tsx
import { WalletButton } from '@/solana/components/WalletButton';

// …inside the nav, somewhere on the right:
<WalletButton />
```

---

## 3. Deploy the Anchor program to devnet

```bash
cd ~/code/aurasci
npm run anchor:build
anchor deploy --provider.cluster devnet
```

The output prints a Program ID — copy it into THREE places:

| File | Where |
| --- | --- |
| `Anchor.toml` | `[programs.devnet] aurasci = "<ID>"` |
| `programs/aurasci/src/lib.rs` | `declare_id!("<ID>");` |
| `.env.local` | `NEXT_PUBLIC_AURASCI_PROGRAM_ID=<ID>` |

Rebuild after editing `declare_id!`:

```bash
anchor build
anchor deploy --provider.cluster devnet
```

Generate the AI Verifier keypair and copy its **public key** into
`programs/aurasci/src/lib.rs` `AI_VERIFIER_PUBKEY`, and the **private key**
(base58) into `.env.local` as `AI_VERIFIER_SECRET`:

```bash
solana-keygen new -o ai-verifier.json
solana-keygen pubkey ai-verifier.json
# convert keypair file to base58 secret for .env.local
node -e "const k = require('./ai-verifier.json'); const b58 = require('bs58'); console.log(b58.encode(Uint8Array.from(k)))"
```

> ⚠️ Never commit `ai-verifier.json` or the `AI_VERIFIER_SECRET`. Add them
> to `.gitignore` and store the prod copy in Vercel Environment Variables.

Deploy once more so the `AI_VERIFIER_PUBKEY` constraint is baked in:

```bash
anchor build
anchor deploy --provider.cluster devnet
npm run seed:devnet
```

---

## 4. Run locally + push

```bash
npm run dev
# → http://localhost:3000
```

Smoke test:

1. Connect Phantom (devnet mode).
2. Get USDC-Dev: <https://spl-token-faucet.com/?token-name=USDC-Dev>.
3. Patronize an intent. Watch the explorer link in the activity feed.
4. Submit proof + trigger the AI verifier from `/dashboard/scientist`.

Then push:

```bash
git add .
git commit -m "feat: integrate Solana — Anchor program, USDC escrow, AI Verifier signer, NFT receipts"
git push -u origin feature/solana-integration
```

Open a PR from `feature/solana-integration` into your fork's `main`,
review your own diff, and merge. Vercel will redeploy automatically if
you've connected the fork.

---

## 5. Submit to Colosseum

1. Sign up at <https://arena.colosseum.org/signup> (use the same email as
   your GitHub if possible).
2. Choose the active hackathon (Solana Frontier Hackathon at the time of
   writing).
3. In the project form, paste:
   - **Repo URL:** `https://github.com/1vayou/aurasciSL`
   - **Live demo:** `https://aurasci-sl.vercel.app`
   - **Pitch:** copy the One-liner + Problem + Solution from
     `docs/HACKATHON_SUBMISSION.md`.
   - **Solana program ID:** `2J766XS6NbvebT1sdsMgLtLPf5cL1dmHr5ko5LwJ2SiE`
     ([devnet explorer](https://explorer.solana.com/address/2J766XS6NbvebT1sdsMgLtLPf5cL1dmHr5ko5LwJ2SiE?cluster=devnet))
   - **Sample tx links:** any patronage tx from the live demo's
     Solana Explorer link.
4. Upload a 2–3 minute demo video walking through the 5-step demo script
   in `README.md`.

---

## 6. Run the Colosseum skills (optional)

The user mentioned `npx skills add ColosseumOrg/colosseum-resources`.
After your fork is in place you can run that locally to pull in their
templates:

```bash
cd ~/code/aurasci
npx skills add ColosseumOrg/colosseum-resources
```

If the package doesn't exist on npm yet (it may be a placeholder), check
the Colosseum Discord / docs for the actual install command. Either way,
this step is optional — your repo already follows the Colosseum
expectations (Anchor program, devnet deploy, demo video, README).

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Error: Account does not exist` on first patronize | Patron's USDC ATA hasn't been created yet — `usePatronage` should auto-create it; double-check `ensureUsdcAtaIx` ran |
| `seeds constraint violated` | The `intent_id` you're passing on the FE doesn't match what was used in `publish_intent` — they must be identical u64 values |
| `Transaction signature verification failure` | The AI verifier route is signing with a keypair whose pubkey doesn't match `AI_VERIFIER_PUBKEY` in `lib.rs`. Rebuild + redeploy after editing the constant |
| `Pinata HTTP 401` | `PINATA_JWT` is wrong or missing in `.env.local` |
| Wallet adapter error: `Bad Request` | Devnet RPC rate limit — get a free Helius / Triton / QuickNode key and put it in `NEXT_PUBLIC_SOLANA_RPC_URL` |
