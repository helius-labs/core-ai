# Helius Plugin for Cursor

Build on Solana with Helius — one install gives you live blockchain tools and expert coding patterns.

## Install

Search **"Helius"** in the Cursor Marketplace, or run `/add-plugin` in Cursor and search for Helius.

## What's included

**Helius MCP Server** — auto-starts with the plugin. 40+ tools for querying the blockchain, managing webhooks, streaming data, sending transactions, and more.

**DFlow MCP Server** — auto-starts with the plugin. Tools for querying DFlow API details, response schemas, and code examples for trading integrations.

**Build skill** — makes the agent an expert Solana developer. Includes routing logic, correct SDK patterns, reference files for every Helius product, and rules that prevent common mistakes (hardcoded fees, wrong endpoints, missing Jito tips).

**DFlow trading skill** — makes the agent an expert at building Solana trading applications. Combines DFlow's trading APIs (spot swaps, prediction markets, real-time streaming, Proof KYC) with Helius infrastructure (Sender, priority fees, DAS, WebSockets, LaserStream, Wallet API).

**Phantom frontend skill** — makes the agent an expert at building frontend Solana dApps with Phantom Connect SDK (`@phantom/react-sdk`, `@phantom/browser-sdk`, `@phantom/react-native-sdk`). Covers wallet connection (React, React Native, vanilla JS), transaction signing via Helius Sender, API key proxying, token gating, NFT minting, crypto payments, real-time updates, and secure frontend architecture.

**SVM skill** — makes the agent a Solana protocol expert. Covers the SVM execution engine, account model, consensus, transactions, validator economics, data layer, and token extensions using the Helius blog, SIMDs, and Agave/Firedancer source code.

**Rules** — persistent best practices injected into every session: API key safety, transaction submission via Sender, priority fees and Jito tips, and Orb explorer links.

**Reference files** — deep documentation for DAS API, Sender, Priority Fees, Webhooks, WebSockets, Laserstream, Wallet API, Enhanced Transactions, Onboarding, DFlow spot trading, prediction markets, WebSocket streaming, Proof KYC, Phantom React/Browser/React Native SDKs, transactions, token gating, NFT minting, payments, frontend security, and integration patterns.

## Usage

Once installed, just ask questions in plain English:

- "Build a swap interface using DFlow and Helius Sender"
- "What NFTs does this wallet own?"
- "Set up webhooks to monitor my wallet for incoming transfers"
- "Parse this transaction: 5abc..."
- "Build a portfolio tracker with real-time updates"
- "Explain how Solana's Tower BFT works and show code examples"

The agent picks the right tools and reads the right reference files automatically.

## API Key Setup

The plugin auto-starts the MCP server, but you still need a Helius API key. On first use, the agent will guide you through one of these paths:

- **Existing key**: Use the `setHeliusApiKey` tool with your key from https://dashboard.helius.dev
- **New account**: Autonomous signup via `generateKeypair` → fund wallet → `agenticSignup`
- **CLI**: `npx helius-cli@latest keygen` → fund → `npx helius-cli@latest signup`

## Links

- [Helius Documentation](https://www.helius.dev/docs)
- [Dashboard](https://dashboard.helius.dev)
- [helius-mcp on npm](https://www.npmjs.com/package/helius-mcp)
- [DFlow Documentation](https://pond.dflow.net/introduction)
