# Helius Plugin for Claude Code

Build on Solana with Helius — one install gives you live blockchain tools and expert coding patterns.

## Install

### From a marketplace

```
/plugin marketplace add anthropics/claude-plugins-community
/plugin install helius@claude-community
```

Or install directly from source:

```
/plugin marketplace add helius-labs/core-ai
/plugin install helius@helius-labs
```

### Local testing

```bash
claude --plugin-dir ./helius-plugin
```

## What's included

**Helius MCP Server** — auto-starts with the plugin. Exposes 10 public tools total: 9 routed domain tools plus `expandResult`. Domain tools take Helius action names via `action`, and heavy responses are summary-first.

**DFlow MCP Server** — *optional, not bundled.* Tools for querying DFlow API details, response schemas, and code examples for trading integrations. The DFlow skill works without it. It is a third-party hosted connector and is not in the Anthropic MCP connector directory; setup instructions live at [pond.dflow.net/build/mcp](https://pond.dflow.net/build/mcp).

**Build skill** (`/helius:build`) — makes Claude an expert Solana developer. Includes routing logic, correct SDK patterns, reference files for every Helius product, and rules that prevent common mistakes (hardcoded fees, wrong endpoints, missing Jito tips).

**DFlow trading skill** (`/helius:dflow`) — makes Claude an expert at building Solana trading applications. Combines DFlow's trading APIs (spot swaps, prediction markets, real-time streaming, Proof KYC) with Helius infrastructure (Sender, priority fees, DAS, WebSockets, LaserStream, Wallet API).

**Phantom frontend skill** (`/helius:phantom`) — makes Claude an expert at building frontend Solana dApps with Phantom Connect SDK (`@phantom/react-sdk`, `@phantom/browser-sdk`, `@phantom/react-native-sdk`). Covers wallet connection (React, React Native, vanilla JS), transaction signing via Helius Sender, API key proxying, token gating, NFT minting, crypto payments, real-time updates, and secure frontend architecture.

**Jupiter DeFi skill** (`/helius:jupiter`) — makes Claude an expert at building Solana DeFi applications combining Jupiter's APIs with Helius infrastructure. Covers token swaps (Swap API V2), lending/borrowing (Lend protocol), limit orders (Trigger), DCA (Recurring), token and price data, perps/prediction markets, the Jupiter Plugin and Portal, plus transaction submission via Sender, fee optimization, real-time streaming, and wallet intelligence.

**OKX integration skill** (`/helius:okx`) — teaches Claude how to compose OKX's DEX aggregation and market data tools with Helius's Solana infrastructure. Integration-only layer (install the `onchainos-skills` library separately) covering swaps, token discovery, trending rankings, smart money signals, meme token analysis, and portfolio intelligence.

**SVM architecture skill** (`/helius:svm`) — makes Claude a Solana protocol expert. Covers the SVM execution engine, account model, consensus, transactions, validator economics, data layer, development tooling, and token extensions — sourced from the Helius blog, SIMDs, and Agave/Firedancer source. Use this for the "how" and "why" of Solana, not for building with APIs.

**Reference files** — deep documentation for DAS API, Sender, Priority Fees, Webhooks, WebSockets, Laserstream, Wallet API, Enhanced Transactions, Onboarding, DFlow spot trading, prediction markets, WebSocket streaming, Proof KYC, Phantom React/Browser/React Native SDKs, Jupiter swap/lend/trigger/recurring/tokens-price/perps-predictions/plugin/portal, transactions, token gating, NFT minting, payments, frontend security, SVM compilation/programs/execution/accounts/transactions/consensus/validators/data/development/tokens, and integration patterns.

## Usage

Once installed, just ask questions in plain English:

- "Build a swap interface using DFlow and Helius Sender"
- "What NFTs does this wallet own?"
- "Set up webhooks to monitor my wallet for incoming transfers"
- "Parse this transaction: 5abc..."
- "Build a portfolio tracker with real-time updates"
- "Quote and execute a Jupiter swap, then land it via Helius Sender"
- "Explain how Solana's transaction scheduler works"

Claude picks the right tools and reads the right reference files automatically.

## API Key Setup

The plugin auto-starts the MCP server, but you still need a Helius API key. On first use, Claude will guide you through one of these paths:

- **Existing key**: Use the `setHeliusApiKey` tool with your key from https://dashboard.helius.dev
- **New account**: `generateKeypair` → `signup` with `mode: "link"` (browser pay) or `mode: "autopay"` (pay USDC from local keypair) → after browser payment, `signup` with `mode: "resume"`
- **CLI**: `npx helius-cli@latest keygen` → fund → `npx helius-cli@latest signup`

## Not Using Claude Code?

See [`.agents/skills/`](https://github.com/helius-labs/core-ai/tree/main/.agents/skills) for Codex-native skills, or [`helius-mcp/system-prompts/`](https://github.com/helius-labs/core-ai/tree/main/helius-mcp/system-prompts) for generated prompt files compatible with OpenAI API, Claude API, Cursor, and other tools. See [`helius-skills/SYSTEM-PROMPTS.md`](https://github.com/helius-labs/core-ai/blob/main/helius-skills/SYSTEM-PROMPTS.md) for integration guides.

## Links

- [Helius Documentation](https://www.helius.dev/docs)
- [Dashboard](https://dashboard.helius.dev)
- [helius-mcp on npm](https://www.npmjs.com/package/helius-mcp)
