import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../src/tools/index.js';

// Mock helius utilities
vi.mock('../src/utils/helius.js', () => ({
  hasApiKey: vi.fn(() => true),
  getApiKey: vi.fn(() => 'test-key'),
  getRpcUrl: vi.fn(() => 'https://mainnet.helius-rpc.com/?api-key=test'),
  getHeliusClient: vi.fn(() => ({})),
  getEnhancedWebSocketUrl: vi.fn(() => 'wss://atlas-mainnet.helius-rpc.com/?api-key=test'),
  getLaserstreamUrl: vi.fn(() => 'https://laserstream-mainnet-ewr.helius-rpc.com'),
  getNetwork: vi.fn(() => 'mainnet'),
  setApiKey: vi.fn(),
  setNetwork: vi.fn(),
  dasRequest: vi.fn(),
  restRequest: vi.fn(),
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

  it('registers 46 tools', () => {
    expect(tools.size).toBe(46);
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
      // Config
      'setHeliusApiKey', 'getHeliusApiKeyStatus',
      // Balance
      'getBalance', 'getTokenBalances',
      // DAS
      'getAsset', 'getAssetsByOwner', 'searchAssets', 'getAssetsByGroup',
      // Transactions
      'parseTransactions', 'getTransactionHistory',
      // Webhooks
      'createWebhook', 'getAllWebhooks', 'deleteWebhook',
      // WebSockets
      'transactionSubscribe', 'accountSubscribe',
      // Laserstream
      'laserstreamSubscribe',
      // Wallet
      'getWalletBalances', 'getWalletHistory', 'getWalletIdentity',
      // Guides
      'getRateLimitInfo', 'getSenderInfo', 'troubleshootError',
      // Docs
      'lookupHeliusDocs', 'getHeliusCreditsInfo',
    ];

    for (const name of expected) {
      expect(tools.has(name), `missing tool: ${name}`).toBe(true);
    }
  });
});
