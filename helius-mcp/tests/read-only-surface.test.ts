import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from '../src/server.js';
import { ACTION_GROUPS, PUBLIC_TOOL_NAMES } from '../src/router/action-groups.js';
import { ACTION_NAMES, type ActionName } from '../src/router/actions.js';
import { ACTION_CATALOG } from '../src/router/catalog.js';
import { dispatchRoutedTool, expandStoredResult } from '../src/router/dispatch.js';
import { getSurfaceActions, getSurfaceTools, resolveSurface, type Surface } from '../src/router/surface.js';
import { clearStoredResults, putStoredResult } from '../src/results/store.js';
import { getRouterContext } from '../src/router/context.js';
import { callActionHandler } from '../src/router/action-handlers.js';

vi.mock('../src/router/action-handlers.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/router/action-handlers.js')>();
  return { ...original, callActionHandler: vi.fn(original.callActionHandler) };
});

async function connect(surface: Surface): Promise<{ client: Client; tools: Tool[] }> {
  const server = createServer({ surface });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: `${surface}-test-client`, version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  return { client, tools };
}

function listedActions(tool: Tool): string[] {
  const action = (tool.inputSchema.properties as Record<string, { enum?: string[] }>).action;
  return action?.enum ?? [];
}

const WRITES = ACTION_NAMES.filter((action) => ACTION_CATALOG[action].mutability === 'write');

