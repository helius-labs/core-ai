import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ACTION_GROUPS, type RoutedPublicToolName } from '../src/router/action-groups.js';
import { ACTION_NAMES, ACTION_NAME_SET } from '../src/router/actions.js';
import { ACTION_ALIASES } from '../src/router/aliases.js';
import { ACTION_CATALOG } from '../src/router/catalog.js';
import { resolveRoutedAction } from '../src/router/action-resolution.js';
import { dispatchRoutedTool } from '../src/router/dispatch.js';
import { isOnSurface } from '../src/router/surface.js';
import { callActionHandler } from '../src/router/action-handlers.js';
import { sendFeedbackEvent } from '../src/utils/feedback.js';
import { createServer } from '../src/server.js';

vi.mock('../src/router/action-handlers.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/router/action-handlers.js')>();
  return { ...original, callActionHandler: vi.fn(original.callActionHandler) };
});

vi.mock('../src/utils/feedback.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/utils/feedback.js')>();
  return { ...original, sendFeedbackEvent: vi.fn() };
});

const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

function miss(tool: RoutedPublicToolName, requested: string, surface: 'full' | 'readOnly' = 'full') {
  const resolution = resolveRoutedAction(tool, requested, surface);
  if (resolution.ok) throw new Error(`${requested} resolved on ${tool}`);
  return resolution;
}

