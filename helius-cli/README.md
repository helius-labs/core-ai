# Helius CLI

Official command-line interface for [Helius](https://helius.dev) — the leading Solana RPC and API provider. Built for developers and LLM agents.

## v1.3.0 migration notes

Every `--json` response is now wrapped in a uniform envelope. **This is a breaking change** for consumers parsing the pre-1.3 shapes, but is shipped as a minor bump — confirm your integrations before upgrading.

Two breakage axes:

1. **Top-level shape changed.** Success output is wrapped in `{ ok: true, v: 1, data }`. Error output is wrapped in `{ ok: false, v: 1, error_code, category, error, recoverable, suggestion?, details? }`. Error field renames: `error → error_code`, `message → error`, `retryable → recoverable`, `guidance → suggestion`.
2. **Caller-supplied error details are now nested under `details`.** Commands that previously spread extra fields inline on errors (e.g. `{ ..., projects: [...] }` from `apikeys` on `MULTIPLE_PROJECTS`) now put them under `response.details.projects`.

See [Output Format](#output-format) for the full contract. Streaming commands (`helius ws ...`) are unchanged — they emit line-delimited `{ event, timestamp, data }` events, not envelopes.

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

The default flow returns a hosted-checkout link. Open it in a browser, pay USDC, then resume the CLI to provision your API key.

```bash
# 1. Generate a keypair (auto-runs on first signup if missing)
helius keygen

# 2. Start signup — prints a payment URL and exits.
helius signup --email you@example.com --first-name Jane --last-name Doe

# 3. Open the URL in a browser, pay USDC. Then back in the terminal:
helius signup --resume

# 4. Start querying
helius balance <wallet-address>
helius tx parse <signature>
```

Default plan: `agent` — $10 USDC one-time, 1,000,000 starting credits. Pass `--plan developer` ($49/mo), `--plan business` ($499/mo), or `--plan professional` ($999/mo) for subscription tiers (with optional `--period yearly`).

#### Auto-pay (CLI keypair pays for itself)

Skip the browser — let the CLI keypair send USDC + memo directly to the treasury and poll activation:

```bash
helius signup --pay --email you@example.com --first-name Jane --last-name Doe
```

The wallet needs ~0.001 SOL for fees and the plan amount in USDC. On poll timeout the CLI prints `PENDING` with the `txSignature` so you can resume later.

#### Pending intent reuse

Re-running `helius signup` after starting a signup re-prints the same payment link — no duplicate intents are created. To start over, pass `--restart`. To keep polling without sending another USDC tx, pass `--resume` (does not load the keypair, does not require contact args).

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
| `helius signup` | Create a Helius account via crypto checkout (default: agent $10 one-time; `--pay` for autopay, `--resume` to finish) |
| `helius login` | Authenticate with an existing wallet |
| `helius upgrade --plan <name>` | Upgrade to a paid plan |
| `helius pay <payment-intent-id>` | Pay a renewal or pending payment intent |
| `helius projects` | List all projects |
| `helius project [id]` | Get project details |
| `helius apikeys [project-id]` | List API keys |
| `helius apikeys create [project-id]` | Create a new API key |
| `helius usage [project-id]` | Show credits usage |
| `helius status` | Show account status: plan, credits, billing cycle |
| `helius plans` | List available Helius plans and pricing |
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
| `helius wallet identity <address-or-domain>` | Look up wallet identity (address or SNS/ANS domain) |
| `helius wallet identity-batch <entries...>` | Look up identities for multiple wallets (addresses and/or domains) |
| `helius wallet balances <address>` | Get all token balances with USD values |
| `helius wallet balance-at <address>` | Get historical balance of a token (or SOL) at a past time, datetime, or slot |
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

## NO_DNA Support

Helius CLI supports the [NO_DNA](https://no-dna.org) convention. When the `NO_DNA` environment variable is set, the CLI adapts its behavior for non-human callers:
- **Spinners suppressed** — no terminal animations polluting agent output
- **Interactive prompts return preview** — commands that require confirmation (`upgrade`, `pay`) exit with a JSON preview instead of hanging on stdin; pass `--yes` to skip confirmation

## Exit Codes

| Code | Meaning | Retryable |
|---|---|---|
| 0 | Success | — |
| 1 | General error | — |
| 10 | Not logged in | No |
| 11 | Keypair not found | No |
| 20 | Insufficient SOL | No |
| 21 | Insufficient USDC | No |
| 30 | No projects found | No |
| 31 | Project not found | No |
| 40 | API error | No |
| 50 | No API key configured | No |
| 52 | Invalid address | No |
| 53 | Invalid input (HTTP 400) | No |
| 54 | Invalid API key (HTTP 401/403) | No |
| 55 | Not found (HTTP 404) | No |
| 56 | Rate limited (HTTP 429) | **Yes** |
| 57 | Server error (HTTP 5xx) | **Yes** |
| 58 | Network error (connection failed) | **Yes** |

All `--json` error envelopes include a `recoverable` field (same meaning as the pre-1.3 `retryable`).

## Output Format

When `--json` is passed, every single-response command emits a uniform envelope on `stdout` (both success and failure), so `helius <cmd> --json | jq '.ok'` works the same for either outcome. Human-mode errors continue to print to `stderr` via spinners and `console.error`.

### Success

```json
{
  "ok": true,
  "v": 1,
  "data": { "address": "...", "lamports": 12345, "sol": 0.000012345, "network": "mainnet" }
}
```

`data` holds whatever the command previously emitted at the top level.

### Error

```json
{
  "ok": false,
  "v": 1,
  "error_code": "MULTIPLE_PROJECTS",
  "category": "project",
  "error": "Multiple projects found — specify one with --project <id>.",
  "recoverable": false,
  "suggestion": "Specify a project ID. Run `helius projects` to list them.",
  "details": { "projects": [{ "id": "...", "name": "..." }] }
}
```

Fields:

- `ok` — `true` on success, `false` on failure. Always present.
- `v` — envelope schema version. Always `1` in this release. Branch on this for forward compatibility.
- `data` (success only) — the command's payload.
- `error_code` (error only) — stable machine identifier (e.g. `INVALID_API_KEY`, `RATE_LIMITED`). Safe to `switch` on.
- `category` (error only) — coarse bucket; one of: `success`, `general`, `auth`, `payment`, `project`, `api`, `sdk`, `validation`, `not_found`, `rate_limit`, `server`, `network`. Use this when you want to group errors without enumerating every code.
- `error` (error only) — human-readable message.
- `recoverable` (error only) — `true` if retrying may succeed (rate limits, transient 5xx, network). `false` for permanent errors like invalid address or invalid API key.
- `suggestion` (error only, always present) — a short actionable next step for the given error code.
- `details` (error only, optional) — extra structured context (e.g. `projects` list for `MULTIPLE_PROJECTS`, `missing` array for `INSUFFICIENT_FUNDS`). Under `--debug`, also includes a `stack` field for unclassified errors.

Envelope keys are intentionally `snake_case` (`error_code`, not `errorCode`) for ergonomic shell use — `jq '.error_code'` reads naturally. Internal TypeScript names elsewhere in the codebase still use `camelCase`.

TypeScript consumers can import the envelope types from the installed package:

```ts
import type { Envelope, SuccessEnvelope, ErrorEnvelope, Category } from "helius-cli/dist/lib/output.js";
```

### Streaming exception

`helius ws <subcommand> --json` emits line-delimited events of the form `{ event, timestamp, data }` and does **not** use the envelope. A consumer that calls `JSON.parse(line).ok` on a streaming line gets `undefined`, which is the tell that it's an event, not a single response. Validation errors from `ws` commands (e.g. bad pubkey) still use the envelope.

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
