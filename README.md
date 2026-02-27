# Helius Core AI

Official AI-native tooling for [Helius](https://helius.dev) - the leading Solana RPC and API provider. This monorepo contains two complementary interfaces for Solana blockchain access:

| Package | Version | Purpose | Interface |
|---------|---------|---------|-----------|
| **[helius-mcp](./helius-mcp)** | 0.3.0 | MCP server exposing 46 Solana tools to AI assistants | Claude / LLM agents |
| **[helius-cli](./helius-cli)** | 1.0.1 | Command-line interface with 70+ commands | Terminal / shell agents |

Both packages share the same Helius SDK, configuration directory (`~/.helius/`), and authentication flow. An agent can use the MCP server for native tool calling or shell out to the CLI for scripted workflows.

## Quick Start

### MCP Server (for Claude / AI agents)

```bash
# Add to Claude Code
claude mcp add helius npx helius-mcp@latest

# Set API key (env var or use the setHeliusApiKey tool at runtime)
export HELIUS_API_KEY=your-api-key
```

The server exposes 46 tools via stdio transport. No build step needed when using `npx`.

### CLI (for terminal / shell agents)

```bash
npm install -g helius-cli

# Generate keypair, fund it, create account
helius keygen
# Fund the address with ~0.001 SOL + 1 USDC
helius signup
helius apikeys <project-id>

# Query the chain
helius balance <address>
helius tx parse <signature>
helius asset owner <wallet>
```

All CLI commands support `--json` for machine-readable output and return structured exit codes (0-58).

## Architecture

```
                  ┌──────────────────────────┐
                  │   Claude / LLM Agent      │
                  └─────┬──────────┬──────────┘
                        │          │
              MCP stdio │          │ shell exec
                        │          │
               ┌────────▼──┐  ┌───▼──────────┐
               │ helius-mcp │  │  helius-cli   │
               │ 46 tools   │  │  70+ commands │
               └────────┬──┘  └───┬──────────┘
                        │          │
                        └────┬─────┘
                             │
                    ┌────────▼────────┐
                    │   helius-sdk    │
                    │   + REST calls  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
        │  DAS API   │ │ Solana RPC│ │ Wallet API│
        │  Webhooks  │ │ WebSocket │ │ Laserstream│
        └───────────┘ └───────────┘ └───────────┘
                             │
                    ┌────────▼────────┐
                    │  Solana Network  │
                    │ mainnet / devnet │
                    └─────────────────┘
```

## For Agents

This section provides structured reference data optimized for LLM tool selection and error handling.

### MCP Tools (46)

| Category | Tools | Credits |
|----------|-------|---------|
| **Config** | `setHeliusApiKey`, `setNetwork`, `getHeliusConfig` | 0 |
| **Auth** | `generateKeypair`, `checkSignupBalance`, `agenticSignup`, `getCheckoutPreview`, `listPlans` | 0-100 |
| **Balance** | `getBalance`, `getTokenBalances` | 1 each |
| **DAS API** | `getAsset`, `getAssetBatch`, `getAssetsByOwner`, `getAssetsByGroup`, `getAssetsByCreator`, `getAssetsByAuthority`, `searchAssets`, `getAssetProof`, `getAssetProofBatch`, `getSignaturesForAsset`, `getNftEditions`, `getTokenAccounts` | 10 each |
| **Transactions** | `parseTransactions` | 10/tx |
| **RPC** | `getAccountInfo`, `getMultipleAccounts`, `getSignaturesForAddress`, `getAccountStatus` | 1 each |
| **Fees** | `getPriorityFeeEstimate` | 1 |
| **Network** | `getNetworkStatus` | 3 |
| **Blocks** | `getBlock` | 1 |
| **Tokens** | `getTokenSupply`, `getTokenLargestAccounts` | 1 each |
| **Wallet** | `getWalletBalances`, `getWalletHistory`, `getWalletIdentity` | 100 |
| **Webhooks** | `getAllWebhooks`, `getWebhookByID`, `createWebhook`, `updateWebhook`, `deleteWebhook` | 100 each |
| **WebSockets** | `transactionSubscribe`, `accountSubscribe`, `getEnhancedWebSocketInfo` | 3/0.1MB |
| **Laserstream** | `laserstreamSubscribe`, `getLaserstreamInfo` | 3/0.1MB |
| **Plans** | `getPlanInfo`, `upgradePlan` | 0-100 |
| **Docs** | `lookupHeliusDocs`, `getHeliusCreditsInfo` | 0 |
| **Guides** | `getRateLimitInfo`, `getSenderInfo`, `troubleshootError` | 0 |

### CLI Commands (70+)

| Group | Commands | Notes |
|-------|----------|-------|
| **Account** | `keygen`, `signup`, `login`, `projects`, `project`, `apikeys`, `apikeys create`, `usage`, `rpc`, `upgrade`, `pay` | Auth requires keypair |
| **Config** | `config show`, `config set-api-key`, `config set-network`, `config set-project`, `config clear` | Persists to `~/.helius/` |
| **Balance** | `balance <addr>`, `tokens <addr>`, `token-holders <mint>` | Requires API key |
| **Transactions** | `tx parse <sig...>`, `tx history <addr>`, `tx fees` | Enhanced parsing |
| **Assets (DAS)** | `asset get`, `asset batch`, `asset owner`, `asset creator`, `asset authority`, `asset collection`, `asset search`, `asset proof`, `asset proof-batch`, `asset editions`, `asset signatures`, `asset token-accounts` | 12 subcommands |
| **Account** | `account <addr>` | Raw account data |
| **Network** | `network-status` | Epoch, slot, supply |
| **Block** | `block <slot>` | Block details |
| **Wallet** | `wallet identity`, `wallet identity-batch`, `wallet balances`, `wallet history`, `wallet transfers`, `wallet funded-by` | REST API (not SDK) |
| **Webhooks** | `webhook list`, `webhook get`, `webhook create`, `webhook update`, `webhook delete` | CRUD |
| **Program** | `program accounts`, `program accounts-all`, `program token-accounts` | gPA queries |
| **Staking** | `stake create`, `stake unstake`, `stake withdraw`, `stake accounts`, `stake withdrawable`, `stake instructions`, `stake unstake-instruction`, `stake withdraw-instruction` | 8 subcommands |
| **ZK Compression** | `zk account`, `zk balance`, `zk token-balance`, `zk proof`, `zk signatures-*`, `zk tx`, `zk validity-proof`, `zk indexer-health`, ... | 24 subcommands |
| **Send** | `send broadcast`, `send raw`, `send sender`, `send poll`, `send compute-units` | TX submission |
| **WebSocket** | `ws account`, `ws logs`, `ws slot`, `ws signature`, `ws program` | Streaming (long-lived) |

### CLI Exit Codes

Agents should use these for programmatic error handling:

| Range | Category | Codes | Retryable |
|-------|----------|-------|-----------|
| 0 | Success | `SUCCESS=0` | - |
| 1 | General | `GENERAL_ERROR=1` | No |
| 10-19 | Auth | `NOT_LOGGED_IN=10`, `KEYPAIR_NOT_FOUND=11`, `AUTH_FAILED=12` | No |
| 20-29 | Payment | `INSUFFICIENT_SOL=20`, `INSUFFICIENT_USDC=21`, `PAYMENT_FAILED=22` | No |
| 30-39 | Project | `NO_PROJECTS=30`, `PROJECT_NOT_FOUND=31`, `MULTIPLE_PROJECTS=32`, `PROJECT_EXISTS=33` | No |
| 40-49 | API | `API_ERROR=40`, `NO_API_KEYS=41` | No |
| 50-55 | Data (permanent) | `NO_API_KEY=50`, `SDK_ERROR=51`, `INVALID_ADDRESS=52`, `INVALID_INPUT=53`, `INVALID_API_KEY=54`, `NOT_FOUND=55` | No |
| 56-58 | Data (transient) | `RATE_LIMITED=56`, `SERVER_ERROR=57`, `NETWORK_ERROR=58` | **Yes** |

With `--json`, error output includes a `retryable` boolean field.

### API Key Resolution

Both packages resolve API keys in the same priority order:

1. **Explicit** - CLI flag (`--api-key`) or MCP tool (`setHeliusApiKey`)
2. **Environment** - `HELIUS_API_KEY` env var
3. **Config file** - `~/.helius/config.json` `apiKey` field
4. **Auto-resolve** (CLI only) - Fetches from JWT token via management API

### Configuration

```
~/.helius/
  config.json      # { jwt, apiKey, network, projectId }
  keypair.json     # Solana keypair (64-byte array, chmod 600)
```

Both packages read/write this shared directory. Network values: `mainnet` / `devnet` (CLI), `mainnet-beta` / `devnet` (MCP).

## Repository Structure

```
core-ai/
├── .github/workflows/test.yml    # CI: build + test helius-mcp
├── helius-mcp/                   # MCP Server
│   ├── src/
│   │   ├── index.ts              # Server entry point (stdio transport)
│   │   ├── tools/                # 19 modules registering 46 tools
│   │   │   ├── index.ts          # registerTools() aggregator
│   │   │   ├── assets.ts         # DAS API (12 tools)
│   │   │   ├── transactions.ts   # Enhanced TX parsing
│   │   │   ├── auth.ts           # Signup/keypair/plans
│   │   │   ├── webhooks.ts       # Webhook CRUD
│   │   │   ├── wallet.ts         # Wallet API (REST)
│   │   │   ├── enhanced-websockets.ts
│   │   │   ├── laserstream.ts
│   │   │   └── ...
│   │   ├── utils/                # Shared utilities
│   │   │   ├── helius.ts         # SDK client, session state
│   │   │   ├── errors.ts         # Error handlers, validators
│   │   │   ├── config.ts         # ~/.helius/ config I/O
│   │   │   ├── formatters.ts     # SOL/address formatting
│   │   │   └── docs.ts           # Documentation fetching
│   │   └── types/
│   │       └── transaction-types.ts  # 138+ TX type constants
│   ├── tests/tools.test.ts       # Vitest: validates 46 tools registered
│   ├── package.json
│   └── tsconfig.json
├── helius-cli/                   # CLI Tool
│   ├── bin/helius.ts             # Entry point (Commander.js, 70+ commands)
│   ├── src/
│   │   ├── commands/             # 27 command modules
│   │   │   ├── asset.ts          # 12 DAS subcommands
│   │   │   ├── zk.ts            # 24 ZK compression subcommands
│   │   │   ├── tx.ts            # Transaction parsing/history
│   │   │   ├── wallet.ts        # Wallet API (REST)
│   │   │   ├── webhook.ts       # Webhook CRUD
│   │   │   ├── ws.ts            # WebSocket streaming
│   │   │   ├── stake.ts         # Staking (8 subcommands)
│   │   │   └── ...
│   │   ├── lib/                  # Shared utilities
│   │   │   ├── helius.ts        # SDK client, API key resolution
│   │   │   ├── output.ts        # Exit codes, error classification
│   │   │   ├── config.ts        # ~/.helius/ config management
│   │   │   ├── formatters.ts    # Terminal output formatting
│   │   │   ├── api.ts           # Helius management API
│   │   │   └── wallet.ts        # Keypair loading
│   │   └── constants.ts
│   ├── package.json
│   └── tsconfig.json
└── .gitignore
```

## Development

### Prerequisites

- Node.js 20+
- pnpm 9+

### Setup

```bash
# Clone
git clone https://github.com/helius-labs/core-ai
cd core-ai

# MCP server
cd helius-mcp
pnpm install
pnpm build        # tsc -> dist/
pnpm test         # vitest
pnpm dev          # tsc --watch

# CLI
cd ../helius-cli
pnpm install
pnpm build        # tsc -> dist/
pnpm dev          # tsx bin/helius.ts (runs directly)
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.4, ES2022 target |
| Module system | ES Modules (NodeNext) |
| MCP framework | `@modelcontextprotocol/sdk` 1.x |
| CLI framework | `commander` 12.x |
| Blockchain SDK | `helius-sdk` 2.2.x |
| Solana crypto | `@solana/kit` 5.x |
| Validation | `zod` 3.23.x |
| Testing | Vitest |
| CI | GitHub Actions (Node 20, pnpm 9) |

### Adding a New MCP Tool

1. Create or edit a file in `helius-mcp/src/tools/`
2. Export a `registerXyzTools(server: McpServer)` function
3. Register tools with `server.tool(name, description, zodSchema, handler)`
4. Call your registration function in `src/tools/index.ts`
5. Use `mcpText()` / `mcpError()` from `utils/errors.ts` for responses
6. Use `handleToolError()` with pre-built error handlers for catch blocks

### Adding a New CLI Command

1. Create `helius-cli/src/commands/mycommand.ts` exporting async handler(s)
2. Use `resolveApiKey(options)` + `getClient(apiKey, network)` from `lib/helius.ts`
3. Support `--json` via `outputJson()` and formatted chalk output
4. Use `handleCommandError(error, options, spinner)` in the catch block
5. Register in `bin/helius.ts` with Commander.js
6. Run `pnpm build` and verify

## Networks

Both packages support Solana mainnet and devnet:

| Method | Mainnet | Devnet |
|--------|---------|--------|
| Env var | `HELIUS_NETWORK=mainnet` | `HELIUS_NETWORK=devnet` |
| CLI flag | `--network mainnet` | `--network devnet` |
| MCP tool | `setNetwork("mainnet-beta")` | `setNetwork("devnet")` |
| Config | `~/.helius/config.json` | `~/.helius/config.json` |

## Links

- [Helius API Docs](https://docs.helius.dev)
- [Enhanced WebSockets](https://docs.helius.dev/enhanced-websockets)
- [Laserstream gRPC](https://docs.helius.dev/laserstream)
- [DAS API](https://docs.helius.dev/solana-compression/digital-asset-standard-das-api)

## License

MIT - see [LICENSE](./helius-mcp/LICENSE)
