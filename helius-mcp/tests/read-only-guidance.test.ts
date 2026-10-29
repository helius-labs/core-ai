import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Key, session, and project state are driven per test; nothing reads the real
// ~/.helius config or reaches the dashboard API.
const state = vi.hoisted(() => ({ jwt: undefined as string | undefined }));

vi.mock('../src/utils/config.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/utils/config.js')>();
  return {
    ...original,
    getJwt: vi.fn(() => state.jwt),
    getSharedApiKey: vi.fn(() => undefined),
    keypairExistsOnDisk: vi.fn(() => false),
    getPreferences: vi.fn(() => ({})),
  };
});

vi.mock('helius-sdk/auth/listProjects', () => ({ listProjects: vi.fn(async () => []) }));

vi.mock('../src/utils/docs.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/utils/docs.js')>();
  return {
    ...original,
    fetchDoc: vi.fn(async () => '## Standard Plans\n\n| Plan | Price |\n|---|---|\n| Agent | $10 |\n'),
  };
});

import { ACTION_NAMES } from '../src/router/actions.js';
import { ACTION_CATALOG } from '../src/router/catalog.js';
import { dispatchRoutedTool } from '../src/router/dispatch.js';
import { isOnSurface, type Surface } from '../src/router/surface.js';
import { getApiKey, setApiKey } from '../src/utils/helius.js';
import { handleToolError } from '../src/utils/errors.js';
import { runOnSurface } from '../src/utils/runtime.js';
import type { RoutedPublicToolName } from '../src/router/action-groups.js';

const REMOVED = [
  ...ACTION_NAMES.filter((action) => !isOnSurface(ACTION_CATALOG[action], 'readOnly')),
  'heliusWrite',
];

/** Fails if the text tells the model to use anything the read-only surface removed. */
function expectNoRemovedActions(text: string): void {
  for (const name of REMOVED) {
    expect(text, `mentions ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`));
  }
}

async function call(
  tool: RoutedPublicToolName,
  action: string,
  surface: Surface,
  params: Record<string, unknown> = {},
): Promise<string> {
  const result = await dispatchRoutedTool(tool, { action, detail: 'full', ...params }, {}, surface);
  return result.content.map((c) => c.text).join('\n');
}

const savedKey = process.env.HELIUS_API_KEY;

function signedOut() { setApiKey(''); state.jwt = undefined; }
function keyOnly() { setApiKey('test-key'); state.jwt = undefined; }
function keyAndSession() { setApiKey('test-key'); state.jwt = 'test-jwt'; }

beforeEach(() => {
  delete process.env.HELIUS_API_KEY;
  signedOut();
});

afterAll(() => {
  if (savedKey !== undefined) process.env.HELIUS_API_KEY = savedKey;
  setApiKey('');
});

// Every account action on the read-only surface, in each state that changes
// its guidance. On the full surface these point at setHeliusApiKey, signup,
// or upgradePlan; here they must point at the environment and the dashboard.
const CASES: Array<{ name: string; setup: () => void; tool: RoutedPublicToolName; action: string; params?: Record<string, unknown> }> = [
  { name: 'getStarted, signed out', setup: signedOut, tool: 'heliusAccount', action: 'getStarted' },
  { name: 'getStarted, key but no session', setup: keyOnly, tool: 'heliusAccount', action: 'getStarted' },
  { name: 'getStarted, key and session', setup: keyAndSession, tool: 'heliusAccount', action: 'getStarted' },
  { name: 'getAccountStatus, signed out', setup: signedOut, tool: 'heliusAccount', action: 'getAccountStatus' },
  { name: 'getAccountStatus, key but no session', setup: keyOnly, tool: 'heliusAccount', action: 'getAccountStatus' },
  { name: 'getAccountStatus, session with no project', setup: keyAndSession, tool: 'heliusAccount', action: 'getAccountStatus' },
  { name: 'getAccountPlan, signed out', setup: signedOut, tool: 'heliusAccount', action: 'getAccountPlan' },
  { name: 'getAccountPlan, key but no session', setup: keyOnly, tool: 'heliusAccount', action: 'getAccountPlan' },
  { name: 'getAccountPlan, session with no project', setup: keyAndSession, tool: 'heliusAccount', action: 'getAccountPlan' },
  { name: 'previewUpgrade, no session', setup: keyOnly, tool: 'heliusAccount', action: 'previewUpgrade', params: { plan: 'developer' } },
  { name: 'previewUpgrade, session with no project', setup: keyAndSession, tool: 'heliusAccount', action: 'previewUpgrade', params: { plan: 'developer' } },
  { name: 'getHeliusPlanInfo', setup: keyOnly, tool: 'heliusAccount', action: 'getHeliusPlanInfo' },
  { name: 'recommendStack', setup: keyOnly, tool: 'heliusKnowledge', action: 'recommendStack', params: { description: 'a trading bot that sends tokens', scale: 'all' } },
  { name: 'a data action with no key', setup: signedOut, tool: 'heliusWallet', action: 'getBalance', params: { address: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr' } },
];

describe('read-only guidance never sends the model to a removed action', () => {
  for (const { name, setup, tool, action, params } of CASES) {
    it(name, async () => {
      setup();
      expectNoRemovedActions(await call(tool, action, 'readOnly', params));
    });
  }

  it('the full surface still offers those actions, so the cases above exercise the swapped text', async () => {
    const full: string[] = [];
    for (const { setup, tool, action, params } of CASES) {
      setup();
      full.push(await call(tool, action, 'full', params));
    }
    const text = full.join('\n');
    for (const name of ['setHeliusApiKey', 'generateKeypair', 'signup', 'upgradePlan', 'createWebhook', 'transferSol']) {
      expect(text, name).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it('points a signed-out caller at HELIUS_API_KEY and the dashboard', async () => {
    const text = await call('heliusAccount', 'getStarted', 'readOnly');
    expect(text).toContain('HELIUS_API_KEY');
    expect(text).toContain('https://dashboard.helius.dev');
  });

  it('keeps a product whose tools are all writes, and says where they are', async () => {
    keyOnly();
    const text = await call('heliusKnowledge', 'recommendStack', 'readOnly', { description: 'a payments app', scale: 'all' });
    expect(text).toContain('**Token Transfers**');
    expect(text).toContain('none on this read-only server');
    // Webhooks keeps its read actions.
    expect(text).toMatch(/`getAllWebhooks`, `getWebhookByID`/);
  });

  it('gives read-only 401 guidance that names the environment, not setHeliusApiKey', () => {
    const readOnly = runOnSurface('readOnly', () => handleToolError(new Error('HTTP 401: Unauthorized'), 'Error'));
    const full = handleToolError(new Error('HTTP 401: Unauthorized'), 'Error');
    expectNoRemovedActions(readOnly.content[0].text);
    expect(readOnly.content[0].text).toContain('HELIUS_API_KEY');
    expect(full.content[0].text).toContain('setHeliusApiKey');
  });

  it('throws a read-only NO_API_KEY that names the environment, not setHeliusApiKey', () => {
    expect(() => runOnSurface('readOnly', () => getApiKey())).toThrow(/^NO_API_KEY: Set the HELIUS_API_KEY environment variable/);
    expect(() => runOnSurface('readOnly', () => getApiKey())).not.toThrow(/setHeliusApiKey/);
    expect(() => getApiKey()).toThrow(/setHeliusApiKey/);
  });
});
