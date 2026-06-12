# Colosseum Solana Frontier Hackathon — AuraSci

> Recommended track context: the Solana Frontier Hackathon currently runs
> without strict tracks ($30K Grand Champion + 20 × $10K runner-ups + a
> public-goods prize and a university prize). AuraSci targets the
> **Grand Champion + Public Goods** lanes simultaneously: it is consumer-
> friendly (any patron with a Phantom wallet can fund science in two clicks)
> *and* a public-goods primitive (the on-chain release rail is open for
> anyone to fork into their own grant program).

## One-liner

AuraSci turns research grants into programmable on-chain capital: scientists
publish milestones, AI agents verify proof, Solana releases USDC.

## Problem

- $200B+/year flows into research grants worldwide; cycle times are 9–18 months.
- Funds are paid as lump sums with no ongoing accountability.
- Outcomes (papers, datasets, code) live on the funder's drive, not in a
  permanent public record.

## Solution

A milestone-based escrow on Solana with an AI Verifier as the release
oracle. Three primitives:

1. **IntentAsset** — research proposal with funding goal + 3 milestones, AI-screened.
2. **Patronage** — USDC contribution to an IntentAsset, recorded as a PDA.
3. **Milestone NFT** — minted to the scientist when AI verifies the proof,
   permanent record of the result.

## What's on-chain

| Layer | What | Where |
| --- | --- | --- |
| Program | 6 instructions, 4 account types, 3 events | `programs/aurasci/src/lib.rs` |
| Escrow | PDA-owned USDC ATA per intent | `Patronize` + `VerifyMilestone` |
| Receipts | Soul-bound NFTs via Metaplex Token Metadata | `src/solana/lib/nft.ts` |
| Audit trail | Anchor events streamed to the live activity feed | `useOnChainActivity` |

## What's off-chain (and why)

| Component | Why off-chain | How we make it trustless |
| --- | --- | --- |
| AI Gatekeeper screening | LLM inference can't run in BPF | Score is stamped into IntentAsset on `publish_intent`; tamper-evident |
| AI Verifier scoring | LLM inference can't run in BPF | Verifier signs `verify_milestone`; the program checks `signer == AI_VERIFIER_PUBKEY` |
| Proof storage | 200KB–200MB blobs aren't on-chain data | SHA-256 of the file is committed on-chain; CID is auditable |

## Solana-native features used

- **PDA-owned token accounts** — escrow vault has no human authority.
- **CPIs into SPL Token** — patronage uses `token::transfer`.
- **Anchor program events** — replace polling with real-time UI updates.
- **Metaplex Token Metadata** — NFT receipts at <$0.001 each.
- **Wallet adapter** — Phantom, Solflare, Backpack out of the box.

## Demo links

- Live frontend: https://aurasci.vercel.app
- Devnet program ID: _filled in after `anchor deploy`_
- Sample patronage tx: _filled in after first demo run_
- Sample milestone-verified tx: _filled in after first demo run_

## What we built during the hackathon

| Existing (Phase 1, by zizizizazaza) | New (Phase 2, on-chain) |
| --- | --- |
| Next 14 + Tailwind frontend | Anchor program (Rust) — `programs/aurasci/` |
| Mock Zustand store | Solana wallet adapter integration |
| Mock activity feed | Live program-event activity hook |
| Mock fund button | USDC patronage tx with ATA bootstrap |
| Mock milestone flow | On-chain proof commitment + AI verifier signer |
| — | Metaplex NFT minting |
| — | Pinata IPFS pinning route |
| — | Devnet seed script |

## Why this can only be Solana

- **Throughput** — patrons arrive in bursts; Solana absorbs spikes that would
  congest L1 / L2 EVM.
- **Cost** — milestone NFTs at <$0.001 each; an EVM L1 would cost $10+.
- **Latency** — sub-second confirmation lets the activity feed feel real-time.
- **Composability** — Metaplex + SPL + Wallet Adapter cover 90% of the stack.

## Roadmap

| Phase | Scope |
| --- | --- |
| Phase 2 (this submission) | Anchor program + USDC escrow + AI Verifier signer + NFT receipts |
| Phase 3 | Multi-sig AI verifier, deadline-based refunds, Jupiter routing for any SPL, governance, mainnet |
| Phase 4 | DAO of patrons that can challenge AI verdicts; reputation graph for scientists |

## Team

- **Eva You** ([@1vayou](https://github.com/1vayou)) — founder, product. Original AuraSci concept; led the Solana hackathon work (Anchor program, on-chain integration, devnet deployment, this submission).
- **Ellie Liu** — UI / UX. Designed the visual system and authored the UI-optimized version shipped at [aurasci.vercel.app](https://aurasci.vercel.app). This submission is built on top of her UI-optimized version, which itself extends Eva's original product spec.

The reference (pre-Solana) frontend lives at [github.com/zizizizazaza/aurasci](https://github.com/zizizizazaza/aurasci).
