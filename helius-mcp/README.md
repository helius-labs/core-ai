# Helius MCP Server

MCP server for Helius - Solana blockchain data access for Claude.

## Setup

```bash
claude mcp add helius npx helius-mcp@latest
```

Set your API key:
```bash
export HELIUS_API_KEY=your-api-key
```

## Tools (29)

**DAS API (12):** getAsset, getAssetBatch, getAssetsByOwner, getAssetsByGroup, getAssetsByCreator, getAssetsByAuthority, searchAssets, getAssetProof, getAssetProofBatch, getSignaturesForAsset, getNftEditions, getTokenAccounts

**RPC (4):** getBalance, getAccountInfo, getMultipleAccounts, getSignaturesForAddress

**Transactions (1):** parseTransactions

**Priority Fees (1):** getPriorityFeeEstimate

**Webhooks (5):** getAllWebhooks, getWebhookByID, createWebhook, updateWebhook, deleteWebhook

**Enhanced WebSockets (3):** transactionSubscribe, accountSubscribe, getEnhancedWebSocketInfo

**Laserstream gRPC (2):** laserstreamSubscribe, getLaserstreamInfo

**Config (1):** setHeliusApiKey

## Networks

Mainnet Beta and Devnet. Set via `HELIUS_NETWORK` env var.

## Docs

- [Helius API](https://docs.helius.dev)
- [Enhanced WebSockets](https://docs.helius.dev/enhanced-websockets)
- [Laserstream](https://docs.helius.dev/laserstream)
