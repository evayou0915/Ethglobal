# AuraSci contracts (Base)

Foundry project. One contract: `AuraSciEscrow.sol`. See [../docs/BASE_MIGRATION.md](../docs/BASE_MIGRATION.md) for the full design.

## Setup

```bash
# Install Foundry (one-time): https://book.getfoundry.sh/getting-started/installation
curl -L https://foundry.paradigm.xyz | bash
foundryup

# From this directory
forge install foundry-rs/forge-std --no-commit
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge build
forge test -vv
```

## Deploy (Base Sepolia)

```bash
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
export DEPLOYER_PRIVATE_KEY=0x...
export USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e   # Base Sepolia USDC
export SIGNER_ADDRESS=0x...                                       # Backend signer pubkey

forge script script/Deploy.s.sol:Deploy \
    --rpc-url base_sepolia \
    --broadcast \
    --private-key $DEPLOYER_PRIVATE_KEY \
    --verify
```

## Layout

```
contracts/
├── foundry.toml
├── src/
│   └── AuraSciEscrow.sol        # the escrow vault
├── test/
│   └── AuraSciEscrow.t.sol      # forge tests
├── script/
│   └── Deploy.s.sol             # deployment script
└── lib/                          # foundry deps (gitignored)
    ├── forge-std/
    └── openzeppelin-contracts/
```
