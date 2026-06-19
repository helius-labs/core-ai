import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
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
  ACTION_NAMES,
} from '../src/router/actions.js';
import { ROUTER_INSTRUCTIONS } from '../src/router/instructions.js';
import { normalizeTelemetry } from '../src/router/telemetry.js';
import { clearStoredResults, getStoredResult, getStoredResultStats, putStoredResult } from '../src/results/store.js';
import { getRouterContext } from '../src/router/context.js';
import { registerTools } from '../src/tools/index.js';
import { hasApiKey, getHeliusClient } from '../src/utils/helius.js';
import { callActionHandler, type ActionHandlerResponse } from '../src/router/action-handlers.js';

vi.mock('../src/router/action-handlers.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/router/action-handlers.js')>();
  return {
    ...original,
    callActionHandler: vi.fn(original.callActionHandler),
  };
});

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

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const ROUTER_LEGACY_ALLOWLIST = [
  /legacyHeaders/,
  /legacy injected/i,
  /legacy .*provider/i,
  /legacy .*Transaction.* class/i,
  /both legacy and versioned transactions/i,
  /legacy and versioned transactions/i,
  /Legacy and programmable NFTs/i,
  /^## Legacy Endpoints$/i,
  /BPF Loader \(Legacy \/ V1\)/,
];

function collectAuditFiles(target: string): string[] {
  const stats = statSync(target);
  if (!stats.isDirectory()) {
    return target.endsWith('.md') || target.endsWith('.ts') ? [target] : [];
  }

  return readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) {
      return collectAuditFiles(child);
    }
    return child.endsWith('.md') || child.endsWith('.ts') ? [child] : [];
  });
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

  it('covers all action names exactly once', () => {
    const groupedActions = Object.values(ACTION_GROUPS).flat();
    expect(groupedActions).toHaveLength(ACTION_NAMES.length);
    expect(new Set(groupedActions).size).toBe(ACTION_NAMES.length);
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

  it('requires non-blank telemetry fields and current tool.action guidance', () => {
    const shape = tools.heliusWallet.inputSchema._def.shape();

    expect(shape._feedback.safeParse('').success).toBe(false);
    expect(shape._feedback.safeParse('   ').success).toBe(false);
    expect(shape._feedback.safeParse('initial balance check').success).toBe(true);
    expect(shape._feedbackTool.safeParse('').success).toBe(false);
    expect(shape._feedbackTool.safeParse('heliusWallet.getBalance').success).toBe(true);
    expect(shape._model.safeParse('claude-opus-4-6').success).toBe(true);
    expect(ROUTER_INSTRUCTIONS).toContain('Choose tools by user intent, not by name similarity.');
    expect(ROUTER_INSTRUCTIONS).toContain('heliusWallet.getTokenBalances');
    expect(ROUTER_INSTRUCTIONS).toContain('heliusKnowledge.getRateLimitInfo');
    expect(ROUTER_INSTRUCTIONS).toContain('heliusWallet.getBalance');
    expect(ROUTER_INSTRUCTIONS).toContain('Avoid placeholders like `first_call`');
  });

  it('uses intent-specific routed tool descriptions', () => {
    expect(tools.heliusWallet.description).toContain('not raw token accounts');
    expect(tools.heliusChain.description).toContain('not wallet portfolio summaries');
    expect(tools.heliusStreaming.description).toContain('not how-to guides');
    expect(tools.heliusKnowledge.description).toContain('rate limits');
    expect(tools.heliusWrite.description).toContain('not read-only queries');
    expect(tools.expandResult.description).toContain('summary-first');
  });

  it('normalizes first-call sentinels to the current tool.action for analytics', () => {
    expect(
      normalizeTelemetry(
        'heliusTransaction',
        { action: 'getTransactionHistory' },
        {
          _feedback: 'first_call',
          _feedbackTool: 'none',
          _model: 'claude-opus-4-6',
        },
      ),
    ).toEqual({
      _feedback: 'initial heliusTransaction.getTransactionHistory',
      _feedbackTool: 'heliusTransaction.getTransactionHistory',
      _model: 'claude-opus-4-6',
    });
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
    expect(expanded._meta.action).toBe('recommendStack');
  });
});

