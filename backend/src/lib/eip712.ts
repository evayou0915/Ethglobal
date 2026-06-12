import { keccak256, toBytes, getAddress } from "viem";
import { chain, ESCROW_ADDRESS, getSignerWalletClient } from "./chain.js";

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
  const { client, account } = getSignerWalletClient();
  const signature = await client.signTypedData({
    account,
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
  const { client, account } = getSignerWalletClient();
  const signature = await client.signTypedData({
    account,
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
