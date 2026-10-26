import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { registerTools } from '../src/tools/index.js';
import { PUBLIC_TOOL_NAMES } from '../src/router/action-groups.js';
import { ACTION_CATALOG } from '../src/router/catalog.js';
import { dispatchRoutedTool, expandStoredResult } from '../src/router/dispatch.js';
import { clearStoredResults } from '../src/results/store.js';
import { callActionHandler } from '../src/router/action-handlers.js';

vi.mock('../src/router/action-handlers.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/router/action-handlers.js')>();
  return { ...original, callActionHandler: vi.fn(original.callActionHandler) };
});

let tools: Tool[];

beforeAll(async () => {
  const server = new McpServer({ name: 'annotations-test', version: '0.0.0' });
  registerTools(server);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'annotations-test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  ({ tools } = await client.listTools());
});

describe('tools/list annotations', () => {
  it('lists every public tool', () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual([...PUBLIC_TOOL_NAMES].sort());
  });

  it('gives every tool a title and explicit boolean hints, as the Anthropic and OpenAI directories require', () => {
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.annotations?.title, tool.name).toBe(tool.title);
      for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const) {
        expect(typeof tool.annotations?.[hint], `${tool.name}.${hint}`).toBe('boolean');
      }
    }
  });

  it('matches this snapshot, so any change to a hint is deliberate', () => {
    const hints = Object.fromEntries(
      tools
        .map((tool) => [tool.name, {
          readOnly: tool.annotations?.readOnlyHint,
          destructive: tool.annotations?.destructiveHint,
        }] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    expect(hints).toEqual({
      expandResult: { readOnly: true, destructive: false },
      heliusAccount: { readOnly: false, destructive: true },
      heliusAsset: { readOnly: true, destructive: false },
      heliusChain: { readOnly: true, destructive: false },
      heliusCompression: { readOnly: true, destructive: false },
      heliusKnowledge: { readOnly: false, destructive: false },
      heliusStreaming: { readOnly: false, destructive: true },
      heliusTransaction: { readOnly: true, destructive: false },
      heliusWallet: { readOnly: true, destructive: false },
      heliusWrite: { readOnly: false, destructive: true },
    });
  });

  it('marks a routed tool read-only exactly when none of its actions is a write', () => {
    for (const tool of tools.filter((t) => t.name !== 'expandResult')) {
      const writes = Object.values(ACTION_CATALOG)
        .filter((entry) => entry.publicTool === tool.name && entry.mutability === 'write')
        .map((entry) => entry.action);
      expect(tool.annotations?.readOnlyHint, `${tool.name} writes: ${writes.join(', ')}`).toBe(writes.length === 0);
    }
  });
});

describe('catalog labels behind the annotations', () => {
  it('labels purchaseCredits as needing a signer, since autopay pays USDC from the local keypair', () => {
    expect(ACTION_CATALOG.purchaseCredits.authRequirement).toBe('jwtAndSigner');
  });

  it('labels generateKeypair a write, since it saves a new keypair to disk', () => {
    expect(ACTION_CATALOG.generateKeypair.mutability).toBe('write');
  });

  it('labels recommendStack a non-destructive write whose side effect is the remember param', () => {
    expect(ACTION_CATALOG.recommendStack.mutability).toBe('write');
    expect(ACTION_CATALOG.recommendStack.nonDestructiveWrite).toBe(true);
    expect(ACTION_CATALOG.recommendStack.replayOmitParams).toEqual(['remember']);
  });
});

describe('expandResult never replays a write', () => {
  const handler = vi.mocked(callActionHandler);

  beforeEach(() => {
    clearStoredResults();
    handler.mockReset();
  });

  it('drops remember from a stored recommendStack recipe', async () => {
    handler.mockResolvedValueOnce({ content: [{ type: 'text', text: '# Helius Product Catalog\n\n'.padEnd(4000, 'x') }] });
    const first = await dispatchRoutedTool(
      'heliusKnowledge',
      { action: 'recommendStack', description: 'a trading bot', remember: true, budget: 'developer', detail: 'summary' },
      {},
    );
    expect(handler).toHaveBeenLastCalledWith('recommendStack', expect.objectContaining({ remember: true }), {});

    const resultId = first.content[0].text.match(/resultId:\s+([^\n]+)/)?.[1]?.trim();
    expect(resultId, 'recommendStack should return a handle in summary detail').toBeTruthy();

    handler.mockResolvedValueOnce({ content: [{ type: 'text', text: 'full catalog' }] });
    await expandStoredResult({ resultId }, {});

    const replayed = handler.mock.calls.at(-1)![1];
    expect(replayed).not.toHaveProperty('remember');
    expect(replayed).toMatchObject({ description: 'a trading bot', budget: 'developer' });
  });
});
