#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools/index.js';
import { setApiKey, setSessionSecretKey, setSessionWalletAddress } from './utils/helius.js';
import { getSharedApiKey, loadKeypairFromDisk } from './utils/config.js';
import { loadKeypair } from 'helius-sdk/auth/loadKeypair';
import { getAddress } from 'helius-sdk/auth/getAddress';

const server = new McpServer(
  {
    name: 'helius-mcp',
    version: '0.3.0'
  },
  {
    instructions: `These instructions provide fallback tool selection guidance. If you have more specific routing instructions from a Helius skill or system prompt, prefer those over this guide — they provide richer context including reference files and composition patterns.

## Tool Selection Guide

### Balance / Portfolio
- "SOL balance" → getBalance (1 credit, SOL only)
- "token balances", "what tokens" → getTokenBalances (10 credits/page, SPL tokens with prices)
- "portfolio", "all balances", "show my wallet", "what's in this wallet" → getWalletBalances (100 credits, full portfolio with USD values sorted by value, includes SOL + tokens + optional NFTs)

### Transaction History
- Parse specific transaction(s) by signature → parseTransactions (100 credits)
- "show transactions", "transaction history", general history → getTransactionHistory (default choice, parsed human-readable, ~110 credits)
- "balance changes per transaction", "+/- deltas" → getWalletHistory (100 credits, balance change deltas)
- "who sent tokens to", "transfers", "sends/receives" → getWalletTransfers (100 credits, direction + counterparty info)

### NFTs & Assets
- Specific mint address → getAsset (by mint, 10 credits)
- "NFTs in this wallet", "what NFTs" → getAssetsByOwner (by wallet, 10 credits)
- Multi-filter search (creator, authority, name, compression) → searchAssets (10 credits)
- "NFTs in this collection" → getAssetsByGroup (by collection, 10 credits)
- Transaction history for a specific asset (by mint) → getSignaturesForAsset (10 credits)
- Edition prints of a master NFT → getNftEditions (10 credits)

### Accounts & Tokens
- Raw account inspection (owner program, data, executable) → getAccountInfo (1 credit)
- "token holders", "who holds this token" → getTokenHolders (20 credits, top 20 by mint)
- Advanced token account queries (filter by mint, owner, or both) → getTokenAccounts (10 credits)
- "program accounts", investigate protocol state → getProgramAccounts (10 credits)

### Streaming / Real-time
Choose based on your use case:
- Fire-and-forget notifications (server-to-server) → createWebhook (any plan)
- Live client-side updates (WebSocket) → transactionSubscribe / accountSubscribe (Business+)
- Lowest-latency production streaming (gRPC) → laserstreamSubscribe (Professional)
- Manage existing webhooks → getAllWebhooks, getWebhookByID, updateWebhook, deleteWebhook

### Docs & Info (10+ tools — use the right one)
- "How much does Helius cost?" / pricing / plans → getHeliusPlanInfo (start here for ANY pricing question)
- "Compare plans" / side-by-side → compareHeliusPlans (category-specific)
- "Rate limits" / "credits per method" → getRateLimitInfo (live billing docs)
- "How many credits does X cost?" → getHeliusCreditsInfo (credit cost table)
- API docs / "how does X work?" → lookupHeliusDocs (by topic)
- Error codes / debugging → troubleshootError (always use this first for errors)
- Transaction sending / Jito / SWQoS → getSenderInfo
- Webhook setup → getWebhookGuide
- Streaming latency → getLatencyComparison
- pump.fun tokens → getPumpFunGuide
- Rule: For pricing/plans, start with getHeliusPlanInfo — NOT lookupHeliusDocs. For errors, use troubleshootError first.

### Wallet Investigation
- "Who is this wallet?" → getWalletIdentity (known entity lookup)
- "Who funded this wallet?" → getWalletFundedBy (funding source)
- Batch identity lookup → batchWalletIdentity

### Project Planning / Architecture
- User describes ANY Solana project, app, tool, or feature they want to build → recommendStack (call it immediately with their description — don't ask clarifying questions first)
- This includes phrases like "I want to build/make/create...", "help me build...", "I need a...", or any description of a new Solana project (e.g. "tax reporting tool", "PnL tracker", "token sniper", "NFT gallery")
- If the user hasn't set up an API key yet, recommendStack will append a setup hint — no need to call getStarted first
- After recommendations → getHeliusPlanInfo for pricing, lookupHeliusDocs for API details

### Account Setup (no API key yet)
- generateKeypair → fund wallet → agenticSignup`
  }
);

registerTools(server);

async function main() {
  if (process.env.HELIUS_API_KEY) {
    setApiKey(process.env.HELIUS_API_KEY);
  } else {
    const sharedKey = getSharedApiKey();
    if (sharedKey) {
      setApiKey(sharedKey);
    }
  }

  // Load persisted keypair from disk so MCP survives restarts
  const diskKey = loadKeypairFromDisk();
  if (diskKey) {
    try {
      const walletKeypair = loadKeypair(diskKey);
      const address = await getAddress(walletKeypair);
      setSessionSecretKey(diskKey);
      setSessionWalletAddress(address);
    } catch {
      // Ignore invalid keypair on disk
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
