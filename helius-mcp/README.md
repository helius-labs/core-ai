# Helius MCP Server

MCP server for Helius — Solana blockchain data access for AI assistants, provided by Solana's fastest, most reliable infrastructure provider

## Quick Start

### 1. Add the MCP server

```bash
claude mcp add helius npx helius-mcp@latest
```

### 2. Configure your API key

**If you already have a Helius API key:**

```bash
export HELIUS_API_KEY=your-api-key
```

Or set it inside Claude by calling the `setHeliusApiKey` tool.

**If you need a new account:**

The MCP includes a fully autonomous signup flow — no browser needed:

1. Call the `generateKeypair` tool — it creates a Solana wallet and returns the address
2. Fund the wallet with **~0.001 SOL** (transaction fees) + **1 USDC** (basic plan costs $1)
3. Call `checkSignupBalance` to verify funds arrived
4. Call `agenticSignup` to create your account — API key is configured automatically

Or do the same from the terminal:

```bash
npx helius-cli@latest keygen     # Generate keypair
# Fund the wallet address shown above with ~0.001 SOL + 1 USDC
npx helius-cli@latest signup      # Verify balance + create account
```

### 3. Start using tools

Ask questions in plain English — the right tool is selected automatically:

- "What NFTs does this wallet own?"
- "Parse this transaction: 5abc..."
- "Get the balance of Gh9ZwEm..."
- "Create a webhook for \<address\>"

## Tools

**Onboarding:** getStarted, setHeliusApiKey, generateKeypair, checkSignupBalance, agenticSignup, getAccountStatus

**DAS API (12):** getAsset, getAssetBatch, getAssetsByOwner, getAssetsByGroup, getAssetsByCreator, getAssetsByAuthority, searchAssets, getAssetProof, getAssetProofBatch, getSignaturesForAsset, getNftEditions, getTokenAccounts

**RPC (4):** getBalance, getAccountInfo, getMultipleAccounts, getSignaturesForAddress

**Transactions (1):** parseTransactions

**Transfers (2):** transferSol, transferToken

**Priority Fees (1):** getPriorityFeeEstimate

**Webhooks (5):** getAllWebhooks, getWebhookByID, createWebhook, updateWebhook, deleteWebhook

**Enhanced WebSockets (3):** transactionSubscribe, accountSubscribe, getEnhancedWebSocketInfo

**Laserstream gRPC (2):** laserstreamSubscribe, getLaserstreamInfo

**Wallet (6):** getWalletIdentity, batchWalletIdentity, getWalletBalances, getWalletHistory, getWalletTransfers, getWalletFundedBy

**Plans & Billing:** getHeliusPlanInfo, compareHeliusPlans, previewUpgrade, upgradePlan, payRenewal

**Docs & Guides:** lookupHeliusDocs, listHeliusDocTopics, getHeliusCreditsInfo, getRateLimitInfo, troubleshootError, getSenderInfo, getWebhookGuide, getLatencyComparison, getPumpFunGuide

## Networks

Mainnet Beta (default) and Devnet. Set via `HELIUS_NETWORK` env var or `setNetwork` in the session

## Related Resources

- [Full Documentation](https://www.helius.dev/docs)
- [LLM-Optimized Docs](https://www.helius.dev/docs/llms.txt)
- [API Reference](https://www.helius.dev/docs/api-reference)
- [Billing and Credits](https://www.helius.dev/docs/billing/credits.md)
- [Rate Limits](https://www.helius.dev/docs/billing/rate-limits.md)
- [Dashboard](https://dashboard.helius.dev)
- [Status Page](https://helius.statuspage.io)
- [Full Agent Signup Instructions](https://dashboard.helius.dev/agents.md)