describe('read-only surface: tools/list', () => {
  let client: Client;
  let tools: Tool[];

  beforeAll(async () => {
    ({ client, tools } = await connect('readOnly'));
  });

  it('lists every public tool except heliusWrite', () => {
    expect(tools.map((tool) => tool.name)).toEqual(PUBLIC_TOOL_NAMES.filter((tool) => tool !== 'heliusWrite'));
  });

  it('marks every tool read-only and non-destructive', () => {
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      });
    }
  });

  it('lists no action that changes state, apart from recommendStack without remember', () => {
    const listed = tools.flatMap(listedActions);
    expect(listed.filter((action) => WRITES.includes(action as ActionName))).toEqual(['recommendStack']);
    expect(Object.keys(tools.find((tool) => tool.name === 'heliusKnowledge')!.inputSchema.properties!))
      .not.toContain('remember');
  });

  it('lists every read action', () => {
    const listed = new Set(tools.flatMap(listedActions));
    for (const action of ACTION_NAMES.filter((name) => ACTION_CATALOG[name].mutability === 'read')) {
      expect(listed.has(action), action).toBe(true);
    }
  });

  it('drops fields only writes read, so no tool asks for contact details or transfer amounts', () => {
    const fields = (name: string) => Object.keys(tools.find((tool) => tool.name === name)!.inputSchema.properties!);
    for (const field of ['apiKey', 'email', 'firstName', 'lastName', 'paymentIntentId', 'discoveryPath', 'frictionPoints']) {
      expect(fields('heliusAccount'), field).not.toContain(field);
    }
    for (const field of ['webhookURL', 'transactionTypes', 'accountAddresses', 'webhookType']) {
      expect(fields('heliusStreaming'), field).not.toContain(field);
    }
    // Still used by previewUpgrade and the webhook lookups.
    expect(fields('heliusAccount')).toEqual(expect.arrayContaining(['plan', 'period', 'couponCode']));
    expect(fields('heliusStreaming')).toContain('webhookID');
  });

  it('tells the model the server is read-only and never routes to heliusWrite', () => {
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toContain('read-only');
    expect(instructions).toContain('9 public tools');
    expect(instructions).not.toContain('heliusWrite');
  });

  it('keeps the read-only instructions within the same budget as the full ones', () => {
    const instructions = client.getInstructions() ?? '';
    expect(instructions.length).toBeLessThanOrEqual(4500);
    expect(instructions.split('\n').filter((line) => line.trim()).length).toBeLessThanOrEqual(45);
  });

  it('rejects a write action at schema validation, before dispatch', async () => {
    const result = await client.callTool({
      name: 'heliusStreaming',
      arguments: { action: 'deleteWebhook', webhookID: 'x', _feedback: 'probe', _feedbackTool: 'heliusStreaming.deleteWebhook', _model: 'probe' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('Input validation error');
    expect(text).not.toContain('read-only');
  });
});

describe('full surface: tools/list', () => {
  it('lists all 10 tools and every action', async () => {
    const { client, tools } = await connect('full');
    expect(tools.map((tool) => tool.name)).toEqual([...PUBLIC_TOOL_NAMES]);
    expect(tools.flatMap(listedActions).sort()).toEqual([...ACTION_NAMES].sort());
    expect(client.getInstructions()).toContain('heliusWrite');
  });
});

describe('read-only surface: dispatch', () => {
  const handler = vi.mocked(callActionHandler);

  beforeEach(() => {
    clearStoredResults();
    handler.mockReset();
  });

  it('refuses every write that is not confined to strippable params, without calling its handler', async () => {
    for (const action of WRITES.filter((name) => name !== 'recommendStack')) {
      const tool = ACTION_CATALOG[action].publicTool;
      const result = await dispatchRoutedTool(tool, { action }, {}, 'readOnly');
      expect(result.isError, action).toBe(true);
      expect(result.content[0].text, action).toContain('read-only');
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('strips remember from recommendStack, including when passed through args', async () => {
    handler.mockResolvedValue({ content: [{ type: 'text', text: 'catalog' }] });
    await dispatchRoutedTool(
      'heliusKnowledge',
      { action: 'recommendStack', description: 'a bot', remember: true, args: { remember: true }, detail: 'full' },
      {},
      'readOnly',
    );
    const params = handler.mock.calls.at(-1)![1];
    expect(params).not.toHaveProperty('remember');
    expect(params).toMatchObject({ description: 'a bot' });
  });

  it('keeps remember on the full surface', async () => {
    handler.mockResolvedValue({ content: [{ type: 'text', text: 'catalog' }] });
    await dispatchRoutedTool('heliusKnowledge', { action: 'recommendStack', description: 'a bot', remember: true, detail: 'full' }, {});
    expect(handler.mock.calls.at(-1)![1]).toMatchObject({ remember: true });
  });

  it('will not expand a stored recipe whose action is off the surface', async () => {
    // pnpm validate keeps destructive writes out of the store, so plant one to
    // check the second line of defense.
    const stored = putStoredResult({
      kind: 'mutationReceipt',
      ownerSessionKey: getRouterContext({}).sessionKey,
      summary: 'summary',
      availableExpansions: ['full'],
      payload: {
        recipe: {
          publicTool: 'heliusStreaming',
          action: 'deleteWebhook',
          params: { webhookID: 'x' },
          responseFamily: 'mutationReceipt',
          defaultDetail: 'full',
        },
        continuation: { model: 'none' },
      },
    });

    const result = await expandStoredResult({ resultId: stored.resultId }, {}, 'readOnly');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('read-only');
    expect(handler).not.toHaveBeenCalled();
  });

  it('strips remember from a recipe replayed on the read-only surface', async () => {
    const stored = putStoredResult({
      kind: 'catalog',
      ownerSessionKey: getRouterContext({}).sessionKey,
      summary: 'summary',
      availableExpansions: ['full'],
      payload: {
        recipe: {
          publicTool: 'heliusKnowledge',
          action: 'recommendStack',
          params: { description: 'a bot', remember: true },
          responseFamily: 'catalog',
          defaultDetail: 'summary',
        },
        continuation: { model: 'none' },
      },
    });
    handler.mockResolvedValue({ content: [{ type: 'text', text: 'catalog' }] });

    await expandStoredResult({ resultId: stored.resultId }, {}, 'readOnly');
    expect(handler.mock.calls.at(-1)![1]).not.toHaveProperty('remember');
  });
});

describe('surface derivation', () => {
  it('gives every routed tool on the full surface its whole action group', () => {
    for (const [tool, actions] of Object.entries(ACTION_GROUPS)) {
      expect(getSurfaceActions(tool as keyof typeof ACTION_GROUPS, 'full')).toEqual([...actions]);
    }
    expect(getSurfaceTools('full')).toEqual([...PUBLIC_TOOL_NAMES]);
  });

  it('resolves the surface from --read-only or HELIUS_MCP_READ_ONLY', () => {
    expect(resolveSurface([], {})).toBe('full');
    expect(resolveSurface(['--read-only'], {})).toBe('readOnly');
    expect(resolveSurface([], { HELIUS_MCP_READ_ONLY: '1' })).toBe('readOnly');
    expect(resolveSurface([], { HELIUS_MCP_READ_ONLY: 'true' })).toBe('readOnly');
    expect(resolveSurface([], { HELIUS_MCP_READ_ONLY: '0' })).toBe('full');
    expect(resolveSurface([], { HELIUS_MCP_READ_ONLY: 'false' })).toBe('full');
    expect(resolveSurface([], { HELIUS_MCP_READ_ONLY: '' })).toBe('full');
  });

  it('fails closed on any other HELIUS_MCP_READ_ONLY value', () => {
    for (const value of ['yes', 'TRUE', 'on', ' 1 ']) {
      expect(resolveSurface([], { HELIUS_MCP_READ_ONLY: value }), value).toBe('readOnly');
    }
  });
});
