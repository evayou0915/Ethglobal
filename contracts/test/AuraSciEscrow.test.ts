import "@nomicfoundation/hardhat-chai-matchers";
import { expect } from "chai";
import { ethers } from "hardhat";
import type { AuraSciEscrow, MockUSDC } from "../typechain-types";
import type { HDNodeWallet, Wallet } from "ethers";

const usdc = (whole: number | bigint) => BigInt(whole) * 1_000_000n;

const intentIdOf = (s: string) => ethers.encodeBytes32String(s);

describe("AuraSciEscrow", () => {
  let escrow: AuraSciEscrow;
  let mockUsdc: MockUSDC;
  let signer: HDNodeWallet | Wallet; // backend signing key (off-chain)
  let deployer: any;
  let patron: any;
  let patron2: any;
  let scientist: any;
  let domain: { name: string; version: string; chainId: number; verifyingContract: string };

  const INTENT_A = intentIdOf("intent-A");
  const INTENT_B = intentIdOf("intent-B");

  beforeEach(async () => {
    [deployer, patron, patron2, scientist] = await ethers.getSigners();

    // Backend signing key — generated off-chain, not a Hardhat account.
    signer = ethers.Wallet.createRandom();

    const MockUsdcFactory = await ethers.getContractFactory("MockUSDC");
    mockUsdc = (await MockUsdcFactory.deploy()) as unknown as MockUSDC;
    await mockUsdc.waitForDeployment();

    const EscrowFactory = await ethers.getContractFactory("AuraSciEscrow");
    escrow = (await EscrowFactory.deploy(
      await mockUsdc.getAddress(),
      signer.address,
      deployer.address,           // initial admin
    )) as unknown as AuraSciEscrow;
    await escrow.waitForDeployment();

    // Mint and approve.
    for (const p of [patron, patron2]) {
      await mockUsdc.mint(p.address, usdc(1_000_000));
      await mockUsdc.connect(p).approve(await escrow.getAddress(), ethers.MaxUint256);
    }

    domain = {
      name: "AuraSciEscrow",
      version: "1",
      chainId: Number((await ethers.provider.getNetwork()).chainId),
      verifyingContract: await escrow.getAddress(),
    };
  });

  // ─── EIP-712 helpers ──────────────────────────────────────────────────

  const releaseTypes = {
    Release: [
      { name: "intentId", type: "bytes32" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };
  const refundTypes = {
    Refund: [
      { name: "intentId", type: "bytes32" },
      { name: "patron", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };

  async function signRelease(intentId: string, to: string, amount: bigint, nonce: string, withKey?: Wallet | HDNodeWallet) {
    const key = withKey ?? signer;
    return key.signTypedData(domain, releaseTypes, { intentId, to, amount, nonce });
  }
  async function signRefund(intentId: string, patron_: string, amount: bigint, nonce: string, withKey?: Wallet | HDNodeWallet) {
    const key = withKey ?? signer;
    return key.signTypedData(domain, refundTypes, { intentId, patron: patron_, amount, nonce });
  }

  const nonceOf = (s: string) => ethers.id(s);

  // ─── deposit ──────────────────────────────────────────────────────────

  describe("deposit", () => {
    it("happy path: tracks per-intent balance + emits event", async () => {
      await expect(escrow.connect(patron).deposit(INTENT_A, usdc(500)))
        .to.emit(escrow, "Deposited")
        .withArgs(INTENT_A, patron.address, usdc(500));

      expect(await escrow.balanceOf(INTENT_A)).to.eq(usdc(500));
      expect(await mockUsdc.balanceOf(await escrow.getAddress())).to.eq(usdc(500));
    });

    it("accumulates multiple patrons", async () => {
      await escrow.connect(patron).deposit(INTENT_A, usdc(100));
      await escrow.connect(patron2).deposit(INTENT_A, usdc(250));
      expect(await escrow.balanceOf(INTENT_A)).to.eq(usdc(350));
    });

    it("keeps intents isolated", async () => {
      await escrow.connect(patron).deposit(INTENT_A, usdc(100));
      await escrow.connect(patron).deposit(INTENT_B, usdc(200));
      expect(await escrow.balanceOf(INTENT_A)).to.eq(usdc(100));
      expect(await escrow.balanceOf(INTENT_B)).to.eq(usdc(200));
    });

    it("reverts on zero amount", async () => {
      await expect(escrow.connect(patron).deposit(INTENT_A, 0n))
        .to.be.revertedWithCustomError(escrow, "ZeroAmount");
    });
  });

  // ─── release ──────────────────────────────────────────────────────────

  describe("release", () => {
    beforeEach(async () => {
      await escrow.connect(patron).deposit(INTENT_A, usdc(1000));
    });

    it("happy path: pays out, decrements balance, marks nonce used, emits event", async () => {
      const nonce = nonceOf("release-1");
      const sig = await signRelease(INTENT_A, scientist.address, usdc(400), nonce);
      const reason = ethers.id("milestone-0");

      await expect(escrow.release(INTENT_A, scientist.address, usdc(400), nonce, reason, sig))
        .to.emit(escrow, "Released")
        .withArgs(INTENT_A, scientist.address, usdc(400), reason);

      expect(await escrow.balanceOf(INTENT_A)).to.eq(usdc(600));
      expect(await mockUsdc.balanceOf(scientist.address)).to.eq(usdc(400));
      expect(await escrow.usedNonce(nonce)).to.eq(true);
    });

    it("reverts on wrong signer", async () => {
      const rogue = ethers.Wallet.createRandom();
      const nonce = nonceOf("release-1");
      const sig = await signRelease(INTENT_A, scientist.address, usdc(100), nonce, rogue);

      await expect(
        escrow.release(INTENT_A, scientist.address, usdc(100), nonce, ethers.ZeroHash, sig),
      ).to.be.revertedWithCustomError(escrow, "InvalidSignature");
    });

    it("reverts on replay", async () => {
      const nonce = nonceOf("release-1");
      const sig = await signRelease(INTENT_A, scientist.address, usdc(100), nonce);

      await escrow.release(INTENT_A, scientist.address, usdc(100), nonce, ethers.ZeroHash, sig);

      await expect(
        escrow.release(INTENT_A, scientist.address, usdc(100), nonce, ethers.ZeroHash, sig),
      )
        .to.be.revertedWithCustomError(escrow, "NonceAlreadyUsed")
        .withArgs(nonce);
    });

    it("reverts on insufficient escrow", async () => {
      const nonce = nonceOf("release-1");
      const sig = await signRelease(INTENT_A, scientist.address, usdc(1500), nonce);

      await expect(
        escrow.release(INTENT_A, scientist.address, usdc(1500), nonce, ethers.ZeroHash, sig),
      )
        .to.be.revertedWithCustomError(escrow, "InsufficientEscrow")
        .withArgs(INTENT_A, usdc(1000), usdc(1500));
    });

    it("reverts above MAX_RELEASE_PER_TX (100k USDC)", async () => {
      // Top up so balance is not the bottleneck.
      await escrow.connect(patron).deposit(INTENT_A, usdc(200_000));
      const over = usdc(100_001);
      const nonce = nonceOf("release-1");
      const sig = await signRelease(INTENT_A, scientist.address, over, nonce);

      await expect(
        escrow.release(INTENT_A, scientist.address, over, nonce, ethers.ZeroHash, sig),
      )
        .to.be.revertedWithCustomError(escrow, "AmountExceedsCap")
        .withArgs(over, usdc(100_000));
    });

    it("reverts on zero amount", async () => {
      const nonce = nonceOf("release-1");
      const sig = await signRelease(INTENT_A, scientist.address, 0n, nonce);
      await expect(
        escrow.release(INTENT_A, scientist.address, 0n, nonce, ethers.ZeroHash, sig),
      ).to.be.revertedWithCustomError(escrow, "ZeroAmount");
    });

    it("reverts on zero recipient", async () => {
      const nonce = nonceOf("release-1");
      const sig = await signRelease(INTENT_A, ethers.ZeroAddress, usdc(100), nonce);
      await expect(
        escrow.release(INTENT_A, ethers.ZeroAddress, usdc(100), nonce, ethers.ZeroHash, sig),
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
    });
  });

  // ─── refund ───────────────────────────────────────────────────────────

  describe("refund", () => {
    beforeEach(async () => {
      await escrow.connect(patron).deposit(INTENT_A, usdc(500));
    });

    it("happy path: refunds the patron + emits event", async () => {
      const nonce = nonceOf("refund-1");
      const sig = await signRefund(INTENT_A, patron.address, usdc(500), nonce);
      const reason = ethers.id("rejected");
      const before = await mockUsdc.balanceOf(patron.address);

      await expect(escrow.refund(INTENT_A, patron.address, usdc(500), nonce, reason, sig))
        .to.emit(escrow, "Refunded")
        .withArgs(INTENT_A, patron.address, usdc(500), reason);

      expect(await mockUsdc.balanceOf(patron.address)).to.eq(before + usdc(500));
      expect(await escrow.balanceOf(INTENT_A)).to.eq(0n);
    });

    it("reverts on wrong signer", async () => {
      const rogue = ethers.Wallet.createRandom();
      const nonce = nonceOf("refund-1");
      const sig = await signRefund(INTENT_A, patron.address, usdc(100), nonce, rogue);

      await expect(
        escrow.refund(INTENT_A, patron.address, usdc(100), nonce, ethers.ZeroHash, sig),
      ).to.be.revertedWithCustomError(escrow, "InvalidSignature");
    });

    it("reverts on replay", async () => {
      const nonce = nonceOf("refund-1");
      const sig = await signRefund(INTENT_A, patron.address, usdc(100), nonce);
      await escrow.refund(INTENT_A, patron.address, usdc(100), nonce, ethers.ZeroHash, sig);
      await expect(
        escrow.refund(INTENT_A, patron.address, usdc(100), nonce, ethers.ZeroHash, sig),
      )
        .to.be.revertedWithCustomError(escrow, "NonceAlreadyUsed")
        .withArgs(nonce);
    });
  });

  // ─── cross-instruction signature isolation ───────────────────────────

  it("a release signature cannot be reused as a refund", async () => {
    await escrow.connect(patron).deposit(INTENT_A, usdc(500));
    const nonce = nonceOf("xattack");
    const releaseSig = await signRelease(INTENT_A, patron.address, usdc(100), nonce);

    await expect(
      escrow.refund(INTENT_A, patron.address, usdc(100), nonce, ethers.ZeroHash, releaseSig),
    ).to.be.revertedWithCustomError(escrow, "InvalidSignature");
  });

  // ─── EIP-712 plumbing ────────────────────────────────────────────────

  it("exposes a non-zero EIP-712 domain separator", async () => {
    expect(await escrow.domainSeparator()).to.not.eq(ethers.ZeroHash);
  });

  it("hashRelease matches off-chain digest", async () => {
    const nonce = nonceOf("digest-check");
    const onchain = await escrow.hashRelease(INTENT_A, scientist.address, usdc(100), nonce);
    const offchain = ethers.TypedDataEncoder.hash(domain, releaseTypes, {
      intentId: INTENT_A,
      to: scientist.address,
      amount: usdc(100),
      nonce,
    });
    expect(onchain).to.eq(offchain);
  });

  // ─── admin (governance escape hatch) ─────────────────────────────────

  describe("adminWithdraw", () => {
    beforeEach(async () => {
      await escrow.connect(patron).deposit(INTENT_A, usdc(500));
    });

    it("admin can pull funds out of an intent, decrementing balance + emitting event", async () => {
      const reason = ethers.id("ops-recovery");
      await expect(
        escrow.connect(deployer).adminWithdraw(INTENT_A, usdc(120), scientist.address, reason),
      )
        .to.emit(escrow, "AdminWithdrawn")
        .withArgs(INTENT_A, scientist.address, usdc(120), reason);
      expect(await escrow.balanceOf(INTENT_A)).to.eq(usdc(380));
      expect(await mockUsdc.balanceOf(scientist.address)).to.eq(usdc(120));
    });

    it("non-admin cannot call adminWithdraw", async () => {
      await expect(
        escrow.connect(patron).adminWithdraw(INTENT_A, usdc(10), patron.address, ethers.ZeroHash),
      )
        .to.be.revertedWithCustomError(escrow, "NotAdmin")
        .withArgs(patron.address);
    });

    it("reverts above MAX_RELEASE_PER_TX", async () => {
      await escrow.connect(patron).deposit(INTENT_A, usdc(200_000));
      await expect(
        escrow.connect(deployer).adminWithdraw(INTENT_A, usdc(150_000), scientist.address, ethers.ZeroHash),
      )
        .to.be.revertedWithCustomError(escrow, "AmountExceedsCap")
        .withArgs(usdc(150_000), usdc(100_000));
    });

    it("reverts on zero amount / zero recipient", async () => {
      await expect(
        escrow.connect(deployer).adminWithdraw(INTENT_A, 0n, scientist.address, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(escrow, "ZeroAmount");
      await expect(
        escrow.connect(deployer).adminWithdraw(INTENT_A, usdc(10), ethers.ZeroAddress, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
    });

    it("reverts on insufficient escrow", async () => {
      await expect(
        escrow.connect(deployer).adminWithdraw(INTENT_A, usdc(10_000), scientist.address, ethers.ZeroHash),
      )
        .to.be.revertedWithCustomError(escrow, "InsufficientEscrow")
        .withArgs(INTENT_A, usdc(500), usdc(10_000));
    });
  });

  describe("admin rotation", () => {
    it("two-step transfer: transferAdmin → acceptAdmin", async () => {
      await expect(escrow.connect(deployer).transferAdmin(patron.address))
        .to.emit(escrow, "AdminTransferStarted")
        .withArgs(deployer.address, patron.address);
      expect(await escrow.admin()).to.eq(deployer.address);     // not yet
      expect(await escrow.pendingAdmin()).to.eq(patron.address);

      // wrong address can't accept
      await expect(escrow.connect(patron2).acceptAdmin())
        .to.be.revertedWithCustomError(escrow, "NotPendingAdmin")
        .withArgs(patron2.address);

      await expect(escrow.connect(patron).acceptAdmin())
        .to.emit(escrow, "AdminTransferred")
        .withArgs(deployer.address, patron.address);
      expect(await escrow.admin()).to.eq(patron.address);
      expect(await escrow.pendingAdmin()).to.eq(ethers.ZeroAddress);
    });

    it("old admin loses power after acceptAdmin", async () => {
      await escrow.connect(deployer).transferAdmin(patron.address);
      await escrow.connect(patron).acceptAdmin();
      await expect(
        escrow.connect(deployer).adminWithdraw(INTENT_A, usdc(1), patron.address, ethers.ZeroHash),
      )
        .to.be.revertedWithCustomError(escrow, "NotAdmin")
        .withArgs(deployer.address);
    });

    it("non-admin cannot transferAdmin", async () => {
      await expect(escrow.connect(patron).transferAdmin(patron2.address))
        .to.be.revertedWithCustomError(escrow, "NotAdmin")
        .withArgs(patron.address);
    });

    it("admin can cancel a pending transfer", async () => {
      await escrow.connect(deployer).transferAdmin(patron.address);
      await expect(escrow.connect(deployer).cancelAdminTransfer())
        .to.emit(escrow, "AdminTransferStarted")
        .withArgs(deployer.address, ethers.ZeroAddress);
      expect(await escrow.pendingAdmin()).to.eq(ethers.ZeroAddress);
      await expect(escrow.connect(patron).acceptAdmin())
        .to.be.revertedWithCustomError(escrow, "NotPendingAdmin");
    });

    it("rejects zero-address admin in transfer", async () => {
      await expect(escrow.connect(deployer).transferAdmin(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(escrow, "ZeroAddress");
    });
  });

  describe("constructor", () => {
    it("rejects zero admin", async () => {
      const EscrowFactory = await ethers.getContractFactory("AuraSciEscrow");
      await expect(
        EscrowFactory.deploy(await mockUsdc.getAddress(), signer.address, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
    });

    it("emits AdminTransferred(0, admin) on deploy", async () => {
      const EscrowFactory = await ethers.getContractFactory("AuraSciEscrow");
      const fresh = await EscrowFactory.deploy(
        await mockUsdc.getAddress(),
        signer.address,
        deployer.address,
      );
      const receipt = await fresh.deploymentTransaction()!.wait();
      const log = receipt!.logs.find((l: any) => l.fragment?.name === "AdminTransferred");
      expect(log).to.exist;
    });
  });
});
