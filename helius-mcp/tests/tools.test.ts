import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PUBLIC_TOOL_NAMES, ACTION_GROUPS } from '../src/router/action-groups.js';
import {
  HELIUS_ACCOUNT_ACTIONS,
  HELIUS_ASSET_ACTIONS,
  HELIUS_CHAIN_ACTIONS,
  HELIUS_COMPRESSION_ACTIONS,
  HELIUS_KNOWLEDGE_ACTIONS,
  HELIUS_STREAMING_ACTIONS,
  HELIUS_TRANSACTION_ACTIONS,
  HELIUS_WALLET_ACTIONS,
  HELIUS_WRITE_ACTIONS,
  LEGACY_ACTIONS,
} from '../src/router/legacy-actions.js';
import { ROUTER_INSTRUCTIONS } from '../src/router/instructions.js';
import { clearStoredResults, getStoredResult, getStoredResultStats, putStoredResult } from '../src/results/store.js';
import { getRouterContext } from '../src/router/context.js';
import { registerTools } from '../src/tools/index.js';
import { hasApiKey } from '../src/utils/helius.js';

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

type RegisteredToolMap = Record<
  string,
  {
    description?: string;
    inputSchema: { _def: { shape: () => Record<string, any> } };
    handler: (params: Record<string, unknown>, extra: unknown) => Promise<any>;
  }
>;

function createServer(): { server: McpServer; tools: RegisteredToolMap } {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerTools(server);
  return {
    server,
    tools: (server as unknown as { _registeredTools: RegisteredToolMap })._registeredTools,
  };
}

function telemetry() {
  return {
    _feedback: 'Automated test feedback.',
    _feedbackTool: 'none',
    _model: 'vitest',
  };
}

describe('Public Router Surface', () => {
  let tools: RegisteredToolMap;

  beforeEach(() => {
    clearStoredResults();
    vi.mocked(hasApiKey).mockReturnValue(true);
    ({ tools } = createServer());
  });

  it('registers exactly 10 public tools', () => {
    expect(Object.keys(tools).sort()).toEqual([...PUBLIC_TOOL_NAMES].sort());
  });

  it('covers all legacy actions exactly once', () => {
    const groupedActions = Object.values(ACTION_GROUPS).flat();
    expect(groupedActions).toHaveLength(LEGACY_ACTIONS.length);
    expect(new Set(groupedActions).size).toBe(LEGACY_ACTIONS.length);
  });

  it('keeps router instructions under budget', () => {
    expect(ROUTER_INSTRUCTIONS.length).toBeLessThanOrEqual(4500);
    expect(ROUTER_INSTRUCTIONS.split('\n').filter((line) => line.trim()).length).toBeLessThanOrEqual(45);
  });

  it('exposes action enums and telemetry fields on every routed tool', () => {
    const expectedActions = {
      heliusAccount: HELIUS_ACCOUNT_ACTIONS,
      heliusWallet: HELIUS_WALLET_ACTIONS,
      heliusAsset: HELIUS_ASSET_ACTIONS,
      heliusTransaction: HELIUS_TRANSACTION_ACTIONS,
      heliusChain: HELIUS_CHAIN_ACTIONS,
      heliusStreaming: HELIUS_STREAMING_ACTIONS,
      heliusKnowledge: HELIUS_KNOWLEDGE_ACTIONS,
      heliusWrite: HELIUS_WRITE_ACTIONS,
      heliusCompression: HELIUS_COMPRESSION_ACTIONS,
    } as const;

    for (const [toolName, actions] of Object.entries(expectedActions)) {
      const shape = tools[toolName].inputSchema._def.shape();
      expect(shape._feedback, `${toolName} missing _feedback`).toBeDefined();
      expect(shape._feedbackTool, `${toolName} missing _feedbackTool`).toBeDefined();
      expect(shape._model, `${toolName} missing _model`).toBeDefined();
      expect(shape.action._def.values, `${toolName} action is not an enum`).toEqual(actions);
    }

    const expandShape = tools.expandResult.inputSchema._def.shape();
    expect(expandShape.resultId).toBeDefined();
    expect(expandShape._feedback).toBeDefined();
    expect(expandShape._feedbackTool).toBeDefined();
    expect(expandShape._model).toBeDefined();
  });

  it('returns compact auth errors through the router surface', async () => {
    vi.mocked(hasApiKey).mockReturnValue(false);
    const result = await tools.heliusWallet.handler(
      {
        action: 'getBalance',
        address: '11111111111111111111111111111111',
        ...telemetry(),
      },
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Helius API Key Required');
    expect(result.content[0].text).not.toContain('```json');
  });

  it('creates expandable result handles for summary-first actions', async () => {
    const initial = await tools.heliusKnowledge.handler(
      {
        action: 'recommendStack',
        description: 'build a wallet dashboard',
        ...telemetry(),
      },
      {},
    );

    const firstText = initial.content[0].text;
    expect(firstText).toContain('resultId:');
    const match = firstText.match(/resultId:\s+([^\n]+)/);
    expect(match).toBeTruthy();

    const resultId = match![1].trim();
    expect(getStoredResultStats().count).toBeGreaterThan(0);

    const expanded = await tools.expandResult.handler(
      {
        resultId,
        detail: 'full',
        ...telemetry(),
      },
      {},
    );

    expect(expanded.isError).toBeFalsy();
    expect(expanded.content[0].text.length).toBeGreaterThan(0);
    expect(expanded.structuredContent.action).toBe('recommendStack');
  });
});

describe('Result Store', () => {
  beforeEach(() => {
    clearStoredResults();
  });

  it('enforces owner session scoping', () => {
    const { sessionKey } = getRouterContext();
    const stored = putStoredResult({
      kind: 'document',
      ownerSessionKey: 'other-session',
      summary: 'summary',
      availableExpansions: ['full'],
      payload: {
        recipe: {
          publicTool: 'heliusKnowledge',
          action: 'lookupHeliusDocs',
          params: { topic: 'billing' },
          responseFamily: 'document',
          defaultDetail: 'summary',
        },
        continuation: { model: 'none' },
      },
    });

    expect(getStoredResult(stored.resultId, sessionKey)).toBeNull();
    expect(getStoredResult(stored.resultId, 'other-session')).not.toBeNull();
  });
});
