/**
 * End-to-end test for the contract's admin path.
 *
 * Covers: adminWithdraw, transferAdmin, acceptAdmin, cancelAdminTransfer,
 *         + the NotAdmin / NotPendingAdmin reverts.
 *
 * Tests run in sequence against the live contract on whatever chain the
 * backend `.env` is pointing at. State changes are restored at the end so
 * the script is safely re-runnable.
 *
 * Required env (pass via env or shell):
 *   ADMIN_PRIVATE_KEY      private key of the *current* admin
 *   NEW_ADMIN_PRIVATE_KEY  private key of a *throwaway* second wallet — we'll
 *                          transfer admin to it then transfer back.
 *
 * Optional env:
 *   INTENT_ID              bytes32 hex with at least 1 USDC of escrow balance
 *                          (defaults to the latest intent in DB that has > 0)
 *   WITHDRAW_AMOUNT        human USDC to attempt withdrawing (default 0.5)
 *
 * Both wallets need a tiny bit of Base Sepolia ETH for gas (~0.001 each).
 *
 * Usage:
 *   ADMIN_PRIVATE_KEY=0x...  NEW_ADMIN_PRIVATE_KEY=0x...  \
 *     npx tsx scripts/test-admin-flows.mts
 */
import { createWalletClient, http, keccak256, parseUnits, toBytes, type Address, type WalletClient, type Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prisma } from "../src/lib/db.js";
import { chain, publicClient } from "../src/lib/chain.js";
import { AURASCI_ESCROW_ABI } from "../src/lib/escrow-abi.js";
import { ENV } from "../src/lib/env.js";

// ── extended ABI: include custom error definitions so viem can decode reverts.
//    (escrow-abi.ts intentionally omits errors to keep the runtime lean — for
//    a test script we want the friendly names.)
const ABI_WITH_ERRORS: Abi = [
  ...AURASCI_ESCROW_ABI as unknown as Abi,
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "AmountExceedsCap", inputs: [{ name: "amount", type: "uint256" }, { name: "cap", type: "uint256" }] },
  { type: "error", name: "InsufficientEscrow", inputs: [{ name: "intentId", type: "bytes32" }, { name: "balance", type: "uint256" }, { name: "requested", type: "uint256" }] },
  { type: "error", name: "NonceAlreadyUsed", inputs: [{ name: "nonce", type: "bytes32" }] },
  { type: "error", name: "InvalidSignature", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "NotAdmin", inputs: [{ name: "caller", type: "address" }] },
  { type: "error", name: "NotPendingAdmin", inputs: [{ name: "caller", type: "address" }] },
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── colour helpers ──────────────────────────────────────────────────────
const C = {
  step: (s: string) => console.log(`\n\x1b[1;36m▶ ${s}\x1b[0m`),
  ok:   (s: string) => console.log(`  \x1b[32m✓ ${s}\x1b[0m`),
  fail: (s: string) => console.log(`  \x1b[31m✗ ${s}\x1b[0m`),
  info: (s: string) => console.log(`  · ${s}`),
};

// ── inputs ──────────────────────────────────────────────────────────────
const ADMIN_PK = process.env.ADMIN_PRIVATE_KEY as `0x${string}` | undefined;
const NEW_PK   = process.env.NEW_ADMIN_PRIVATE_KEY as `0x${string}` | undefined;

if (!ADMIN_PK || !/^0x[0-9a-fA-F]{64}$/.test(ADMIN_PK)) {
  throw new Error("ADMIN_PRIVATE_KEY (current admin) env required");
}
if (!NEW_PK || !/^0x[0-9a-fA-F]{64}$/.test(NEW_PK)) {
  throw new Error("NEW_ADMIN_PRIVATE_KEY (throwaway second wallet) env required");
}

const ESCROW = ENV.ESCROW_ADDRESS as Address;
const USDC   = ENV.USDC_ADDRESS as Address;

const adminAccount    = privateKeyToAccount(ADMIN_PK);
const newAdminAccount = privateKeyToAccount(NEW_PK);

const adminClient = createWalletClient({ account: adminAccount,    chain, transport: http() });
const newClient   = createWalletClient({ account: newAdminAccount, chain, transport: http() });

let passed = 0, failed = 0, skipped = 0;

// ── helpers ─────────────────────────────────────────────────────────────

async function readAdmin(): Promise<Address> {
  return (await publicClient.readContract({
    address: ESCROW, abi: ABI_WITH_ERRORS, functionName: "admin",
  })) as Address;
}
async function readPendingAdmin(): Promise<Address> {
  return (await publicClient.readContract({
    address: ESCROW, abi: ABI_WITH_ERRORS, functionName: "pendingAdmin",
  })) as Address;
}
async function readEscrowBalance(intentId: `0x${string}`): Promise<bigint> {
  return (await publicClient.readContract({
    address: ESCROW, abi: ABI_WITH_ERRORS, functionName: "balanceOf",
    args: [intentId],
  })) as bigint;
}

