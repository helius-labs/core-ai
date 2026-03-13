import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../src/tools/index.js';
import { hasApiKey } from '../src/utils/helius.js';

// Mock helius utilities
vi.mock('../src/utils/helius.js', () => ({
  hasApiKey: vi.fn(() => true),
  getApiKey: vi.fn(() => 'test-key'),
  getHeliusClient: vi.fn(() => ({})),
  getEnhancedWebSocketUrl: vi.fn(() => 'wss://atlas-mainnet.helius-rpc.com/?api-key=test'),
  getLaserstreamUrl: vi.fn(() => 'https://laserstream-mainnet-ewr.helius-rpc.com'),
  getNetwork: vi.fn(() => 'mainnet-beta'),
  setApiKey: vi.fn(),
  setNetwork: vi.fn(),
  restRequest: vi.fn(),
  setSessionSecretKey: vi.fn(),
  getSessionSecretKey: vi.fn(() => null),
  setSessionWalletAddress: vi.fn(),
  getSessionWalletAddress: vi.fn(() => null),
  loadSignerOrFail: vi.fn(),
}));

describe('Helius MCP Tools', () => {
  let tools: Map<string, { name: string; description: string; handler: Function }>;

  beforeEach(() => {
    tools = new Map();
    const mockServer = {
      tool: vi.fn((name: string, description: string, _schema: unknown, handler: Function) => {
        tools.set(name, { name, description, handler });
      }),
    } as unknown as McpServer;
    registerTools(mockServer);
  });

  it('registers 92 tools', () => {
    expect(tools.size).toBe(92);
  });

  it('all tools have descriptions', () => {
    for (const [name, tool] of tools) {
      expect(tool.description, `${name} missing description`).toBeTruthy();
    }
  });

  it('all tools have handlers', () => {
    for (const [name, tool] of tools) {
      expect(typeof tool.handler, `${name} handler not a function`).toBe('function');
    }
  });

  it('registers expected tool categories', () => {
    const expected = [
      // Onboarding
      'getStarted', 'setHeliusApiKey', 'generateKeypair', 'checkSignupBalance', 'agenticSignup', 'getAccountStatus',
      // Plans & billing
      'getHeliusPlanInfo', 'compareHeliusPlans', 'getAccountPlan', 'previewUpgrade', 'upgradePlan', 'payRenewal',
      // Balance
      'getBalance', 'getTokenBalances',
      // DAS
      'getAsset', 'getAssetsByOwner', 'searchAssets', 'getAssetsByGroup',
      'getAssetProof', 'getAssetProofBatch', 'getSignaturesForAsset', 'getNftEditions', 'getTokenAccounts',
      // RPC
      'getAccountInfo', 'getNetworkStatus', 'getBlock',
      // Tokens
      'getTokenHolders', 'getProgramAccounts',
      // Transactions
      'parseTransactions', 'getTransactionHistory',
      // Transfers
      'transferSol', 'transferToken',
      // Fees
      'getPriorityFeeEstimate',
      // Webhooks
      'createWebhook', 'getAllWebhooks', 'getWebhookByID', 'updateWebhook', 'deleteWebhook',
      // Enhanced WebSockets
      'transactionSubscribe', 'accountSubscribe', 'getEnhancedWebSocketInfo',
      // Laserstream
      'laserstreamSubscribe', 'getLaserstreamInfo',
      // Wallet
      'getWalletBalances', 'getWalletHistory', 'getWalletTransfers',
      'getWalletIdentity', 'batchWalletIdentity', 'getWalletFundedBy',
      // Docs & Guides
      'lookupHeliusDocs', 'listHeliusDocTopics', 'getHeliusCreditsInfo',
      'getRateLimitInfo', 'getSenderInfo', 'getWebhookGuide', 'troubleshootError',
      'getLatencyComparison', 'getPumpFunGuide', 'recommendStack',
      // Solana Knowledge
      'getSIMD', 'listSIMDs', 'searchSolanaDocs', 'readSolanaSourceFile', 'fetchHeliusBlog',
      // Staking
      'stakeSOL', 'unstakeSOL', 'withdrawStake', 'getStakeAccounts', 'getWithdrawableAmount',
    ];

    for (const name of expected) {
      expect(tools.has(name), `missing tool: ${name}`).toBe(true);
    }
  });
});

describe('noApiKey guard', () => {
  // All tools that have an `if (!hasApiKey()) return noApiKeyResponse()` guard
  const guardedTools = [
    // Balance
    'getBalance', 'getTokenBalances',
    // DAS
    'getAsset', 'getAssetsByOwner', 'searchAssets', 'getAssetsByGroup',
    // DAS extras
    'getAssetProof', 'getAssetProofBatch', 'getSignaturesForAsset', 'getNftEditions',
    // RPC / Accounts
    'getAccountInfo', 'getTokenAccounts', 'getProgramAccounts',
    'getNetworkStatus', 'getBlock',
    // Tokens
    'getTokenHolders',
    // Transactions
    'parseTransactions', 'getTransactionHistory',
    // Transfers
    'transferSol', 'transferToken',
    // Fees
    'getPriorityFeeEstimate',
    // Webhooks
    'getAllWebhooks', 'getWebhookByID', 'createWebhook', 'updateWebhook', 'deleteWebhook',
    // Wallet
    'getWalletBalances', 'getWalletHistory', 'getWalletTransfers',
    'getWalletIdentity', 'batchWalletIdentity', 'getWalletFundedBy',
    // Staking
    'stakeSOL', 'unstakeSOL', 'withdrawStake', 'getStakeAccounts', 'getWithdrawableAmount',
  ];

  let tools: Map<string, { name: string; description: string; handler: Function }>;

  beforeEach(() => {
    vi.mocked(hasApiKey).mockReturnValue(false);
    tools = new Map();
    const mockServer = {
      tool: vi.fn((name: string, description: string, _schema: unknown, handler: Function) => {
        tools.set(name, { name, description, handler });
      }),
    } as unknown as McpServer;
    registerTools(mockServer);
  });

  it.each(guardedTools)('%s returns noApiKey response when no key is configured', async (toolName) => {
    const tool = tools.get(toolName);
    expect(tool, `tool not found: ${toolName}`).toBeDefined();
    const result = await tool!.handler({});
    expect(result.content[0].text).toContain('Helius API Key Required');
    expect(result.isError).toBe(true); // noApiKeyResponse is an auth error with structured metadata
  });
});
