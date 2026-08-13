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
  loadSignerOrFail,
  setSessionSecretKey,
  setSessionWalletAddress,
} from '../src/utils/helius.js';
import { resolveOwsOrKeypairSigner } from '../src/utils/ows.js';

const SERVER_KEY = 'b1f3c9de-4a77-4a2f-9d0e-2c6f8a1b5e44';

function enterSharedMode(): void {
  process.env.HELIUS_MCP_SHARED_CREDENTIAL = '1';
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.HELIUS_MCP_SHARED_CREDENTIAL;
  delete process.env.HELIUS_API_KEY;
  delete process.env.HELIUS_NETWORK;
  // Clear module-global session state while mutation is still permitted.
  setApiKey('');
  setNetwork('mainnet-beta');
  setSessionSecretKey(null as unknown as Uint8Array);
  setSessionWalletAddress(null as unknown as string);
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

// ─── No Signer On A Shared Server ─────────────────────────────────────────────

describe('loadSignerOrFail under a shared credential', () => {
  it('refuses instead of lazily loading a keypair from the host disk', async () => {
    enterSharedMode();
    await expect(loadSignerOrFail()).rejects.toThrow('SHARED_CREDENTIAL_NO_SIGNER');
  });

  it('does not read the keypair file at all', async () => {
    const { loadKeypairFromDisk } = await import('../src/utils/config.js');
    enterSharedMode();

    await expect(loadSignerOrFail()).rejects.toThrow();
    expect(loadKeypairFromDisk).not.toHaveBeenCalled();
  });

  it('still reports NO_KEYPAIR in single-tenant mode', async () => {
    // Mocked loadKeypairFromDisk returns null, so this is the no-wallet path.
    await expect(loadSignerOrFail()).rejects.toThrow('NO_KEYPAIR');
  });
});

describe('resolveOwsOrKeypairSigner under a shared credential', () => {
  it('refuses the local-keypair path with SHARED_CREDENTIAL, not NO_KEYPAIR', async () => {
    enterSharedMode();

    const result = await resolveOwsOrKeypairSigner();
    expect(result.ok).toBe(false);
    const text = result.ok ? '' : result.error.content[0].text;
    expect(text).toContain('Transaction signing is unavailable on this server');
    // The catch-all below flattens every failure into this advice, which is a
    // dead end here because generateKeypair also refuses.
    expect(text).not.toContain('Call `generateKeypair`');
  });

  it('refuses the OWS path too, before shelling out to the host CLI', async () => {
    enterSharedMode();

    const result = await resolveOwsOrKeypairSigner('my-wallet');
    expect(result.ok).toBe(false);
    const text = result.ok ? '' : result.error.content[0].text;
    expect(text).toContain('Transaction signing is unavailable on this server');
  });
});

// ─── Wallet And Account Tools Refuse ──────────────────────────────────────────

/** Captures registered handlers; the handler is always the last argument. */
async function captureAuthTools(): Promise<Record<string, (args: unknown) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>>> {
  const { registerAuthTools } = await import('../src/tools/auth.js');
  const handlers: Record<string, (args: unknown) => Promise<never>> = {};
  const fakeServer = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool: (...args: any[]) => {
      handlers[args[0]] = args[args.length - 1];
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  registerAuthTools(fakeServer);
  return handlers;
}

describe('wallet and account tools under a shared credential', () => {
  it('generateKeypair refuses rather than writing a key to the host disk', async () => {
    const handlers = await captureAuthTools();
    enterSharedMode();

    const result = await handlers.generateKeypair({});
    expect(result.isError).toBe(true);
    // The distinctive refusal, not just the code — an ungated handler throws an
    // error that also contains "SHARED_CREDENTIAL", so the code alone proves nothing.
    expect(result.content[0].text).toContain('Keypair generation is unavailable on this server');
  });

  it('signup refuses before any payment path is reached', async () => {
    const handlers = await captureAuthTools();
    enterSharedMode();

    const result = await handlers.signup({ mode: 'link', plan: 'agent' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Account signup is unavailable on this server');
  });

  it('signup resume refuses too, so a provisioned key is never dropped mid-flow', async () => {
    const handlers = await captureAuthTools();
    enterSharedMode();

    const result = await handlers.signup({ mode: 'resume', plan: 'agent' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Account signup is unavailable on this server');
  });
});
