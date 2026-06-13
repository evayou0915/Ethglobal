# AuraSci · Canton private rail

The Base/Solidity escrow is fully public — every deposit amount and patron
address is readable by anyone. This directory adds a **second, private
settlement rail** on [Canton Network](https://www.canton.network/): each
`Patronage` contract is distributed **only to the participant nodes of its
stakeholders** (patron · platform · scientist). Privacy is enforced by the
ledger itself, not by the UI.

```
            ┌── public rail ──►  AuraSciEscrow.sol on Base (USDC)
  patron ───┤
            └── private rail ─►  Patronage template on Canton (USDCx*)
```

\* Hackathon scope: amounts are mock-USDCx Decimal fields. Production swaps
them for [CIP-0056 token-standard](https://docs.digitalasset.com/integrate/devnet/index.html)
holdings — Circle's USDCx is live on Canton.

## Why this maps so well

| AuraSci concept (Base) | Canton equivalent |
| --- | --- |
| `Deposited` public event | `Patronage` contract, stakeholder-only distribution |
| EIP-712 release signature from backend signer key | `ReleaseMilestone` choice requiring the **Verifier party's** authority |
| Refund quote signed by backend | `Withdraw` choice with patron + operator dual control |
| Indexer scanning event logs | (demo) direct ACS queries; (prod) PQS / update stream |

## Layout

- `daml/AuraSci.daml` — `ResearchIntent` / `Patronage` / `Payout` templates
- `daml/AuraSci/Test.daml` — end-to-end Daml Script incl. **privacy assertions**
  (patron B's node provably cannot see patron A's patronage)
- `daml/AuraSci/Setup.daml` — sandbox bootstrap (allocates Operator + Verifier)

## Run it

```bash
# 1. Install the Daml SDK (2.10.x LTS)  →  https://docs.daml.com/getting-started/installation.html
# 2. Tests (privacy assertions + dual-control release + negative paths)
cd canton && daml test

# 3. Local Canton sandbox + JSON Ledger API on :7575
daml start

# 4. Point the backend at it and restart
echo 'CANTON_JSON_API_URL=http://localhost:7575' >> ../backend/.env
```

With the env var set, the backend exposes:

- `POST /api/canton/fund` — fund privately (custodial party per SIWE wallet)
- `GET  /api/canton/intents/:id` — aggregate `$total · N private patrons`
  (+ the caller's own rows, which only they can see)
- `POST /api/canton/release` — operator + verifier release, gated on the
  same AI-verifier score as the Base rail

and the intent page grows a **“🔒 Fund privately via Canton”** toggle.

## Custody model (and the path off it)

Demo scope: all parties live on our own participant node and the backend
signs on their behalf — the standard institutional-custody shape on Canton.
Production path: external parties via the
[Canton Wallet SDK](https://www.npmjs.com/package/@canton-network/wallet-sdk),
DevNet validator + self-featured app (Canton Coin app rewards), then
TestNet/MainNet via a sponsor. No Daml template changes required.
