import { ethers, network, run } from "hardhat";

/**
 * Deploys AuraSciEscrow.
 * Required env vars:
 *   USDC_ADDRESS    — USDC ERC-20 on the target chain
 *   SIGNER_ADDRESS  — Backend signing key pubkey (immutable in the contract)
 *   ADMIN_ADDRESS   — Initial admin (can call adminWithdraw + transferAdmin).
 *                     Defaults to the deployer wallet if unset.
 */
async function main() {
  const usdc = process.env.USDC_ADDRESS;
  const signer = process.env.SIGNER_ADDRESS;
  if (!usdc || !signer) {
    throw new Error("USDC_ADDRESS and SIGNER_ADDRESS must be set");
  }

  // Default admin = deployer if ADMIN_ADDRESS isn't provided. Rotation via
  // transferAdmin + acceptAdmin is supported post-deploy.
  const [deployer] = await ethers.getSigners();
  const admin = process.env.ADMIN_ADDRESS ?? deployer.address;

  console.log(`▶ Network: ${network.name}`);
  console.log(`▶ USDC:    ${usdc}`);
  console.log(`▶ Signer:  ${signer}`);
  console.log(`▶ Admin:   ${admin}${admin === deployer.address ? " (deployer)" : ""}`);

  const Escrow = await ethers.getContractFactory("AuraSciEscrow");
  const escrow = await Escrow.deploy(usdc, signer, admin);
  await escrow.waitForDeployment();
  const addr = await escrow.getAddress();

  console.log(`✔ AuraSciEscrow deployed: ${addr}`);

  if (network.name !== "hardhat" && network.name !== "localhost" && process.env.BASESCAN_API_KEY) {
    console.log("⏳ Waiting 30s before verifying on Basescan…");
    await new Promise((r) => setTimeout(r, 30_000));
    try {
      await run("verify:verify", { address: addr, constructorArguments: [usdc, signer, admin] });
      console.log("✔ Verified on Basescan");
    } catch (e) {
      console.error("verification failed:", e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
