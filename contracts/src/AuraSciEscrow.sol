// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title AuraSciEscrow
/// @notice Minimal USDC escrow for AuraSci.
///         The contract is a vault. The backend is the ledger.
///         All non-money state (intent metadata, statuses, AI scores, proofs)
///         lives off-chain. The contract supports four ways to move money:
///           1. `deposit`         — anyone, tags USDC by intentId.
///           2. `release`         — signed by `signer` (EIP-712), pays scientist.
///           3. `refund`          — signed by `signer` (EIP-712), refunds patron.
///           4. `adminWithdraw`   — `admin` only, escape hatch / governance.
///         Admin power is **rotatable** via a two-step propose/accept flow
///         (`transferAdmin` → `acceptAdmin`).
contract AuraSciEscrow is EIP712 {
    using SafeERC20 for IERC20;

    // ─── Immutable config ────────────────────────────────────────────────

    /// @notice USDC token contract (6 decimals on Base).
    IERC20 public immutable USDC;

    /// @notice Backend signing key. Authorizes every release and refund.
    ///         Immutable: rotation = redeploy + migrate balances out via release().
    address public immutable signer;

    /// @notice Hard cap on a single release / admin-withdraw transaction.
    ///         Limits blast radius if either key is compromised — admin still
    ///         has to issue many txs to drain a large pool.
    uint256 public constant MAX_RELEASE_PER_TX = 100_000 * 1e6; // 100k USDC

    // ─── Mutable state ───────────────────────────────────────────────────

    /// @notice USDC currently escrowed for each intent (in 6-decimal units).
    mapping(bytes32 intentId => uint256 balance) public balanceOf;

    /// @notice Nonces that have already been consumed by release/refund.
    mapping(bytes32 nonce => bool used) public usedNonce;

    /// @notice Current admin. May call `adminWithdraw` and `transferAdmin`.
    address public admin;

    /// @notice Address proposed as the next admin. They must call
    ///         `acceptAdmin()` from that address to actually take over —
    ///         prevents accidentally transferring to an unreachable wallet.
    address public pendingAdmin;

    // ─── EIP-712 type hashes ─────────────────────────────────────────────

    bytes32 private constant RELEASE_TYPEHASH = keccak256(
        "Release(bytes32 intentId,address to,uint256 amount,bytes32 nonce)"
    );
    bytes32 private constant REFUND_TYPEHASH = keccak256(
        "Refund(bytes32 intentId,address patron,uint256 amount,bytes32 nonce)"
    );

    // ─── Events ──────────────────────────────────────────────────────────

    event Deposited(bytes32 indexed intentId, address indexed patron, uint256 amount);
    event Released (bytes32 indexed intentId, address indexed to,     uint256 amount, bytes32 reason);
    event Refunded (bytes32 indexed intentId, address indexed patron, uint256 amount, bytes32 reason);
    event AdminWithdrawn      (bytes32 indexed intentId, address indexed to,    uint256 amount, bytes32 reason);
    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferred    (address indexed previousAdmin, address indexed newAdmin);

    // ─── Errors ──────────────────────────────────────────────────────────

    error ZeroAmount();
    error AmountExceedsCap(uint256 amount, uint256 cap);
    error InsufficientEscrow(bytes32 intentId, uint256 balance, uint256 requested);
    error NonceAlreadyUsed(bytes32 nonce);
    error InvalidSignature();
    error ZeroAddress();
    error NotAdmin(address caller);
    error NotPendingAdmin(address caller);

    // ─── Modifier ────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin(msg.sender);
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────

    /// @param usdc    Address of the USDC ERC-20.
    /// @param signer_ Backend signing pubkey (cannot be changed).
    /// @param admin_  Initial admin. Can be rotated later via
    ///                `transferAdmin` + `acceptAdmin`.
    constructor(IERC20 usdc, address signer_, address admin_) EIP712("AuraSciEscrow", "1") {
        if (address(usdc) == address(0) || signer_ == address(0) || admin_ == address(0)) {
            revert ZeroAddress();
        }
        USDC   = usdc;
        signer = signer_;
        admin  = admin_;
        emit AdminTransferred(address(0), admin_);
    }

    // ─── External: deposit ───────────────────────────────────────────────

    /// @notice Patron deposits USDC tagged by intentId.
    ///         Patron MUST `USDC.approve(this, amount)` first.
    /// @param intentId Off-chain identifier for the intent receiving funds.
    /// @param amount   USDC (6-decimal) to deposit.
    function deposit(bytes32 intentId, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        balanceOf[intentId] += amount;
        emit Deposited(intentId, msg.sender, amount);
    }

    // ─── External: release ───────────────────────────────────────────────

    /// @notice Pay out from an intent's escrow. Authorized by an EIP-712
    ///         signature from `signer`.
    /// @param intentId Intent the funds belong to.
    /// @param to       Recipient (typically the scientist).
    /// @param amount   USDC to release.
    /// @param nonce    Unique signed-message nonce. Reverts if reused.
    /// @param reason   Free-form tag, emitted in the event (eg. keccak("milestone-0")).
    ///                 The contract does not validate it.
    /// @param sig      EIP-712 signature over (intentId, to, amount, nonce).
    function release(
        bytes32 intentId,
        address to,
        uint256 amount,
        bytes32 nonce,
        bytes32 reason,
        bytes calldata sig
    ) external {
        if (amount == 0) revert ZeroAmount();
        if (amount > MAX_RELEASE_PER_TX) revert AmountExceedsCap(amount, MAX_RELEASE_PER_TX);
        if (to == address(0)) revert ZeroAddress();

        uint256 bal = balanceOf[intentId];
        if (bal < amount) revert InsufficientEscrow(intentId, bal, amount);
        if (usedNonce[nonce]) revert NonceAlreadyUsed(nonce);

        bytes32 structHash = keccak256(
            abi.encode(RELEASE_TYPEHASH, intentId, to, amount, nonce)
        );
        if (ECDSA.recover(_hashTypedDataV4(structHash), sig) != signer) {
            revert InvalidSignature();
        }

        usedNonce[nonce] = true;
        balanceOf[intentId] = bal - amount;
        USDC.safeTransfer(to, amount);

        emit Released(intentId, to, amount, reason);
    }

    // ─── External: refund ────────────────────────────────────────────────

    /// @notice Refund a patron from an intent's escrow. Authorized by an
    ///         EIP-712 signature from `signer`.
    /// @param intentId Intent the funds belong to.
    /// @param patron   Address to refund.
    /// @param amount   USDC to refund.
    /// @param nonce    Unique signed-message nonce.
    /// @param reason   Free-form tag for the event.
    /// @param sig      EIP-712 signature over (intentId, patron, amount, nonce).
    function refund(
        bytes32 intentId,
        address patron,
        uint256 amount,
        bytes32 nonce,
        bytes32 reason,
        bytes calldata sig
    ) external {
        if (amount == 0) revert ZeroAmount();
        if (patron == address(0)) revert ZeroAddress();

        uint256 bal = balanceOf[intentId];
        if (bal < amount) revert InsufficientEscrow(intentId, bal, amount);
        if (usedNonce[nonce]) revert NonceAlreadyUsed(nonce);

        bytes32 structHash = keccak256(
            abi.encode(REFUND_TYPEHASH, intentId, patron, amount, nonce)
        );
        if (ECDSA.recover(_hashTypedDataV4(structHash), sig) != signer) {
            revert InvalidSignature();
        }

        usedNonce[nonce] = true;
        balanceOf[intentId] = bal - amount;
        USDC.safeTransfer(patron, amount);

        emit Refunded(intentId, patron, amount, reason);
    }

    // ─── External: admin ─────────────────────────────────────────────────

    /// @notice Pull `amount` of USDC out of `intentId`'s escrow to `to`.
    ///         Bypasses the signer-authorized release/refund flow. Intended
    ///         for governance recovery (failed project, signer key lost,
    ///         operational emergency). Subject to the same per-tx cap as
    ///         `release` so a single compromised admin tx can't drain a
    ///         100k+ pool atomically.
    /// @dev    Decrements `balanceOf[intentId]` and transfers `amount` USDC
    ///         to `to`. Emits `AdminWithdrawn`.
    function adminWithdraw(
        bytes32 intentId,
        uint256 amount,
        address to,
        bytes32 reason
    ) external onlyAdmin {
        if (amount == 0) revert ZeroAmount();
        if (amount > MAX_RELEASE_PER_TX) revert AmountExceedsCap(amount, MAX_RELEASE_PER_TX);
        if (to == address(0)) revert ZeroAddress();

        uint256 bal = balanceOf[intentId];
        if (bal < amount) revert InsufficientEscrow(intentId, bal, amount);

        balanceOf[intentId] = bal - amount;
        USDC.safeTransfer(to, amount);

        emit AdminWithdrawn(intentId, to, amount, reason);
    }

    /// @notice Propose handing admin power to `newAdmin`. The transfer is
    ///         NOT effective until `newAdmin` calls `acceptAdmin()` from
    ///         that same address — prevents fat-fingering admin into a
    ///         dead address.
    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    /// @notice Called by the address proposed in `transferAdmin` to take
    ///         over the admin role.
    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert NotPendingAdmin(msg.sender);
        address previousAdmin = admin;
        admin = pendingAdmin;
        pendingAdmin = address(0);
        emit AdminTransferred(previousAdmin, admin);
    }

    /// @notice Cancel a pending admin transfer. Either side can call this
    ///         (current admin to retract; pending admin to decline).
    function cancelAdminTransfer() external {
        if (msg.sender != admin && msg.sender != pendingAdmin) revert NotAdmin(msg.sender);
        pendingAdmin = address(0);
        emit AdminTransferStarted(admin, address(0));
    }

    // ─── View helpers (for backend signing) ──────────────────────────────

    /// @notice Returns the EIP-712 digest a signer must sign for `release`.
    ///         Backend uses this to verify it produced the right hash before
    ///         broadcasting.
    function hashRelease(
        bytes32 intentId,
        address to,
        uint256 amount,
        bytes32 nonce
    ) external view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(RELEASE_TYPEHASH, intentId, to, amount, nonce))
        );
    }

    /// @notice Returns the EIP-712 digest a signer must sign for `refund`.
    function hashRefund(
        bytes32 intentId,
        address patron,
        uint256 amount,
        bytes32 nonce
    ) external view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(REFUND_TYPEHASH, intentId, patron, amount, nonce))
        );
    }

    /// @notice EIP-712 domain separator (exposed for off-chain signers).
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
