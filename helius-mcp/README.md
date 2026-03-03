# Helius MCP Server

MCP server for Helius — Solana blockchain data access for AI assistants, provided by Solana's fastest, most reliable infrastructure provider

See the [CHANGELOG](https://github.com/helius-labs/core-ai/blob/main/helius-mcp/CHANGELOG.md) for version history and release notes.

Interested in contributing? Read the [contribution guide](https://github.com/helius-labs/core-ai/blob/main/helius-mcp/CONTRIBUTING.md) before opening a PR.

## Quick Start

### 1. Add the MCP server

Add to your MCP host's config (works with Claude, Cursor, Windsurf, and any MCP-compatible client):

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

Or if you're using Claude Code:

```bash
claude mcp add helius npx helius-mcp@latest
```

### 2. Configure your API key

**If you already have a Helius API key:**

```bash
export HELIUS_API_KEY=your-api-key
```

Or set it from your AI assistant by calling the `setHeliusApiKey` tool.

**If you need a new account:**

The MCP includes a fully autonomous signup flow — no browser needed:

1. Call the `generateKeypair` tool — it creates a Solana wallet and returns the address
2. Fund the wallet with **~0.001 SOL** (transaction fees) + **1 USDC** (basic plan costs $1)
3. Call `checkSignupBalance` to verify funds arrived
4. Call `agenticSignup` to create your account — API key is configured automatically

> **Paid plans (developer/business/professional):** `agenticSignup` and `upgradePlan` require `email`, `firstName`, and `lastName`. Basic plan does not.

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

**Onboarding (6):** getStarted, setHeliusApiKey, generateKeypair, checkSignupBalance, agenticSignup, getAccountStatus

**DAS API (9):** getAsset (single + batch), getAssetsByOwner, getAssetsByGroup, searchAssets (routes getAssetsByCreator / getAssetsByAuthority), getAssetProof, getAssetProofBatch, getSignaturesForAsset, getNftEditions, getTokenAccounts

**RPC (5):** getBalance, getTokenBalances, getAccountInfo (single + batch), getNetworkStatus, getBlock

**Transactions (2):** parseTransactions, getTransactionHistory

**Transfers (2):** transferSol, transferToken

**Priority Fees (1):** getPriorityFeeEstimate

**Tokens (2):** getTokenHolders, getProgramAccounts

**Webhooks (5):** getAllWebhooks, getWebhookByID, createWebhook, updateWebhook, deleteWebhook

**Enhanced WebSockets (3):** transactionSubscribe, accountSubscribe, getEnhancedWebSocketInfo

**Laserstream gRPC (2):** laserstreamSubscribe, getLaserstreamInfo

**Wallet (6):** getWalletIdentity, batchWalletIdentity, getWalletBalances, getWalletHistory, getWalletTransfers, getWalletFundedBy

**Plans & Billing (5):** getHeliusPlanInfo, compareHeliusPlans, previewUpgrade, upgradePlan, payRenewal

**Docs & Guides (10):** lookupHeliusDocs, listHeliusDocTopics, getHeliusCreditsInfo, getRateLimitInfo, troubleshootError, getSenderInfo, getWebhookGuide, getLatencyComparison, getPumpFunGuide, recommendStack

**Solana Knowledge (5):** getSIMD, listSIMDs, searchSolanaDocs, readSolanaSourceFile, fetchHeliusBlog

## System Prompts

This package ships with pre-built system prompts that teach AI models how to use Helius tools effectively. Find them in `system-prompts/`:

```
system-prompts/
├── helius/              # Core Helius skill
├── helius-dflow/        # DFlow trading skill
├── helius-phantom/      # Phantom frontend skill
└── svm/                 # SVM architecture skill
```

Each contains three variants:
- `openai.developer.md` — for OpenAI Responses/Chat Completions API (`developer` message)
- `claude.system.md` — for Claude API (system prompt)
- `full.md` — self-contained with all references inlined (Cursor Rules, ChatGPT, etc.)

See [`helius-skills/SYSTEM-PROMPTS.md`](https://github.com/helius-labs/core-ai/blob/main/helius-skills/SYSTEM-PROMPTS.md) for integration guides and code examples.

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
