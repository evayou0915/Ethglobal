/** Hand-maintained subset of the AuraSciEscrow ABI used by the backend.
 *  Keep in sync with contracts/src/AuraSciEscrow.sol. */
export const AURASCI_ESCROW_ABI = [
  // events
  {
    type: "event",
    name: "Deposited",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "patron",   type: "address", indexed: true },
      { name: "amount",   type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Released",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "to",       type: "address", indexed: true },
      { name: "amount",   type: "uint256", indexed: false },
      { name: "reason",   type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Refunded",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "patron",   type: "address", indexed: true },
      { name: "amount",   type: "uint256", indexed: false },
      { name: "reason",   type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AdminWithdrawn",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "to",       type: "address", indexed: true },
      { name: "amount",   type: "uint256", indexed: false },
      { name: "reason",   type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AdminTransferStarted",
    inputs: [
      { name: "currentAdmin", type: "address", indexed: true },
      { name: "pendingAdmin", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "AdminTransferred",
    inputs: [
      { name: "previousAdmin", type: "address", indexed: true },
      { name: "newAdmin",      type: "address", indexed: true },
    ],
  },
  // reads
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "intentId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "usedNonce",
    stateMutability: "view",
    inputs: [{ name: "nonce", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  // writes
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "intentId", type: "bytes32" },
      { name: "amount",   type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "release",
    stateMutability: "nonpayable",
    inputs: [
      { name: "intentId", type: "bytes32" },
      { name: "to",       type: "address" },
      { name: "amount",   type: "uint256" },
      { name: "nonce",    type: "bytes32" },
      { name: "reason",   type: "bytes32" },
      { name: "sig",      type: "bytes"   },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "intentId", type: "bytes32" },
      { name: "patron",   type: "address" },
      { name: "amount",   type: "uint256" },
      { name: "nonce",    type: "bytes32" },
      { name: "reason",   type: "bytes32" },
      { name: "sig",      type: "bytes"   },
    ],
    outputs: [],
  },
  // admin
  {
    type: "function",
    name: "admin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "pendingAdmin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "adminWithdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "intentId", type: "bytes32" },
      { name: "amount",   type: "uint256" },
      { name: "to",       type: "address" },
      { name: "reason",   type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "transferAdmin",
    stateMutability: "nonpayable",
    inputs: [{ name: "newAdmin", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "acceptAdmin",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelAdminTransfer",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;
