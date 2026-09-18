import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { contextFromExtra, type RequestContext } from '../src/utils/request-context.js';
import { getApiKey, hasApiKey, getNetwork, getEnhancedWebSocketUrl } from '../src/utils/helius.js';

const CALLER_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const CALLER_B = 'bbbbbbbb-5555-6666-7777-888888888888';

function extraWith(authInfo: unknown): unknown {
  return { authInfo };
}

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    apiKey: CALLER_A,
    network: 'mainnet-beta',
    sessionKey: 'test-session',
    ...overrides,
  };
}

describe('contextFromExtra', () => {
  it('returns null when the request carries no identity', () => {
    // stdio: not an error, the caller falls back to module state
    expect(contextFromExtra(undefined)).toBeNull();
    expect(contextFromExtra(null)).toBeNull();
    expect(contextFromExtra('nonsense')).toBeNull();
    expect(contextFromExtra({})).toBeNull();
    expect(contextFromExtra(extraWith(undefined))).toBeNull();
  });

  it('returns null when authInfo carries no token', () => {
    expect(contextFromExtra(extraWith({ clientId: 'proj_1' }))).toBeNull();
    expect(contextFromExtra(extraWith({ token: '' }))).toBeNull();
    expect(contextFromExtra(extraWith({ token: 42 }))).toBeNull();
  });

  it('reads the key from authInfo.token', () => {
    expect(contextFromExtra(extraWith({ token: CALLER_A }))?.apiKey).toBe(CALLER_A);
  });

  it('reads the project from authInfo.clientId', () => {
    const built = contextFromExtra(extraWith({ token: CALLER_A, clientId: 'proj_1' }));
    expect(built?.projectId).toBe('proj_1');
  });

  it('leaves the project undefined when clientId is absent or empty', () => {
    expect(contextFromExtra(extraWith({ token: CALLER_A }))?.projectId).toBeUndefined();
    expect(contextFromExtra(extraWith({ token: CALLER_A, clientId: '' }))?.projectId).toBeUndefined();
  });

  it('reads the network from authInfo.extra, defaulting to mainnet', () => {
    expect(contextFromExtra(extraWith({ token: CALLER_A }))?.network).toBe('mainnet-beta');
    expect(
      contextFromExtra(extraWith({ token: CALLER_A, extra: { network: 'devnet' } }))?.network,
    ).toBe('devnet');
    expect(
      contextFromExtra(extraWith({ token: CALLER_A, extra: { network: 'nonsense' } }))?.network,
    ).toBe('mainnet-beta');
  });
});

describe('sessionKey', () => {
  it('is stable across requests from the same caller', () => {
    // Handles are issued by one request and redeemed by the next, so a
    // per-request key would break expansion immediately.
    const first = contextFromExtra(extraWith({ token: CALLER_A, clientId: 'proj_1' }));
    const second = contextFromExtra(extraWith({ token: CALLER_A, clientId: 'proj_1' }));
    expect(first?.sessionKey).toBe(second?.sessionKey);
  });

  it('differs between callers', () => {
    const a = contextFromExtra(extraWith({ token: CALLER_A }));
    const b = contextFromExtra(extraWith({ token: CALLER_B }));
    expect(a?.sessionKey).not.toBe(b?.sessionKey);
  });

  it('differs when the same key is presented under a different project', () => {
    const a = contextFromExtra(extraWith({ token: CALLER_A, clientId: 'proj_1' }));
    const b = contextFromExtra(extraWith({ token: CALLER_A, clientId: 'proj_2' }));
    expect(a?.sessionKey).not.toBe(b?.sessionKey);
  });

  it('does not contain the raw key', () => {
    const built = contextFromExtra(extraWith({ token: CALLER_A }));
    expect(built?.sessionKey).not.toContain(CALLER_A);
    expect(built?.sessionKey).toHaveLength(32);
  });
});

describe('resolvers with a context', () => {
  const originalKey = process.env.HELIUS_API_KEY;
  const originalNetwork = process.env.HELIUS_NETWORK;

  beforeEach(() => {
    process.env.HELIUS_API_KEY = 'env-key-00000000';
    delete process.env.HELIUS_NETWORK;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.HELIUS_API_KEY;
    else process.env.HELIUS_API_KEY = originalKey;
    if (originalNetwork === undefined) delete process.env.HELIUS_NETWORK;
    else process.env.HELIUS_NETWORK = originalNetwork;
  });

  it('prefers the context key over the environment', () => {
    expect(getApiKey(ctx())).toBe(CALLER_A);
  });

  it('falls back to the environment when no context is given', () => {
    expect(getApiKey()).toBe('env-key-00000000');
  });

  it('prefers the context network over the environment', () => {
    process.env.HELIUS_NETWORK = 'mainnet-beta';
    expect(getNetwork(ctx({ network: 'devnet' }))).toBe('devnet');
  });

  it('keeps the existing env-then-session order when no context is given', () => {
    process.env.HELIUS_NETWORK = 'devnet';
    expect(getNetwork()).toBe('devnet');
  });

  it('reports a key as present when the context carries one', () => {
    // Deliberately not asserting the no-context negative: the fallback chain
    // ends at the on-disk shared config, so that result depends on the machine.
    delete process.env.HELIUS_API_KEY;
    expect(hasApiKey(ctx())).toBe(true);
  });

  it('builds the WebSocket URL from the context, not module state', () => {
    const url = getEnhancedWebSocketUrl(ctx({ network: 'devnet' }));
    expect(url).toContain('atlas-devnet');
    expect(url).toContain(CALLER_A);
  });
});