describe('action aliases', () => {
  it('never shadow an action, even after normalizing case and separators', () => {
    const actions = new Set(ACTION_NAMES.map(normalize));
    for (const alias of Object.keys(ACTION_ALIASES)) {
      expect(ACTION_NAME_SET.has(alias), alias).toBe(false);
      expect(actions.has(normalize(alias)), alias).toBe(false);
    }
  });

  it('are distinct after normalizing', () => {
    const keys = Object.keys(ACTION_ALIASES).map(normalize);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('point at real actions', () => {
    for (const [alias, { action }] of Object.entries(ACTION_ALIASES)) {
      expect(ACTION_NAME_SET.has(action), `${alias} -> ${action}`).toBe(true);
    }
  });
});

describe('resolveRoutedAction', () => {
  it('resolves every action on its own tool', () => {
    for (const [tool, actions] of Object.entries(ACTION_GROUPS) as Array<[RoutedPublicToolName, readonly string[]]>) {
      for (const action of actions) {
        expect(resolveRoutedAction(tool, action, 'full'), `${tool}.${action}`).toEqual({ ok: true, action });
      }
    }
  });

  it('names the tool that owns an action sent to the wrong one', () => {
    const result = miss('heliusWallet', 'getTokenAccounts');
    expect(result.kind).toBe('wrongTool');
    expect(result.suggestion).toEqual({ tool: 'heliusChain', action: 'getTokenAccounts' });
    expect(result.message).toContain('getTokenAccounts is an action of heliusChain, not heliusWallet');
    expect(result.message).toContain('Call heliusChain with action "getTokenAccounts"');
  });

  it('lists the required parameters of the call to make', () => {
    expect(miss('heliusChain', 'getTransfersByAddress').message).toContain('Required parameters: address.');
  });

  it('asks for the bare name when the action is written as tool.action', () => {
    const result = miss('heliusWallet', 'heliusWallet.getBalance');
    expect(result.kind).toBe('qualifiedName');
    expect(result.message).toContain('Pass the bare action name: action "getBalance"');
  });

  it('routes a qualified name by the action, not the tool it was prefixed with', () => {
    const result = miss('heliusWallet', 'heliusWallet.getTokenAccounts');
    expect(result.kind).toBe('wrongTool');
    expect(result.suggestion).toEqual({ tool: 'heliusChain', action: 'getTokenAccounts' });
  });

  it('maps a Solana RPC name to the action that does its job, with how to call it', () => {
    const result = miss('heliusChain', 'getSignaturesForAddress');
    expect(result.kind).toBe('alias');
    expect(result.suggestion).toEqual({ tool: 'heliusTransaction', action: 'getTransactionHistory' });
    expect(result.message).toContain('Call heliusTransaction with action "getTransactionHistory" instead (mode "signatures" returns signatures only)');
  });

  it('keeps an alias on the called tool when the action lives there', () => {
    expect(miss('heliusChain', 'getMultipleAccounts').message).toContain('Call action "getAccountInfo" instead');
  });

  it('matches aliases regardless of case and separators', () => {
    expect(miss('heliusChain', 'get_token_accounts_by_owner').suggestion?.action).toBe('getTokenAccounts');
  });

  it('suggests the action a name differs from only in case or separators', () => {
    const result = miss('heliusWallet', 'get_balance');
    expect(result.kind).toBe('misspelled');
    expect(result.message).toContain('Did you mean action "getBalance"?');
  });

  it('suggests the closest action for a near miss', () => {
    expect(miss('heliusWallet', 'getBalances').suggestion).toEqual({ tool: 'heliusWallet', action: 'getBalance' });
    expect(miss('heliusAsset', 'getAssetByOwner').suggestion).toEqual({ tool: 'heliusAsset', action: 'getAssetsByOwner' });
  });

  it('lists the tool\'s actions when nothing is close', () => {
    const result = miss('heliusWallet', 'launchRocket');
    expect(result.kind).toBe('unknown');
    expect(result.suggestion).toBeUndefined();
    expect(result.message).toContain('Its actions: getBalance, getTokenBalances');
  });

  it('clips a long requested name in the message', () => {
    expect(miss('heliusWallet', 'x'.repeat(500)).message.length).toBeLessThan(800);
  });

  it('never suggests an action the read-only surface removes', () => {
    const writes = ACTION_NAMES.filter((action) => !isOnSurface(ACTION_CATALOG[action], 'readOnly'));
    for (const write of writes) {
      for (const variant of [write.toLowerCase(), `${write}s`, `heliusWrite.${write}`]) {
        const resolution = resolveRoutedAction('heliusWallet', variant, 'readOnly');
        expect(resolution.ok, variant).toBe(false);
        if (resolution.ok) continue;
        if (resolution.suggestion) {
          expect(isOnSurface(ACTION_CATALOG[resolution.suggestion.action], 'readOnly'), variant).toBe(true);
        }
        expect(resolution.message, variant).not.toContain('heliusWrite with');
      }
    }
  });
});

describe('dispatch of an action the tool does not have', () => {
  const handler = vi.mocked(callActionHandler);
  const feedback = vi.mocked(sendFeedbackEvent);

  beforeEach(() => {
    handler.mockClear();
    feedback.mockClear();
  });

  it('answers with the call to make and runs nothing', async () => {
    const result = await dispatchRoutedTool('heliusWallet', { action: 'getTokenAccounts', owner: 'abc' }, {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Call heliusChain with action "getTokenAccounts"');
    expect(result._meta).toMatchObject({
      code: 'WRONG_TOOL',
      reason: 'wrongTool',
      suggestedTool: 'heliusChain',
      suggestedAction: 'getTokenAccounts',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('records the miss with the model that made it', async () => {
    await dispatchRoutedTool('heliusChain', { action: 'getSignaturesForAddress' }, {}, 'full', {
      _feedback: 'probe',
      _feedbackTool: 'heliusChain.getSignaturesForAddress',
      _model: 'test-model',
    });
    expect(feedback).toHaveBeenCalledWith({
      type: 'routing_miss',
      toolName: 'heliusChain',
      requestedAction: 'getSignaturesForAddress',
      missKind: 'alias',
      suggestedTarget: 'heliusTransaction.getTransactionHistory',
      model: 'test-model',
    });
  });

  it('keeps an odd requested name out of telemetry', async () => {
    await dispatchRoutedTool('heliusWallet', { action: 'get balance for wallet 7xKX' }, {});
    expect(feedback.mock.calls[0][0]).toMatchObject({ requestedAction: '[unrecognized]' });
  });

  it('refuses a removed action on the read-only surface, whichever tool it was sent to', async () => {
    const result = await dispatchRoutedTool('heliusWallet', { action: 'transferSol' }, {}, 'readOnly');
    expect(result.isError).toBe(true);
    expect(result._meta).toMatchObject({ code: 'NOT_ON_SURFACE' });
    expect(handler).not.toHaveBeenCalled();
    expect(feedback).not.toHaveBeenCalled();
  });

  it('still requires an action', async () => {
    const result = await dispatchRoutedTool('heliusWallet', {}, {});
    expect(result._meta).toMatchObject({ code: 'MISSING_ACTION' });
  });
});

describe('over MCP', () => {
  it('lets a misrouted action past schema validation so dispatch can redirect it', async () => {
    const server = createServer({ surface: 'full' });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'resolution-test', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({
      name: 'heliusWallet',
      arguments: { action: 'getTokenAccounts', _feedback: 'probe', _feedbackTool: 'heliusWallet.getTokenAccounts', _model: 'probe' },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(result.isError).toBe(true);
    expect(text).not.toContain('Input validation error');
    expect(text).toContain('Call heliusChain with action "getTokenAccounts"');
  });
});
