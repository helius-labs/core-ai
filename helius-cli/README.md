# Helius CLI

Official command-line interface for [Helius](https://helius.dev) — the leading Solana RPC and API provider. Built for developers and LLM agents.

## Installation

```bash
npm install -g helius-cli
# or
pnpm add -g helius-cli
```

## Quick Start

### Existing Helius users

If you already have an API key, just set it:

```bash
helius config set-api-key <your-api-key>
```

Get your key from [dashboard.helius.dev](https://dashboard.helius.dev).

### New users — create an account

```bash
# 1. Generate a keypair
helius keygen

# 2. Fund the wallet address shown above:
#    - ~0.001 SOL for transaction fees
#    - 1 USDC for the basic plan ($1 one-time)

# 3. Create account
helius signup

# 4. Start querying
helius balance <wallet-address>
helius tx parse <signature>
```

Paid plans: add `--plan developer` ($49/mo), `--plan business` ($499/mo), or `--plan professional` ($999/mo) to `helius signup`, with `--email`, `--first-name`, `--last-name` required.

## Configuration

Config and keypair are stored under `~/.helius/`:

```
~/.helius/
├── config.json    # API key, JWT, network, default project
└── keypair.json   # Solana keypair (if generated with keygen)
```

API keys are resolved in this order:

1. `--api-key <key>` flag
2. `HELIUS_API_KEY` environment variable
3. `~/.helius/config.json`

```bash
helius config show                # View current config
helius config set-api-key <key>  # Set API key
helius config set-network devnet # Switch to devnet
helius config set-project <id>   # Set default project
helius config clear               # Reset config
```

## Commands

### Account Management

| Command | Description |
|---|---|
| `helius keygen` | Generate a new Solana keypair |
| `helius signup` | Create a Helius account (default: basic $1; use `--plan` for paid) |
| `helius login` | Authenticate with an existing wallet |
| `helius upgrade --plan <name>` | Upgrade to a paid plan |
| `helius pay <payment-intent-id>` | Pay a renewal or pending payment intent |
| `helius projects` | List all projects |
| `helius project [id]` | Get project details |
| `helius apikeys [project-id]` | List API keys |
| `helius apikeys create [project-id]` | Create a new API key |
| `helius usage [project-id]` | Show credits usage |
| `helius rpc [project-id]` | Show RPC endpoints |

### Balances & Tokens

| Command | Description |
|---|---|
| `helius balance <address>` | Get native SOL balance |
| `helius tokens <address>` | Get fungible token balances |
| `helius token-holders <mint>` | Get top holders of a token |

### Transactions

| Command | Description |
|---|---|
| `helius tx parse <signatures...>` | Parse transactions into human-readable format |
| `helius tx history <address>` | Get enhanced transaction history |
| `helius tx fees` | Get priority fee estimates |

### Digital Assets (DAS API)

| Command | Description |
|---|---|
| `helius asset get <id>` | Get asset by mint address |
| `helius asset batch <ids...>` | Get multiple assets |
| `helius asset owner <address>` | Get assets by owner |
| `helius asset creator <address>` | Get assets by creator |
| `helius asset authority <address>` | Get assets by authority |
| `helius asset collection <address>` | Get assets in a collection |
| `helius asset search` | Search assets with filters |
| `helius asset proof <id>` | Get Merkle proof for a compressed NFT |
| `helius asset proof-batch <ids...>` | Get Merkle proofs for multiple compressed NFTs |
| `helius asset editions <mint>` | Get NFT editions |
| `helius asset signatures <id>` | Get transaction signatures for an asset |
| `helius asset token-accounts` | Query token accounts by owner/mint |

### Account & Network

| Command | Description |
|---|---|
| `helius account <address>` | Get Solana account info |
| `helius network-status` | Get Solana network status |
| `helius block <slot>` | Get block details |

### Wallet API

| Command | Description |
|---|---|
| `helius wallet identity <address>` | Look up wallet identity |
| `helius wallet identity-batch <addresses...>` | Look up identities for multiple wallets |
| `helius wallet balances <address>` | Get all token balances with USD values |
| `helius wallet history <address>` | Get transaction history with balance changes |
| `helius wallet transfers <address>` | Get token transfers |
| `helius wallet funded-by <address>` | Find original funding source |

### Webhooks

| Command | Description |
|---|---|
| `helius webhook list` | List all webhooks |
| `helius webhook get <id>` | Get webhook details |
| `helius webhook create` | Create a webhook (`--url`, `--accounts`, `--types` required) |
| `helius webhook update <id>` | Update a webhook |
| `helius webhook delete <id>` | Delete a webhook |

### Program Accounts

| Command | Description |
|---|---|
| `helius program accounts <program-id>` | Get accounts owned by a program |
| `helius program accounts-all <program-id>` | Get all accounts (auto-paginate) |
| `helius program token-accounts <owner>` | Get token accounts by owner |

### Staking

| Command | Description |
|---|---|
| `helius stake create <amount>` | Create a stake transaction (SOL) |
| `helius stake unstake <stake-account>` | Create an unstake transaction |
| `helius stake withdraw <stake-account>` | Create a withdraw transaction |
| `helius stake accounts <wallet>` | Get Helius stake accounts for a wallet |
| `helius stake withdrawable <stake-account>` | Get withdrawable amount |
| `helius stake instructions <amount>` | Get stake instructions |

### ZK Compression

| Command | Description |
|---|---|
| `helius zk account <address>` | Get compressed account |
| `helius zk accounts-by-owner <owner>` | Get compressed accounts by owner |
| `helius zk balance <address>` | Get compressed balance |
| `helius zk token-holders <mint>` | Get compressed token holders |
| `helius zk proof <address>` | Get compressed account proof |
| `helius zk proofs <addresses...>` | Get multiple proofs |
| `helius zk validity-proof` | Get validity proof |
| `helius zk tx <signature>` | Get transaction with compression info |
| `helius zk indexer-health` | Check ZK indexer health |
| *(+ more zk subcommands)* | `helius zk --help` for the full list |

### Transaction Sending

| Command | Description |
|---|---|
| `helius send broadcast <base64-tx>` | Broadcast a signed transaction and poll for confirmation |
| `helius send raw <base64-tx>` | Send a raw transaction |
| `helius send sender <base64-tx>` | Send via Helius Sender for ultra-low latency |
| `helius send poll <signature>` | Poll transaction status until confirmed |
| `helius send compute-units <base64-tx>` | Simulate and return compute unit estimate |

### WebSocket Streaming

| Command | Description |
|---|---|
| `helius ws account <address>` | Stream account change notifications |
| `helius ws logs` | Stream log notifications |
| `helius ws slot` | Stream slot notifications |
| `helius ws signature <sig>` | Stream signature confirmation |
| `helius ws program <program-id>` | Stream program account change notifications |

### SIMDs

| Command | Description |
|---|---|
| `helius simd list` | List all SIMD proposals |
| `helius simd get <number>` | Read a specific SIMD |

## Global Options

All commands accept:

| Option | Description |
|---|---|
| `--api-key <key>` | Override the configured API key |
| `--network <net>` | Network: `mainnet` or `devnet` (default: `mainnet`) |
| `--json` | Output in JSON format (machine-readable) |

Keypair commands (`signup`, `login`, `upgrade`, `pay`, `stake`) also accept:

| Option | Description |
|---|---|
| `-k, --keypair <path>` | Path to Solana keypair file (default: `~/.helius/keypair.json`) |

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General error |
| 10 | Not logged in |
| 11 | Keypair not found |
| 20 | Insufficient SOL |
| 21 | Insufficient USDC |
| 30 | No projects found |
| 31 | Project not found |
| 40 | API error |

## Development

This package lives inside the [core-ai monorepo](https://github.com/helius-labs/core-ai):

```bash
git clone https://github.com/helius-labs/core-ai
cd core-ai/helius-cli
pnpm install
pnpm dev keygen   # Run a command in watch mode
pnpm build        # Compile TypeScript → dist/
```

## License

MIT
