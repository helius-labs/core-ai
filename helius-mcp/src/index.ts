#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools/index.js';
import { setApiKey, setSessionSecretKey, setSessionWalletAddress } from './utils/helius.js';
import { getSharedApiKey, loadKeypairFromDisk } from './utils/config.js';
import { captureClientInfo, captureWalletAddress } from './utils/feedback.js';
import { loadKeypair } from 'helius-sdk/auth/loadKeypair';
import { getAddress } from 'helius-sdk/auth/getAddress';
import { version } from './version.js';

const server = new McpServer(
  {
    name: 'helius-mcp',
    version
  },
  {
    instructions: `These instructions provide fallback tool selection guidance. If you have more specific routing instructions from a Helius skill or system prompt, prefer those.

## Tool Routing

| Intent | Tool | Credits |
|--------|------|---------|
| SOL balance | getBalance | 1 |
| token balances by wallet | getTokenBalances | 10/pg |
| full portfolio + USD | getWalletBalances | 100 |
| parse tx by signature | parseTransactions | 100 |
| wallet transaction history | getTransactionHistory | ~110 |
| balance deltas/tx | getWalletHistory | 100 |
| sends/receives | getWalletTransfers | 100 |
| asset by mint (single or batch) | getAsset | 10 |
| wallet NFTs | getAssetsByOwner | 10 |
| filtered asset search / by creator or authority | searchAssets | 10 |
| collection NFTs | getAssetsByGroup | 10 |
| asset tx history (by mint) | getSignaturesForAsset | 10 |
| edition prints of master NFT | getNftEditions | 10 |
| cNFT Merkle proof (single or batch) | getAssetProof, getAssetProofBatch | 10 |
| raw account inspection (single or batch) | getAccountInfo | 1 |
| token holders by mint | getTokenHolders | ~20 |
| token accounts by mint or owner | getTokenAccounts | 10 |
| program accounts / protocol state | getProgramAccounts | 10 |
| network status / epoch / block height | getNetworkStatus | 3 |
| block data by slot | getBlock | 1 |
| plans/pricing | getHeliusPlanInfo | 0 |
| plan comparison | compareHeliusPlans | 0 |
| plan upgrade / billing | previewUpgrade, upgradePlan, payRenewal | 0 |
| rate limits/credits | getRateLimitInfo | 0 |
| API docs by topic | lookupHeliusDocs | 0 |
| error diagnosis | troubleshootError | 0 |
| tx sending / Jito / SWQoS | getSenderInfo | 0 |
| webhook setup guide | getWebhookGuide | 0 |
| streaming latency | getLatencyComparison | 0 |
| pump.fun tokens | getPumpFunGuide | 0 |
| project architecture / stack selection | recommendStack | 0 |
| Solana SIMDs / protocol proposals | getSIMD, listSIMDs | 0 |
| Solana source / docs search | searchSolanaDocs, readSolanaSourceFile | 0 |
| Helius blog posts | fetchHeliusBlog | 0 |
| wallet identity | getWalletIdentity | 100 |
| batch wallet identity | batchWalletIdentity | 100 |
| funding source | getWalletFundedBy | 100 |
| event notifications (any plan) | createWebhook | 100 |
| live streaming (WS, Business+) | transactionSubscribe, accountSubscribe | — |
| production streaming (gRPC, Pro) | laserstreamSubscribe | — |
| stake SOL to Helius validator | stakeSOL | ~3 |
| deactivate stake account | unstakeSOL | ~3 |
| withdraw from deactivated stake | withdrawStake | ~3 |
| list Helius stake accounts | getStakeAccounts | ~10 |
| check withdrawable stake amount | getWithdrawableAmount | ~3 |
| Account setup | getStarted → generateKeypair → agenticSignup | — |

Rules:
- For pricing, start with getHeliusPlanInfo — NOT lookupHeliusDocs.
- For errors, use troubleshootError first.
- When a user describes ANY project they want to build ("I want to build/make/create...", "help me build...", "I need a..."), call recommendStack immediately with their description — do not ask clarifying questions first. After recommendations, use getHeliusPlanInfo for pricing and lookupHeliusDocs for API details.
- "send SOL" / "transfer SOL" → transferSol (~3 credits). "send tokens" / "transfer USDC/BONK/etc" → transferToken (~13 credits). Both require a configured keypair (generateKeypair) and use Helius Sender.
- "stake SOL" / "delegate SOL" → stakeSOL (~3 credits). "unstake" / "deactivate" → unstakeSOL (~3 credits). "withdraw stake" → withdrawStake (~3 credits). All staking delegates to the Helius validator. Requires a configured keypair (generateKeypair).

## Feedback
Every tool accepts \`_feedback\` and \`_model\` params. Always include \`_model\` with your LLM model identifier (e.g. "claude-sonnet-4-20250514", "gpt-4o"). After each tool call, assess the response and include \`_feedback\` on your next call — what worked, what was confusing, what data was missing or could be improved.`
  }
);

registerTools(server);

// Capture MCP client identity (Cursor, Claude Code, etc.) after handshake
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(server.server as any).oninitialized = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientVersion = (server.server as any).getClientVersion?.();
  if (clientVersion) {
    captureClientInfo(clientVersion);
  }
};

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
      captureWalletAddress(address);
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
