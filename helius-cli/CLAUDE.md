# helius-cli

CLI tool for managing Helius accounts and querying Solana blockchain data via the Helius platform.

## Directory Structure

```
bin/helius.ts          # Entry point — Commander.js program, registers all commands
src/
  commands/            # One file per command group
    balance.ts         # balance, tokens, token-holders
    tx.ts              # tx parse, tx history, tx fees
    asset.ts           # 12 DAS API subcommands
    account.ts         # account info
    network-status.ts  # network status
    block.ts           # block by slot
    wallet.ts          # Wallet API (REST, not SDK) — identity, balances, history, transfers, funded-by
    webhook.ts         # webhook CRUD
    program.ts         # program accounts
    stake.ts           # staking commands
    zk.ts              # 24 ZK compression subcommands
    send.ts            # tx helpers (broadcast, raw, sender, poll, compute-units)
    ws.ts              # WebSocket streaming (account, logs, slot, signature, program)
    config-cmd.ts      # config show/set-api-key/set-network/set-project/clear
    signup.ts          # account signup (existing)
    login.ts           # wallet auth (existing)
    projects.ts        # list projects (existing)
    ...
  lib/
    helius.ts          # SDK client wrapper — resolveApiKey(), getClient(), restRequest()
    formatters.ts      # formatSol(), formatAddress(), formatTimestamp(), formatTable()
    config.ts          # ~/.helius-cli/config.json — jwt, apiKey, network, projectId
    output.ts          # ExitCode enum, outputJson(), exitWithError()
    api.ts             # Helius management API (signup, projects, API keys)
    payment.ts         # USDC payment for signup
    wallet.ts          # Keypair loading
  constants.ts         # VERSION, API_URL, treasury, USDC mints
```

## Command Pattern

All data commands follow this pattern:
1. Create spinner (unless `--json`)
2. Resolve API key via `resolveApiKey(options)` — flag > env > config > JWT auto-resolve
3. Get SDK client via `getClient(apiKey, network)`
4. Call SDK method
5. Output: formatted terminal (chalk) or `outputJson()` for `--json`
6. Error: `process.exit(ExitCode.SDK_ERROR)`

## API Key Resolution Chain

1. `--api-key <key>` CLI flag
2. `HELIUS_API_KEY` environment variable
3. `~/.helius-cli/config.json` → `apiKey` field
4. Auto-resolve from JWT: fetch project details → first API key

## Exit Code Ranges

- 0: success
- 1: general error
- 10-19: auth errors
- 20-29: balance/payment errors
- 30-39: project errors
- 40-49: API errors
- 50-59: SDK/data errors (NO_API_KEY=50, SDK_ERROR=51, INVALID_ADDRESS=52, NETWORK_ERROR=53)

## SDK vs REST

- **SDK (`helius-sdk`)**: DAS API, enhanced transactions, webhooks, staking, ZK compression, WebSockets, program accounts, priority fees
- **REST (`restRequest()`)**: Wallet API (`/v1/wallet/...`) — identity, balances, history, transfers, funded-by

## Build / Dev / Test

```bash
pnpm install
pnpm build          # tsc → dist/
pnpm dev            # tsx bin/helius.ts (runs directly)
node dist/bin/helius.js --help
```

## Adding a New Command

1. Create `src/commands/mycommand.ts` exporting async handler(s)
2. Use `resolveApiKey(options)` + `getClient(apiKey, network)` from `src/lib/helius.ts`
3. Support `--json` via `outputJson()` / formatted chalk output
4. Register in `bin/helius.ts` with Commander.js
5. Run `pnpm build` and verify
