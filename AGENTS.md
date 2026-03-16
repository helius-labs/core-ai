# Core AI — Agent Instructions

> This file is the Layer A harness for Codex CLI and other OpenAI-compatible agents.
> Skills in `.agents/skills/` provide the domain expertise (Layer B).

## Repository Overview

This monorepo contains Helius developer tools for building on Solana:

| Package | What it does |
|---|---|
| `helius-mcp/` | MCP server (`npx helius-mcp@latest`) — exposes 10 public tools total: 9 routed domain tools plus `expandResult` |
| `helius-skills/` | Canonical skill source — SKILL.md + reference files for each domain |
| `helius-plugin/` | Claude Code plugin — bundles skills + auto-starts MCP server |
| `helius-cli/` | CLI for account setup, blockchain queries, and staking (`npx helius-cli@latest`) |

## MCP Server Setup

The Helius MCP server provides live blockchain access through 10 public tools total: 9 routed domain tools plus `expandResult`. Configure it as an MCP tool source:

```
npx helius-mcp@latest
```

This works with any MCP-compatible client. Use a domain tool such as `heliusWallet`, `heliusAsset`, or `heliusStreaming` plus `action: "getBalance"`, `action: "getAssetsByOwner"`, or `action: "createWebhook"` to call a specific Helius action. Use `expandResult` for summary-first follow-ups.

For Codex, run `codex mcp add helius -- npx helius-mcp@latest` or add to `.codex/config.toml` (or `~/.codex/config.toml` for global):

```toml
[mcp_servers.helius]
command = "npx"
args = ["helius-mcp@latest"]
```

For other MCP clients, add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "helius": {
      "command": "npx",
      "args": ["helius-mcp@latest"]
    }
  }
}
```

## API Key Setup

Most tools require a Helius API key. Three paths:

**Path A — Existing key:** Set the `HELIUS_API_KEY` environment variable, or call the `setHeliusApiKey` MCP tool.

**Path B — Agentic signup:** Call `generateKeypair` → fund the wallet with ~0.001 SOL + 1 USDC → `checkSignupBalance` → `agenticSignup`. The API key is configured automatically.

**Path C — CLI:** `npx helius-cli@latest keygen` → fund wallet → `npx helius-cli@latest signup`

Get keys from https://dashboard.helius.dev.

## Public Tool Surface

Helius MCP exposes 10 public tools total:

- Routed domain tools: `heliusAccount`, `heliusWallet`, `heliusAsset`, `heliusTransaction`, `heliusChain`, `heliusStreaming`, `heliusKnowledge`, `heliusWrite`, `heliusCompression`
- Expansion tool: `expandResult`

The routed domain tools take a Helius action name in `action`. Example:

- `heliusWallet` + `action: "getBalance"`
- `heliusKnowledge` + `action: "getRateLimitInfo"`
- `heliusStreaming` + `action: "createWebhook"`

Heavy responses are summary-first. Use `expandResult({ resultId: "..." })` to fetch a full section, range, page, or continuation on demand.

## Skills

Skills are in `.agents/skills/`. Each provides expert routing, rules, and reference docs for a domain:

| Skill | Directory | When to use |
|---|---|---|
| **Helius** | `.agents/skills/helius/` | Building Solana apps with Helius infrastructure — transactions, DAS API, WebSockets, Laserstream, webhooks, wallet analysis |
| **Helius DFlow** | `.agents/skills/helius-dflow/` | Trading apps combining DFlow (spot swaps, prediction markets, Proof KYC) with Helius |
| **Helius Phantom** | `.agents/skills/helius-phantom/` | Frontend Solana apps with Phantom wallet + Helius — React, React Native, vanilla JS |
| **SVM** | `.agents/skills/svm/` | Solana protocol internals — SVM engine, account model, consensus, validators, token extensions |

Each skill has:
- `SKILL.md` — routing logic, rules, and domain expertise
- `references/` — deep reference docs for specific products/APIs
- `prompts/` — pre-formatted prompt variants for OpenAI API and Claude API

**Read the SKILL.md before implementing** — it tells you which reference files to read and which MCP tools to use for each type of task.

## Coding Conventions

### SDK Usage
- **TypeScript**: `import { createHelius } from "helius-sdk"` → `const helius = createHelius({ apiKey: "apiKey" })`
- **Rust**: `use helius::Helius` → `Helius::new("apiKey", Cluster::MainnetBeta)?`
- For `@solana/kit` integration, use `helius.raw` for the underlying `Rpc` client

### Environment Variables
- Never commit API keys to git — use `HELIUS_API_KEY` environment variable
- Store keys in `.env` or `.env.local` (for Next.js, never `NEXT_PUBLIC_`)

### Explorer Links
- Always use Orb (`https://orbmarkets.io`) for transaction and account links
- Transaction: `https://orbmarkets.io/tx/{signature}`
- Account: `https://orbmarkets.io/address/{address}`
- Token: `https://orbmarkets.io/token/{token}`

## MCP Tool Usage Rules

### Prefer Specific Routed Actions
- Use `heliusWallet` + `getBalance` (1 credit) over `heliusWallet` + `getWalletBalances` (100 credits) when only SOL balance is needed
- Use `heliusWallet` + `getTokenBalances` (10 credits) over `heliusWallet` + `getWalletBalances` when you don't need USD values
- Use `heliusKnowledge` + `lookupHeliusDocs` with the `section` parameter for targeted lookups — full docs can be 10,000+ tokens

### Use Batch Endpoints
- `heliusAsset` + `getAsset` accepts an `ids` array for batch lookups — one call instead of N
- `heliusAsset` + `getAssetProofBatch` for multiple compressed NFT proofs
- `heliusChain` + `getAccountInfo` accepts an `addresses` array for batch account lookups

### Transaction Sending
- Always use Helius Sender endpoints — never raw `sendTransaction` to standard RPC
- Always include `skipPreflight: true` when using Sender
- Always include `maxRetries: 0` when using Sender
- Always include a Jito tip (minimum 0.0002 SOL) and priority fee
- Use `heliusChain` + `getPriorityFeeEstimate` to get fee levels — never hardcode fees

### Data Queries
- Use `heliusTransaction` + `parseTransactions` over raw RPC for human-readable transaction data
- Use `heliusAsset` + `getAssetsByOwner` with `showFungible: true` for both NFTs and fungible tokens
- Use `heliusAsset` + `searchAssets` for multi-criteria queries instead of client-side filtering

### Errors and Docs
- Use `heliusKnowledge` + `troubleshootError` with the error code before manual diagnosis
- Use `heliusKnowledge` + `getRateLimitInfo` or `getHeliusCreditsInfo` — never guess at credit costs
- For pricing questions, start with `heliusAccount` + `getHeliusPlanInfo` — not `heliusKnowledge` + `lookupHeliusDocs`

## Agent Behavior

- Use MCP tools for live blockchain data — never hardcode or mock chain state
- Read reference files before writing code — they contain product-specific patterns and pitfalls
- Run tests and verify outputs after making changes
- Handle rate limits with exponential backoff
- Use appropriate commitment levels (`confirmed` for reads, `finalized` for critical operations)

## Generated Content

The following directories are generated by `npx tsx scripts/compile-skills.ts` from canonical sources in `helius-skills/`:

- `.agents/skills/` — Codex-native skills + prompt variants
- `helius-mcp/system-prompts/` — npm-shipped prompt copies

Do not edit these directly — modify the canonical source in `helius-skills/` and re-run the compiler.
