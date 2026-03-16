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