describe('Router Legacy Audit', () => {
  it('keeps router-specific legacy wording out of code and docs', () => {
    const targets = [
      path.join(REPO_ROOT, 'AGENTS.md'),
      path.join(REPO_ROOT, 'README.md'),
      path.join(REPO_ROOT, 'CLAUDE.md'),
      path.join(REPO_ROOT, 'helius-mcp', 'README.md'),
      path.join(REPO_ROOT, 'helius-plugin', 'README.md'),
      path.join(REPO_ROOT, 'helius-cursor', 'README.md'),
      path.join(REPO_ROOT, 'helius-skills', 'helius', 'SKILL.md'),
      path.join(REPO_ROOT, 'helius-skills', 'helius-dflow', 'SKILL.md'),
      path.join(REPO_ROOT, 'helius-skills', 'helius-phantom', 'SKILL.md'),
      path.join(REPO_ROOT, 'helius-plugin', 'skills', 'build', 'SKILL.md'),
      path.join(REPO_ROOT, 'helius-plugin', 'skills', 'dflow', 'SKILL.md'),
      path.join(REPO_ROOT, 'helius-plugin', 'skills', 'phantom', 'SKILL.md'),
      path.join(REPO_ROOT, 'helius-cursor', 'skills', 'build', 'SKILL.md'),
      path.join(REPO_ROOT, 'helius-cursor', 'skills', 'dflow', 'SKILL.md'),
      path.join(REPO_ROOT, 'helius-cursor', 'skills', 'phantom', 'SKILL.md'),
      path.join(REPO_ROOT, '.agents', 'skills'),
      path.join(REPO_ROOT, 'helius-mcp', 'system-prompts'),
      path.join(REPO_ROOT, 'helius-mcp', 'src', 'router'),
    ];

    const violations: string[] = [];
    for (const file of targets.flatMap((target) => collectAuditFiles(target))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      for (const [index, line] of lines.entries()) {
        if (!/legacy/i.test(line)) {
          continue;
        }
        if (ROUTER_LEGACY_ALLOWLIST.some((pattern) => pattern.test(line))) {
          continue;
        }
        violations.push(`${path.relative(REPO_ROOT, file)}:${index + 1}: ${line.trim()}`);
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('Dispatch per routed tool', () => {
  let tools: RegisteredToolMap;
  const mockedCallHandler = vi.mocked(callActionHandler);

  beforeEach(() => {
    clearStoredResults();
    vi.mocked(hasApiKey).mockReturnValue(true);
    mockedCallHandler.mockRestore();
    ({ tools } = createServer());
  });

  it('heliusAccount — getStarted dispatches successfully', async () => {
    const result = await tools.heliusAccount.handler(
      { action: 'getStarted', ...telemetry() },
      {},
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it('heliusWallet — getBalance dispatches successfully', async () => {
    const mockResponse: ActionHandlerResponse = {
      content: [{ type: 'text', text: '**Balance:** 1.5 SOL' }],
    };
    mockedCallHandler.mockResolvedValueOnce(mockResponse);

    const result = await tools.heliusWallet.handler(
      { action: 'getBalance', address: '11111111111111111111111111111111', ...telemetry() },
      {},
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('1.5 SOL');
  });

  it('heliusAsset — getAsset dispatches successfully', async () => {
    const mockResponse: ActionHandlerResponse = {
      content: [{ type: 'text', text: '**Asset:** Test NFT\n\nCollection: Test' }],
    };
    mockedCallHandler.mockResolvedValueOnce(mockResponse);

    const result = await tools.heliusAsset.handler(
      { action: 'getAsset', id: 'So11111111111111111111111111111111111111112', ...telemetry() },
      {},
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Test NFT');
  });

  it('heliusTransaction — parseTransactions dispatches successfully', async () => {
    const mockResponse: ActionHandlerResponse = {
      content: [{ type: 'text', text: '**Parsed 1 transaction**\n\nType: TRANSFER' }],
    };
    mockedCallHandler.mockResolvedValueOnce(mockResponse);

    const result = await tools.heliusTransaction.handler(
      { action: 'parseTransactions', signatures: ['5abc123'], ...telemetry() },
      {},
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('TRANSFER');
  });

  it('heliusChain — getNetworkStatus dispatches successfully', async () => {
    const mockResponse: ActionHandlerResponse = {
      content: [{ type: 'text', text: '**Epoch:** 500\n**Slot:** 250000000' }],
    };
    mockedCallHandler.mockResolvedValueOnce(mockResponse);

    const result = await tools.heliusChain.handler(
      { action: 'getNetworkStatus', ...telemetry() },
      {},
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Epoch');
  });

  it('heliusChain — simulateTransaction formats a successful simulation', async () => {
    vi.mocked(getHeliusClient).mockReturnValueOnce({
      simulateTransaction: async (_tx: string, _cfg: unknown) => ({
        context: { slot: 250_000_000 },
        value: { err: null, logs: ['Program log: hello'], unitsConsumed: 4200, returnData: null, accounts: null },
      }),
    } as unknown as ReturnType<typeof getHeliusClient>);

    const result = await tools.heliusChain.handler(
      { action: 'simulateTransaction', transaction: 'AQABz000base64', ...telemetry() },
      {},
    );

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('Would succeed');
    expect(text).toContain('4,200');
    expect(text).toContain('Program log: hello');
  });

  it('heliusChain — simulateTransaction surfaces a program error as "would fail"', async () => {
    vi.mocked(getHeliusClient).mockReturnValueOnce({
      simulateTransaction: async () => ({
        context: { slot: 1 },
        value: { err: { InstructionError: [0, 'Custom'] }, logs: [], unitsConsumed: 0 },
      }),
    } as unknown as ReturnType<typeof getHeliusClient>);

    const result = await tools.heliusChain.handler(
      { action: 'simulateTransaction', transaction: 'AQABz000base64', ...telemetry() },
      {},
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Would fail');
    expect(result.content[0].text).toContain('InstructionError');
  });

  it('heliusChain — simulateTransaction sends base64 encoding and enforces sigVerify/replaceRecentBlockhash exclusivity', async () => {
    let captured: Record<string, unknown> = {};
    const stub = {
      simulateTransaction: async (_tx: string, cfg: Record<string, unknown>) => {
        captured = cfg;
        return { context: { slot: 1 }, value: { err: null, logs: [], unitsConsumed: 0 } };
      },
    } as unknown as ReturnType<typeof getHeliusClient>;
    vi.mocked(getHeliusClient).mockReturnValueOnce(stub).mockReturnValueOnce(stub);

    // Defaults: replace the blockhash, do not verify signatures.
    await tools.heliusChain.handler(
      { action: 'simulateTransaction', transaction: 'AQABbase64', ...telemetry() },
      {},
    );
    expect(captured.encoding).toBe('base64');
    expect(captured.sigVerify).toBe(false);
    expect(captured.replaceRecentBlockhash).toBe(true);

    // sigVerify=true forces replaceRecentBlockhash off (mutually exclusive at the RPC layer).
    await tools.heliusChain.handler(
      { action: 'simulateTransaction', transaction: 'AQABbase64', sigVerify: true, ...telemetry() },
      {},
    );
    expect(captured.sigVerify).toBe(true);
    expect(captured.replaceRecentBlockhash).toBe(false);
  });

  it('heliusChain — simulateTransaction requires the transaction param', async () => {
    const result = await tools.heliusChain.handler(
      { action: 'simulateTransaction', ...telemetry() },
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required parameter');
    expect(result.content[0].text).toContain('transaction');
    expect(result._meta?.code).toBe('MISSING_PARAMS');
  });

  it('heliusStreaming — getAllWebhooks dispatches successfully', async () => {
    const mockResponse: ActionHandlerResponse = {
      content: [{ type: 'text', text: 'No webhooks configured.' }],
    };
    mockedCallHandler.mockResolvedValueOnce(mockResponse);

    const result = await tools.heliusStreaming.handler(
      { action: 'getAllWebhooks', ...telemetry() },
      {},
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it('heliusKnowledge — listHeliusDocTopics dispatches successfully', async () => {
    const result = await tools.heliusKnowledge.handler(
      { action: 'listHeliusDocTopics', ...telemetry() },
      {},
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it('heliusWrite — transferSol error path dispatches successfully', async () => {
    const mockResponse: ActionHandlerResponse = {
      content: [{ type: 'text', text: 'No signer configured. Call generateKeypair first.' }],
      isError: true,
    };
    mockedCallHandler.mockResolvedValueOnce(mockResponse);

    const result = await tools.heliusWrite.handler(
      { action: 'transferSol', recipientAddress: '11111111111111111111111111111111', ...telemetry() },
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('signer');
  });

  it('heliusCompression — getIndexerHealth dispatches successfully', async () => {
    const mockResponse: ActionHandlerResponse = {
      content: [{ type: 'text', text: '**Indexer Health:** OK' }],
    };
    mockedCallHandler.mockResolvedValueOnce(mockResponse);

    const result = await tools.heliusCompression.handler(
      { action: 'getIndexerHealth', ...telemetry() },
      {},
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('OK');
  });

  it('produces graceful error when handler throws', async () => {
    mockedCallHandler.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await tools.heliusWallet.handler(
      { action: 'getBalance', address: '11111111111111111111111111111111', ...telemetry() },
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Connection refused');
    expect(result._meta?.code).toBe('HANDLER_ERROR');
  });

  it('rejects missing required params before calling handler', async () => {
    const result = await tools.heliusWallet.handler(
      { action: 'getBalance', ...telemetry() },
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required parameter');
    expect(result.content[0].text).toContain('address');
    expect(result._meta?.code).toBe('MISSING_PARAMS');
  });

  it('rejects multiple missing required params', async () => {
    const result = await tools.heliusWrite.handler(
      { action: 'transferToken', ...telemetry() },
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing required parameters');
    expect(result.content[0].text).toContain('recipientAddress');
    expect(result.content[0].text).toContain('mintAddress');
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