/** Read pendingAdmin in a tight retry loop until it matches `expected` or
 *  we exhaust the budget. Public Sepolia RPC round-robins across nodes that
 *  occasionally serve stale state right after a write, so a single read
 *  immediately after a tx can be wrong. */
async function readPendingAdminUntil(expected: string, maxMs = 8_000): Promise<Address> {
  const deadline = Date.now() + maxMs;
  let last: Address = "0x0000000000000000000000000000000000000000";
  while (Date.now() < deadline) {
    last = await readPendingAdmin();
    if (last.toLowerCase() === expected.toLowerCase()) return last;
    await sleep(500);
  }
  return last;
}
async function readAdminUntil(expected: string, maxMs = 8_000): Promise<Address> {
  const deadline = Date.now() + maxMs;
  let last: Address = "0x0000000000000000000000000000000000000000";
  while (Date.now() < deadline) {
    last = await readAdmin();
    if (last.toLowerCase() === expected.toLowerCase()) return last;
    await sleep(500);
  }
  return last;
}
async function readUsdcBalance(addr: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: USDC,
    abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const,
    functionName: "balanceOf", args: [addr],
  })) as bigint;
}

/** Pull the most informative error description we can from a viem error
 *  object. viem wraps custom errors in `e.cause.data.errorName`; the top-
 *  level shortMessage usually just says "The contract function reverted." */
function describeError(e: any): string {
  const errName: string | undefined = e?.cause?.data?.errorName ?? e?.data?.errorName;
  const errArgs: unknown[] | undefined = e?.cause?.data?.args ?? e?.data?.args;
  if (errName) {
    const argStr = errArgs && errArgs.length ? `(${errArgs.map((a) => String(a)).join(", ")})` : "()";
    return `${errName}${argStr}`;
  }
  // Fall back to viem's signature string when ABI couldn't decode.
  const sig = e?.cause?.signature ?? e?.signature;
  if (sig) return `reverted with signature ${sig}`;
  return e?.shortMessage ?? e?.cause?.shortMessage ?? e?.message ?? String(e);
}

/** Send a tx and confirm it actually succeeded.
 *
 *  Three-stage:
 *    1. simulateContract — runs the tx in a fork; if it would revert, viem
 *       throws with the decoded custom error name (because we pass
 *       ABI_WITH_ERRORS). We catch and return {revert} in that case.
 *    2. writeContract — broadcasts.
 *    3. waitForTransactionReceipt — wait for inclusion AND check the
 *       receipt's status. (waitForTransactionReceipt alone does NOT throw
 *       on revert; it just returns receipt.status='reverted'.)
 */
async function trySend(
  client: WalletClient,
  fn: string,
  args: readonly unknown[],
): Promise<{ hash?: `0x${string}`; revert?: string }> {
  // 1. simulate first to surface decoded reverts.
  try {
    await publicClient.simulateContract({
      address: ESCROW,
      abi: ABI_WITH_ERRORS,
      functionName: fn,
      args: args as any,
      account: client.account!,
    });
  } catch (e: any) {
    return { revert: describeError(e) };
  }
  // 2. broadcast.
  try {
    const hash = await (client as any).writeContract({
      address: ESCROW, abi: ABI_WITH_ERRORS, functionName: fn, args,
    });
    // 3. wait and check status (revert mid-execution despite passing simulation
    //    is rare but possible if state moves between sim and inclusion).
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      return { revert: `tx reverted on-chain (status=${receipt.status}) hash=${hash}` };
    }
    // Give the public RPC a moment to settle reads after a state-changing tx.
    await sleep(800);
    return { hash };
  } catch (e: any) {
    return { revert: describeError(e) };
  }
}

function assertEq<T>(label: string, got: T, want: T) {
  if ((got as any)?.toString().toLowerCase() === (want as any)?.toString().toLowerCase()) {
    C.ok(`${label}: ${String(got)}`);
    passed++;
  } else {
    C.fail(`${label}: got ${String(got)} expected ${String(want)}`);
    failed++;
  }
}
function expectRevert(result: { hash?: string; revert?: string }, label: string, mustContain?: string) {
  if (result.revert && (!mustContain || result.revert.toLowerCase().includes(mustContain.toLowerCase()))) {
    C.ok(`${label} reverted as expected (${result.revert.slice(0, 60)}…)`);
    passed++;
  } else if (result.revert) {
    C.fail(`${label} reverted but message didn't include "${mustContain}". Got: ${result.revert}`);
    failed++;
  } else {
    C.fail(`${label} did NOT revert — tx hash ${result.hash}`);
    failed++;
  }
}

