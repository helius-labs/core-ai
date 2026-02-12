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

## Tools (46)

**Config (2):** setHeliusApiKey, getHeliusApiKeyStatus

**DAS API (12):** getAsset, getAssetBatch, getAssetsByOwner, getAssetsByGroup, getAssetsByCreator, getAssetsByAuthority, searchAssets, getAssetProof, getAssetProofBatch, getSignaturesForAsset, getNftEditions, getTokenAccounts

**RPC (7):** getBalance, getTokenBalances, getAccountInfo, getProgramAccounts, getNetworkStatus, getBlock, getTokenHolders

**Transactions (2):** parseTransactions, getTransactionHistory

**Priority Fees (1):** getPriorityFeeEstimate

**Webhooks (5):** getAllWebhooks, getWebhookByID, createWebhook, updateWebhook, deleteWebhook

**Enhanced WebSockets (3):** transactionSubscribe, accountSubscribe, getEnhancedWebSocketInfo

**Laserstream gRPC (2):** laserstreamSubscribe, getLaserstreamInfo

**Wallet API (6):** getWalletIdentity, batchWalletIdentity, getWalletBalances, getWalletHistory, getWalletTransfers, getWalletFundedBy

**Guides (6):** getRateLimitInfo, getSenderInfo, getWebhookGuide, troubleshootError, getLatencyComparison, getPumpFunGuide

**Documentation (3):** lookupHeliusDocs, listHeliusDocTopics, getHeliusCreditsInfo

## Networks

Mainnet and Devnet. Set via `HELIUS_NETWORK` env var or use the `network` parameter in `setHeliusApiKey`.

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## Docs

- [Helius API](https://docs.helius.dev)
- [Enhanced WebSockets](https://docs.helius.dev/enhanced-websockets)
- [Laserstream](https://docs.helius.dev/laserstream)
