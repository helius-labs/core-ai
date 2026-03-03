import { describe, it, expect, beforeEach, vi } from 'vitest';

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

// Mock helius-sdk to avoid real network calls when getHeliusClient is invoked
vi.mock('helius-sdk', () => ({
  createHelius: vi.fn(() => ({ mock: 'helius-client' })),
}));

import {
  setApiKey,
  getApiKey,
  hasApiKey,
  setNetwork,
  getNetwork,
  setSessionSecretKey,
  getSessionSecretKey,
  setSessionWalletAddress,
  getSessionWalletAddress,
} from '../src/utils/helius.js';

// Reset all module-level state and env before every test
beforeEach(() => {
  setApiKey('');
  setNetwork('mainnet-beta');
  setSessionSecretKey(null as unknown as Uint8Array);
  setSessionWalletAddress(null as unknown as string);
  delete process.env.HELIUS_API_KEY;
  delete process.env.HELIUS_NETWORK;
});

// ─── Session Secret Key ───────────────────────────────────────────────────────

describe('sessionSecretKey', () => {
  it('returns null when not set', () => {
    expect(getSessionSecretKey()).toBeNull();
  });

  it('stores and returns the secret key', () => {
    const key = new Uint8Array([1, 2, 3, 4]);
    setSessionSecretKey(key);
    expect(getSessionSecretKey()).toBe(key);
  });

  it('overwrites a previously stored key', () => {
    setSessionSecretKey(new Uint8Array([1]));
    const key2 = new Uint8Array([2]);
    setSessionSecretKey(key2);
    expect(getSessionSecretKey()).toBe(key2);
  });
});

// ─── Session Wallet Address ───────────────────────────────────────────────────

describe('sessionWalletAddress', () => {
  it('returns null when not set', () => {
    expect(getSessionWalletAddress()).toBeNull();
  });

  it('stores and returns the wallet address', () => {
    const addr = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    setSessionWalletAddress(addr);
    expect(getSessionWalletAddress()).toBe(addr);
  });

  it('overwrites a previously stored address', () => {
    setSessionWalletAddress('first');
    setSessionWalletAddress('second');
    expect(getSessionWalletAddress()).toBe('second');
  });
});

// ─── API Key Session State ────────────────────────────────────────────────────

describe('API key state', () => {
  it('hasApiKey returns false when no key is configured', () => {
    expect(hasApiKey()).toBe(false);
  });

  it('hasApiKey returns true after setApiKey', () => {
    setApiKey('my-api-key');
    expect(hasApiKey()).toBe(true);
  });

  it('getApiKey throws NO_API_KEY when no key is configured', () => {
    expect(() => getApiKey()).toThrow('NO_API_KEY');
  });

  it('getApiKey returns the key set by setApiKey', () => {
    setApiKey('my-api-key');
    expect(getApiKey()).toBe('my-api-key');
  });

  it('hasApiKey reads HELIUS_API_KEY from process.env', () => {
    process.env.HELIUS_API_KEY = 'env-key';
    expect(hasApiKey()).toBe(true);
  });

  it('getApiKey returns env key when no session key is set', () => {
    process.env.HELIUS_API_KEY = 'env-key';
    expect(getApiKey()).toBe('env-key');
  });

  it('session key takes precedence over env key', () => {
    process.env.HELIUS_API_KEY = 'env-key';
    setApiKey('session-key');
    expect(getApiKey()).toBe('session-key');
  });
});

// ─── Network Session State ────────────────────────────────────────────────────

describe('network state', () => {
  it('defaults to mainnet-beta', () => {
    expect(getNetwork()).toBe('mainnet-beta');
  });

  it('setNetwork switches to devnet', () => {
    setNetwork('devnet');
    expect(getNetwork()).toBe('devnet');
  });

  it('can switch back from devnet to mainnet-beta', () => {
    setNetwork('devnet');
    setNetwork('mainnet-beta');
    expect(getNetwork()).toBe('mainnet-beta');
  });

  it('HELIUS_NETWORK env var overrides session network', () => {
    setNetwork('mainnet-beta');
    process.env.HELIUS_NETWORK = 'devnet';
    expect(getNetwork()).toBe('devnet');
  });

  it('ignores invalid HELIUS_NETWORK values and falls back to session', () => {
    setNetwork('mainnet-beta');
    process.env.HELIUS_NETWORK = 'testnet'; // not a valid value
    expect(getNetwork()).toBe('mainnet-beta');
  });
});
