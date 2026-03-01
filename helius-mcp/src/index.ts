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
    instructions: `These instructions provide fallback tool selection guidance. If you have more specific routing instructions from a Helius skill or system prompt, prefer those.

## Tool Routing

| Intent | Tool | Credits |
|--------|------|---------|
| SOL balance | getBalance | 1 |
| token balances | getTokenBalances | 10/pg |
| full portfolio + USD | getWalletBalances | 100 |
| parse tx by signature | parseTransactions | 100 |
| transaction history | getTransactionHistory | ~110 |
| balance deltas/tx | getWalletHistory | 100 |
| sends/receives | getWalletTransfers | 100 |
| asset by mint | getAsset | 10 |
| wallet NFTs | getAssetsByOwner | 10 |
| filtered asset search | searchAssets | 10 |
| collection NFTs | getAssetsByGroup | 10 |
| asset tx history (by mint) | getSignaturesForAsset | 10 |
| edition prints of master NFT | getNftEditions | 10 |
| raw account inspection | getAccountInfo | 1 |
| token holders by mint | getTokenHolders | ~20 |
| token account queries | getTokenAccounts | 10 |
| program accounts / protocol state | getProgramAccounts | 10 |
| plans/pricing | getHeliusPlanInfo | 0 |
| plan comparison | compareHeliusPlans | 0 |
| rate limits/credits | getRateLimitInfo | 0 |
| API docs by topic | lookupHeliusDocs | 0 |
| error diagnosis | troubleshootError | 0 |
| tx sending / Jito / SWQoS | getSenderInfo | 0 |
| webhook setup guide | getWebhookGuide | 0 |
| streaming latency | getLatencyComparison | 0 |
| pump.fun tokens | getPumpFunGuide | 0 |
| project architecture | recommendStack | 0 |
| wallet identity | getWalletIdentity | 100 |
| funding source | getWalletFundedBy | 100 |
| event notifications (any plan) | createWebhook | 100 |
| live streaming (WS, Business+) | transactionSubscribe, accountSubscribe | — |
| production streaming (gRPC, Pro) | laserstreamSubscribe | — |
| Account setup | getStarted → generateKeypair → agenticSignup | — |

Rules:
- For pricing, start with getHeliusPlanInfo — NOT lookupHeliusDocs.
- For errors, use troubleshootError first.
- When a user describes ANY project they want to build ("I want to build/make/create...", "help me build...", "I need a..."), call recommendStack immediately with their description — do not ask clarifying questions first. After recommendations, use getHeliusPlanInfo for pricing and lookupHeliusDocs for API details.`
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