// ── pick a fundable intent ──────────────────────────────────────────────

async function pickIntentWithBalance(): Promise<{ intentId: `0x${string}`; balance: bigint } | null> {
  if (process.env.INTENT_ID) {
    const id = process.env.INTENT_ID as `0x${string}`;
    const balance = await readEscrowBalance(id);
    return { intentId: id, balance };
  }
  // Try any intent in the DB with totalRaisedUsdc > totalReleasedUsdc.
  const candidates = await prisma.intent.findMany({
    where: { totalRaisedUsdc: { gt: 0n } },
    select: { intentId: true, totalRaisedUsdc: true, totalReleasedUsdc: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  for (const c of candidates) {
    const onchain = await readEscrowBalance(c.intentId as `0x${string}`);
    if (onchain > 0n) return { intentId: c.intentId as `0x${string}`, balance: onchain };
  }
  return null;
}

// ── tests ───────────────────────────────────────────────────────────────

console.log("─".repeat(72));
console.log("  AuraSciEscrow admin-flow integration test");
console.log("─".repeat(72));
C.info(`chain         = ${chain.name} (${chain.id})`);
C.info(`escrow        = ${ESCROW}`);
C.info(`admin (you)   = ${adminAccount.address}`);
C.info(`new admin     = ${newAdminAccount.address}`);

// Sanity: the connected ADMIN_PRIVATE_KEY must currently be the on-chain admin.
const onchainAdmin = await readAdmin();
if (onchainAdmin.toLowerCase() !== adminAccount.address.toLowerCase()) {
  C.fail(`On-chain admin is ${onchainAdmin}; ADMIN_PRIVATE_KEY belongs to ${adminAccount.address}. Aborting.`);
  process.exit(1);
}
C.ok("ADMIN_PRIVATE_KEY matches on-chain admin");

// Sanity: pending admin should be zero, or we abort to avoid mid-flow state.
const pending0 = await readPendingAdmin();
if (pending0 !== "0x0000000000000000000000000000000000000000") {
  C.fail(`pendingAdmin is ${pending0} (mid-transfer state). Cancel it first, then re-run.`);
  process.exit(1);
}
C.ok("pendingAdmin is zero (clean state)");

// ── TEST 1: adminWithdraw happy path ───────────────────────────────────
C.step("TEST 1 — adminWithdraw (happy path)");

const intentInfo = await pickIntentWithBalance();
const withdrawAmount = parseUnits(process.env.WITHDRAW_AMOUNT ?? "0.5", 6);

if (!intentInfo) {
  C.info("no intent with on-chain balance > 0; skipping withdraw tests");
  skipped++;
} else if (intentInfo.balance < withdrawAmount) {
  C.info(`intent ${intentInfo.intentId.slice(0, 14)}… only has ${Number(intentInfo.balance) / 1e6} USDC, need ${Number(withdrawAmount) / 1e6}; skipping`);
  skipped++;
} else {
  const beforeBal = await readEscrowBalance(intentInfo.intentId);
  const beforeRecipient = await readUsdcBalance(adminAccount.address);
  const reason = keccak256(toBytes("admin-test-withdraw"));

  const r = await trySend(adminClient, "adminWithdraw", [
    intentInfo.intentId, withdrawAmount, adminAccount.address, reason,
  ]);
  if (r.hash) {
    C.ok(`adminWithdraw tx mined: ${r.hash}`);
    const afterBal = await readEscrowBalance(intentInfo.intentId);
    const afterRecipient = await readUsdcBalance(adminAccount.address);
    assertEq("balanceOf decreased by amount", (beforeBal - afterBal).toString(), withdrawAmount.toString());
    assertEq("recipient USDC increased by amount", (afterRecipient - beforeRecipient).toString(), withdrawAmount.toString());
  } else {
    C.fail(`adminWithdraw reverted: ${r.revert}`);
    failed++;
  }
}

// ── TEST 2: non-admin cannot adminWithdraw ─────────────────────────────
C.step("TEST 2 — non-admin adminWithdraw must revert (NotAdmin)");

if (intentInfo) {
  const r = await trySend(newClient, "adminWithdraw", [
    intentInfo.intentId, parseUnits("0.01", 6), newAdminAccount.address, keccak256(toBytes("evil")),
  ]);
  expectRevert(r, "non-admin adminWithdraw", "NotAdmin");
} else {
  C.info("skipped (no intent with balance)");
  skipped++;
}

// ── TEST 3: cancelAdminTransfer mid-flow ───────────────────────────────
C.step("TEST 3 — transferAdmin → cancelAdminTransfer");

const r3a = await trySend(adminClient, "transferAdmin", [newAdminAccount.address]);
if (r3a.hash) {
  assertEq("pendingAdmin = newAdmin", await readPendingAdminUntil(newAdminAccount.address), newAdminAccount.address);
} else {
  C.fail(`transferAdmin reverted: ${r3a.revert}`); failed++;
}

const r3b = await trySend(adminClient, "cancelAdminTransfer", []);
if (r3b.hash) {
  assertEq("pendingAdmin cleared", await readPendingAdminUntil("0x0000000000000000000000000000000000000000"), "0x0000000000000000000000000000000000000000");
} else {
  C.fail(`cancelAdminTransfer reverted: ${r3b.revert}`); failed++;
}

// After cancel, the candidate trying acceptAdmin should revert.
const r3c = await trySend(newClient, "acceptAdmin", []);
expectRevert(r3c, "acceptAdmin after cancel", "NotPendingAdmin");

// ── TEST 4: full transfer + reverse transfer ──────────────────────────
C.step("TEST 4 — transferAdmin → acceptAdmin → reverse");

const r4a = await trySend(adminClient, "transferAdmin", [newAdminAccount.address]);
if (!r4a.hash) { C.fail(`transferAdmin reverted: ${r4a.revert}`); failed++; }
assertEq("pendingAdmin = newAdmin", await readPendingAdminUntil(newAdminAccount.address), newAdminAccount.address);

// Wrong address cannot accept.
const r4b = await trySend(adminClient, "acceptAdmin", []);
expectRevert(r4b, "acceptAdmin called by old admin", "NotPendingAdmin");

// Ensure simulate sees pendingAdmin=newAdmin before newClient.acceptAdmin
// (otherwise the simulate's stale view returns NotPendingAdmin).
await readPendingAdminUntil(newAdminAccount.address);
const r4c = await trySend(newClient, "acceptAdmin", []);
if (!r4c.hash) { C.fail(`acceptAdmin reverted: ${r4c.revert}`); failed++; }
assertEq("admin = newAdmin", await readAdminUntil(newAdminAccount.address), newAdminAccount.address);
assertEq("pendingAdmin cleared after accept", await readPendingAdminUntil("0x0000000000000000000000000000000000000000"), "0x0000000000000000000000000000000000000000");

// Old admin tries adminWithdraw → revert.
if (intentInfo) {
  const r4d = await trySend(adminClient, "adminWithdraw", [
    intentInfo.intentId, parseUnits("0.01", 6), adminAccount.address, keccak256(toBytes("from-old-admin")),
  ]);
  expectRevert(r4d, "old admin adminWithdraw after transfer", "NotAdmin");
}

// New admin can adminWithdraw (a tiny amount).
if (intentInfo) {
  const afterFirstBal = await readEscrowBalance(intentInfo.intentId);
  if (afterFirstBal >= parseUnits("0.1", 6)) {
    const reason = keccak256(toBytes("admin-test-new-admin"));
    const r4e = await trySend(newClient, "adminWithdraw", [
      intentInfo.intentId, parseUnits("0.1", 6), newAdminAccount.address, reason,
    ]);
    if (r4e.hash) {
      C.ok(`new admin adminWithdraw tx mined: ${r4e.hash}`);
      passed++;
    } else {
      C.fail(`new admin adminWithdraw reverted: ${r4e.revert}`); failed++;
    }
  } else {
    C.info("not enough balance for new-admin withdraw smoke test, skipping");
    skipped++;
  }
}

// Reverse: new admin transfers back to old admin so script is re-runnable.
// Ensure simulate sees admin=newAdmin first (transferAdmin needs admin role).
await readAdminUntil(newAdminAccount.address);
const r4f = await trySend(newClient, "transferAdmin", [adminAccount.address]);
if (!r4f.hash) { C.fail(`reverse transferAdmin reverted: ${r4f.revert}`); failed++; }
// Same propagation wait before acceptAdmin so simulate sees pendingAdmin=oldAdmin.
await readPendingAdminUntil(adminAccount.address);
const r4g = await trySend(adminClient, "acceptAdmin", []);
if (!r4g.hash) { C.fail(`reverse acceptAdmin reverted: ${r4g.revert}`); failed++; }
assertEq("admin restored to original", await readAdminUntil(adminAccount.address), adminAccount.address);

// ── TEST 5: zero-address guard ─────────────────────────────────────────
C.step("TEST 5 — transferAdmin(0x0) must revert");
const r5 = await trySend(adminClient, "transferAdmin", ["0x0000000000000000000000000000000000000000"]);
expectRevert(r5, "transferAdmin(0)", "ZeroAddress");

// ── summary ────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(72));
console.log(`  RESULT: \x1b[32m${passed} passed\x1b[0m  \x1b[31m${failed} failed\x1b[0m  ${skipped} skipped`);
console.log("─".repeat(72));

await prisma.$disconnect();
process.exit(failed > 0 ? 1 : 0);
