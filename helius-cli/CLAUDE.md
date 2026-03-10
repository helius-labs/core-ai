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
    plans.ts           # list available plans and pricing
    status.ts          # account status: plan, credits, billing cycle
    ...
  lib/
    helius.ts          # SDK client wrapper — resolveApiKey(), getClient(), restRequest(), HeliusHttpError
    formatters.ts      # formatSol(), formatAddress(), formatTimestamp(), formatTable()
    config.ts          # ~/.helius-cli/config.json — jwt, apiKey, network, projectId
    output.ts          # ExitCode enum, classifyError(), handleCommandError(), outputJson(), exitWithError()
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
6. Error: use `handleCommandError(error, options, spinner)` — classifies the error, emits JSON or spinner output, and exits with the classified exit code

Standard catch block template (all commands except `ws.ts`):
```ts
} catch (error) {
  handleCommandError(error, options, spinner);
}
```

`handleCommandError()` in `src/lib/output.ts` calls `classifyError()` internally, formats JSON or spinner output (with retryable hint), and exits with the classified exit code. All error output logic lives in this single function — do not duplicate it inline. Payment-specific errors (Insufficient SOL/USDC, Checkout failed/expired/timeout) are classified via keyword matching in `classifyError()`.

WebSocket commands (`ws.ts`) use a variant that preserves the AbortError early-return and uses `console.error` instead of spinner.

## API Key Resolution Chain

1. `--api-key <key>` CLI flag
2. `HELIUS_API_KEY` environment variable
3. `~/.helius-cli/config.json` → `apiKey` field
4. Auto-resolve from JWT: fetch project details → first API key

## Exit Code Ranges

- 0: success
- 1: general error
- 10-19: auth errors (NOT_LOGGED_IN=10, KEYPAIR_NOT_FOUND=11, AUTH_FAILED=12)
- 20-29: balance/payment errors (INSUFFICIENT_SOL=20, INSUFFICIENT_USDC=21, PAYMENT_FAILED=22)
- 30-39: project errors (NO_PROJECTS=30, PROJECT_NOT_FOUND=31, MULTIPLE_PROJECTS=32, PROJECT_EXISTS=33)
- 40-49: API errors (API_ERROR=40, NO_API_KEYS=41)
- 50-59: SDK/data errors:
  - 50 `NO_API_KEY` — resolveApiKey() found nothing; permanent, fix config
  - 51 `SDK_ERROR` — unclassified SDK error
  - 52 `INVALID_ADDRESS` — bad base58/pubkey format; permanent
  - 53 `INVALID_INPUT` — bad parameters or HTTP 400; permanent
  - 54 `INVALID_API_KEY` — HTTP 401/403 or "invalid api key"; permanent, fix the key
  - 55 `NOT_FOUND` — HTTP 404 or resource not found; permanent
  - 56 `RATE_LIMITED` — HTTP 429 or rate limit message; **transient, safe to retry**
  - 57 `SERVER_ERROR` — HTTP 5xx or server error message; **transient, safe to retry**
  - 58 `NETWORK_ERROR` — ECONNREFUSED/ETIMEDOUT/fetch failed; **transient, safe to retry**

The `retryable` field in `--json` error output reflects this directly.

## Error Classification

`classifyError(error)` in `src/lib/output.ts` returns `{ exitCode, errorCode, retryable }` using three tiers:

1. **`HeliusHttpError`** (from `restRequest()` — wallet.ts REST path): exact `status` property → precise code
2. **Status in message** (enhanced TX: `"Helius HTTP 429: ..."`, webhooks: `"HTTP error! status: 429 - ..."`): regex extracts status → same mapping
3. **Keyword matching** (RPC caller path — DAS, ZK, staking, raw, payment): matches phrases like `"insufficient sol"`, `"insufficient usdc"`, `"checkout failed"`, `"invalid api key"`, `"rate limit"`, `"not found"`, `"ECONNREFUSED"`, `SyntaxError`, etc.

`restRequest()` throws `HeliusHttpError` (defined in `src/lib/helius.ts`) so the REST path always hits Tier 1. The SDK paths hit Tier 2 or 3 depending on the client.

`exitWithError()` (used by auth/project commands) also includes `retryable` in JSON output automatically.

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
4. Use `handleCommandError(error, options, spinner)` in the catch block — import from `../lib/output.js`
5. Register in `bin/helius.ts` with Commander.js
6. Run `pnpm build` and verify
