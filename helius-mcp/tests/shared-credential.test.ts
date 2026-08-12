import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock filesystem-dependent config to keep tests hermetic
vi.mock('../src/utils/config.js', () => ({
  getSharedApiKey: vi.fn(() => undefined),
  loadConfig: vi.fn(() => ({})),
  saveConfig: vi.fn(),
  setSharedApiKey: vi.fn(),
  getJwt: vi.fn(() => undefined),
  setJwt: vi.fn(),
  getPreferences: vi.fn(() => ({})),
  savePreferences: vi.fn(),
  keypairExistsOnDisk: vi.fn(() => false),
  loadKeypairFromDisk: vi.fn(() => null),
  saveKeypairToDisk: vi.fn(),
  SHARED_CONFIG_PATH: '',
  KEYPAIR_PATH: '',
}));

vi.mock('helius-sdk', () => ({
  createHelius: vi.fn(() => ({ mock: 'helius-client' })),
}));

import {
  setApiKey,
  getApiKey,
  hasApiKey,
  setNetwork,
  getNetwork,
  getEnhancedWebSocketUrl,
} from '../src/utils/helius.js';

const SERVER_KEY = 'b1f3c9de-4a77-4a2f-9d0e-2c6f8a1b5e44';

function enterSharedMode(): void {
  process.env.HELIUS_MCP_SHARED_CREDENTIAL = '1';
}

beforeEach(() => {
  delete process.env.HELIUS_MCP_SHARED_CREDENTIAL;
  delete process.env.HELIUS_API_KEY;
  delete process.env.HELIUS_NETWORK;
  // Clear module-global session state while mutation is still permitted.
  setApiKey('');
  setNetwork('mainnet-beta');
});

afterEach(() => {
  delete process.env.HELIUS_MCP_SHARED_CREDENTIAL;
  delete process.env.HELIUS_API_KEY;
  delete process.env.HELIUS_NETWORK;
});

// ─── Runtime Mutation Is Refused ──────────────────────────────────────────────

describe('setApiKey under a shared credential', () => {
  it('refuses, so one caller cannot repoint the key for everyone', () => {
    enterSharedMode();
    expect(() => setApiKey('caller-supplied-key')).toThrow('SHARED_CREDENTIAL');
  });

  it('leaves the deployment key in place after a refused attempt', () => {
    process.env.HELIUS_API_KEY = SERVER_KEY;
    enterSharedMode();

    expect(() => setApiKey('caller-supplied-key')).toThrow();
    expect(getApiKey()).toBe(SERVER_KEY);
  });

  it('still works in single-tenant mode', () => {
    setApiKey('my-own-key');
    expect(getApiKey()).toBe('my-own-key');
  });
});

describe('setNetwork under a shared credential', () => {
  it('refuses, since the network is process-global', () => {
    enterSharedMode();
    expect(() => setNetwork('devnet')).toThrow('SHARED_CREDENTIAL');
  });

  it('leaves the deployment network in place after a refused attempt', () => {
    enterSharedMode();
    expect(() => setNetwork('devnet')).toThrow();
    expect(getNetwork()).toBe('mainnet-beta');
  });

  it('still works in single-tenant mode', () => {
    setNetwork('devnet');
    expect(getNetwork()).toBe('devnet');
  });
});

// ─── Deployment Configuration Still Resolves ──────────────────────────────────

describe('deployment-provided configuration', () => {
  it('resolves the key from HELIUS_API_KEY without any runtime seeding', () => {
    process.env.HELIUS_API_KEY = SERVER_KEY;
    enterSharedMode();

    expect(hasApiKey()).toBe(true);
    expect(getApiKey()).toBe(SERVER_KEY);
  });

  it('resolves the network from HELIUS_NETWORK', () => {
    process.env.HELIUS_NETWORK = 'devnet';
    enterSharedMode();

    expect(getNetwork()).toBe('devnet');
  });

  it('still reports a missing key so startup can fail loudly', () => {
    enterSharedMode();
    expect(hasApiKey()).toBe(false);
    expect(() => getApiKey()).toThrow('NO_API_KEY');
  });
});

// ─── WebSocket URL Never Carries the Shared Key ───────────────────────────────

describe('getEnhancedWebSocketUrl', () => {
  it('returns a placeholder instead of the deployment key', () => {
    process.env.HELIUS_API_KEY = SERVER_KEY;
    enterSharedMode();

    const url = getEnhancedWebSocketUrl();
    expect(url).not.toContain(SERVER_KEY);
    expect(url).toContain('YOUR_HELIUS_API_KEY');
  });

  it('returns a usable URL in single-tenant mode', () => {
    process.env.HELIUS_API_KEY = SERVER_KEY;
    expect(getEnhancedWebSocketUrl()).toContain(SERVER_KEY);
  });
});
