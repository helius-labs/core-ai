# Helius Plugin for Claude Code

Build on Solana with Helius — one install gives you live blockchain tools and expert coding patterns.

## Install

### From a marketplace

```
/plugin marketplace add helius-labs/claude-plugins
/plugin install helius@helius
```

### Local testing

```bash
claude --plugin-dir ./helius-plugin
```

## What's included

**Helius MCP Server** — auto-starts with the plugin. 40+ tools for querying the blockchain, managing webhooks, streaming data, sending transactions, and more.

**DFlow MCP Server** — auto-starts with the plugin. Tools for querying DFlow API details, response schemas, and code examples for trading integrations.

**Build skill** (`/helius:build`) — makes Claude an expert Solana developer. Includes routing logic, correct SDK patterns, reference files for every Helius product, and rules that prevent common mistakes (hardcoded fees, wrong endpoints, missing Jito tips).

**DFlow trading skill** (`/helius:dflow`) — makes Claude an expert at building Solana trading applications. Combines DFlow's trading APIs (spot swaps, prediction markets, real-time streaming, Proof KYC) with Helius infrastructure (Sender, priority fees, DAS, WebSockets, LaserStream, Wallet API).

**SVM skill** (`/helius:svm`) — makes Claude a Solana protocol expert. Covers the SVM execution engine, account model, consensus, validator economics, data layer, and token extensions using the Helius blog, SIMDs, and Agave/Firedancer source code.

**Phantom skill** (`/helius:phantom`) *(coming soon)* — makes Claude an expert at building browser-based Solana apps with Phantom wallet + Helius. Covers wallet connection, transaction signing, API key proxying, CORS handling, and secure frontend architecture.

**Reference files** — deep documentation for DAS API, Sender, Priority Fees, Webhooks, WebSockets, Laserstream, Wallet API, Enhanced Transactions, Onboarding, DFlow spot trading, prediction markets, WebSocket streaming, Proof KYC, and integration patterns.

## Usage

Once installed, just ask questions in plain English:

- "Build a swap interface using DFlow and Helius Sender"
- "What NFTs does this wallet own?"
- "Set up webhooks to monitor my wallet for incoming transfers"
- "Parse this transaction: 5abc..."
- "Build a portfolio tracker with real-time updates"

Claude picks the right tools and reads the right reference files automatically.

## API Key Setup

The plugin auto-starts the MCP server, but you still need a Helius API key. On first use, Claude will guide you through one of these paths:

- **Existing key**: Use the `setHeliusApiKey` tool with your key from https://dashboard.helius.dev
- **New account**: Autonomous signup via `generateKeypair` → fund wallet → `agenticSignup`
- **CLI**: `npx helius-cli@latest keygen` → fund → `npx helius-cli@latest signup`

## Links

- [Helius Documentation](https://www.helius.dev/docs)
- [Dashboard](https://dashboard.helius.dev)
- [helius-mcp on npm](https://www.npmjs.com/package/helius-mcp)
