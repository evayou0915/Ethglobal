import { keccak256, toBytes, getAddress, type LocalAccount } from "viem";
import { createViemAccount } from "@privy-io/server-auth/viem";
import { chain, ESCROW_ADDRESS, getSignerWalletClient } from "./chain.js";
import { ENV } from "./env.js";
import { privy } from "./privy.js";

/** The account that authorizes milestone releases. Either the local
 *  SIGNER_PRIVATE_KEY account, or — when RELEASE_SIGNER=privy — a Privy
 *  server wallet exposed as a viem LocalAccount (non-custodial, governed
 *  by its policy). Both implement `signTypedData`, so the EIP-712 release
 *  signature the escrow verifies is produced identically. */
let _releaseAccount: LocalAccount | null = null;
async function getReleaseAccount(): Promise<LocalAccount> {
  if (_releaseAccount) return _releaseAccount;
  if (ENV.RELEASE_SIGNER === "privy") {
    if (!ENV.PRIVY_WALLET_ID || !ENV.PRIVY_WALLET_ADDRESS) {
      throw new Error("RELEASE_SIGNER=privy but PRIVY_WALLET_ID / PRIVY_WALLET_ADDRESS unset");
    }
    _releaseAccount = await createViemAccount({
      walletId: ENV.PRIVY_WALLET_ID,
      address: ENV.PRIVY_WALLET_ADDRESS as `0x${string}`,
      // The /viem subpath and the root export ship separate PrivyClient
      // declarations (ESM vs CJS dts); they're the same runtime class.
      privy: privy() as any,
    });
  } else {
    _releaseAccount = getSignerWalletClient().account as LocalAccount;
  }
  return _releaseAccount;
}

/** EIP-712 domain for AuraSciEscrow. Must match the contract's `EIP712("AuraSciEscrow", "1")`. */
export const ESCROW_DOMAIN = {
  name: "AuraSciEscrow",
  version: "1",
  chainId: chain.id,
  verifyingContract: ESCROW_ADDRESS,
} as const;

export const RELEASE_TYPES = {
  Release: [
    { name: "intentId", type: "bytes32" },
    { name: "to",       type: "address" },
    { name: "amount",   type: "uint256" },
    { name: "nonce",    type: "bytes32" },
  ],
} as const;

export const REFUND_TYPES = {
  Refund: [
    { name: "intentId", type: "bytes32" },
    { name: "patron",   type: "address" },
    { name: "amount",   type: "uint256" },
    { name: "nonce",    type: "bytes32" },
  ],
} as const;

/** Generate a deterministic per-(purpose, intent, target, index) nonce so a
 *  release for the same milestone always recovers the same nonce. */
export function deriveNonce(args: {
  purpose: "release" | "refund";
  intentId: `0x${string}`;
  target: `0x${string}`;
  index: number;
  salt?: string;
}): `0x${string}` {
  const payload = JSON.stringify({
    p: args.purpose,
    i: args.intentId.toLowerCase(),
    t: args.target.toLowerCase(),
    n: args.index,
    s: args.salt ?? "",
  });
  return keccak256(toBytes(payload));
}

export async function signRelease(args: {
  intentId: `0x${string}`;
  to: `0x${string}`;
  amount: bigint;
  nonce: `0x${string}`;
}) {
  const account = await getReleaseAccount();
  const signature = await account.signTypedData({
    domain: ESCROW_DOMAIN,
    types: RELEASE_TYPES,
    primaryType: "Release",
    message: {
      intentId: args.intentId,
      to: getAddress(args.to),
      amount: args.amount,
      nonce: args.nonce,
    },
  });
  return { signature, signer: account.address };
}

export async function signRefund(args: {
  intentId: `0x${string}`;
  patron: `0x${string}`;
  amount: bigint;
  nonce: `0x${string}`;
}) {
  const account = await getReleaseAccount();
  const signature = await account.signTypedData({
    domain: ESCROW_DOMAIN,
    types: REFUND_TYPES,
    primaryType: "Refund",
    message: {
      intentId: args.intentId,
      patron: getAddress(args.patron),
      amount: args.amount,
      nonce: args.nonce,
    },
  });
  return { signature, signer: account.address };
}

/** Wrap free-form text into a bytes32 tag, padded/truncated. Used as the
 *  `reason` arg in release/refund (purely informational, contract does not
 *  validate). */
export function reasonTag(s: string): `0x${string}` {
  return keccak256(toBytes(s));
}

/** Bytes32 helper used for intent ids stored as hex strings. */
export const asBytes32 = (hex: string): `0x${string}` => {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length !== 64) throw new Error(`expected 32-byte hex, got ${h.length / 2} bytes`);
  return ("0x" + h.toLowerCase()) as `0x${string}`;
};
