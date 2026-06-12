# AuraSci Architecture

## System diagram

```
                          ┌────────────────────────┐
                          │      Patrons / DAOs    │
                          └────────────┬───────────┘
                                       │ USDC
                                       ▼
┌─────────┐   sign      ┌──────────────────────────────┐    sign    ┌──────────────┐
│ Scientist├────────────▶│   AuraSci Anchor Program     │◀───────────┤ AI Verifier  │
│ Phantom │  publish_   │   (declare_id! …)            │  verify_   │  (server     │
└─────────┘  intent     │                              │  milestone │   keypair)   │
                        │  ┌────────────────────────┐  │            └──────┬───────┘
                        │  │   IntentAsset PDA      │  │                   │
                        │  │   Milestone PDA × 3    │  │                   │
                        │  │   Escrow Vault (USDC)  │  │                   │
                        │  │   Patronage PDA × N    │  │                   │
                        │  └────────────────────────┘  │                   │
                        └──────────────┬───────────────┘                   │
                                       │ release tranche                   │
                                       ▼                                   │
                          ┌────────────────────────┐                       │
                          │  Scientist USDC ATA    │                       │
                          └────────────────────────┘                       │
                                                                           │
        ┌──────────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────┐         ┌──────────────────────────┐
│  IPFS / Arweave  (proof  │◀────────│  Next.js /api/ipfs-upload │
│  PDF / dataset / commit) │         └──────────────────────────┘
└──────────────────────────┘
```

## On-chain account hierarchy

```
Scientist  (1 per wallet)
  └─ IntentAsset  (N per scientist, indexed by intent_id)
       ├─ Milestone   (exactly 3, indexed 0..2)
       ├─ Patronage   (M per intent, one per patron wallet)
       └─ Escrow Vault (1 per intent, USDC ATA owned by program PDA)
```

PDA seeds — see [`src/solana/lib/pdas.ts`](../src/solana/lib/pdas.ts):

| PDA | Seeds |
| --- | --- |
| Scientist | `["scientist", scientist_wallet]` |
| IntentAsset | `["intent", scientist_wallet, intent_id_u64_le]` |
| Milestone | `["milestone", intent_pda, milestone_index_u8]` |
| Patronage | `["patronage", intent_pda, patron_wallet]` |
| Escrow Vault | `["escrow", intent_pda]` |

## Why three milestones, not N

Three is the minimum that gives the contract real proof-of-progress
information without making the UX a budgeting form. It also matches
how grant agencies think (M1 = setup, M2 = data, M3 = result).

## State machines

### IntentStatus
```
Draft → AiScreening → Published → Funded → Completed
                            │
                            └─ Rejected (refund path open)
```

### MilestoneStatus
```
Locked → InProgress → ProofSubmitted → AiVerified → Released
                                    │
                                    └─ Rejected
```

`publish_intent` initialises milestone 0 to `InProgress` and 1, 2 to
`Locked`. `verify_milestone` advances the next one to `InProgress` after
release (this is enforced by the FE today; the simplified hackathon program
leaves it implicit, see TODO in `lib.rs`).

## Trust model

| Action | Authorised signer | On-chain check |
| --- | --- | --- |
| publish_intent | Scientist wallet | `seeds=["intent", scientist, …]` derives only with that signer |
| patronize | Patron wallet | SPL `transfer` requires patron's signature |
| submit_proof | Scientist wallet | `intent.scientist == signer` |
| verify_milestone | AI Verifier keypair | `signer.key() == AI_VERIFIER_PUBKEY` baked into the program |
| refund | Patron wallet | seeds + `intent.status == Rejected` |

The AI Verifier pubkey is a constant inside `lib.rs`. Phase 3 swaps this
for an admin PDA so multiple verifiers (or a multisig) can sign — but for
the hackathon a single trusted signer keeps the demo legible.

## Off-chain pieces

| Service | Where | Why off-chain |
| --- | --- | --- |
| AI Gatekeeper | `/api/ai-verifier` Next route | LLM inference can't run in BPF |
| Proof storage | IPFS via Pinata, `/api/ipfs-upload` | 200KB→200MB blobs are not on-chain data |
| Live event feed | `useOnChainActivity` hook | WebSocket subscription on the client |
| Demo seed | `scripts/seed-devnet.ts` | One-shot devnet bootstrap |

The browser computes the SHA-256 of any uploaded proof file *before*
sending it to IPFS — so even if the IPFS gateway disappears, the on-chain
hash plus a re-uploaded copy of the file is enough to prove the original
content.

## Trade-offs we made for the hackathon

1. **Single AI Verifier signer** — production should be a multisig of
   independent grading models.
2. **No staking / slashing** — bad-faith verification has no economic
   penalty in Phase 2.
3. **Fixed 3 milestones** — flexible milestone count is a Phase 3 item.
4. **USDC only** — Phase 3 will route through Jupiter for any SPL token.
5. **Refund only on `Rejected` status** — production needs deadline-based
   force-refund.

These are documented as `TODO(phase-3)` markers in the Rust source.
