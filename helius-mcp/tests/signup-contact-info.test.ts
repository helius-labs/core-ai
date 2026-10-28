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

vi.mock('helius-sdk', () => ({
  createHelius: vi.fn(() => ({ mock: 'helius-client' })),
}));

const { signupMock, signupAndPayMock } = vi.hoisted(() => ({
  signupMock: vi.fn(),
  signupAndPayMock: vi.fn(),
}));
vi.mock('helius-sdk/auth/signup', () => ({ signup: signupMock }));
vi.mock('helius-sdk/auth/signupAndPay', () => ({ signupAndPay: signupAndPayMock }));

// A local signer is available, so every case reaches the SDK.
vi.mock('../src/utils/helius.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/utils/helius.js')>()),
  loadSignerOrFail: vi.fn(async () => ({ secretKey: new Uint8Array(64), walletAddress: 'Wallet111' })),
}));

type Handler = (args: unknown) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;

/** Captures registered handlers; the handler is always the last argument. */
async function captureSignup(): Promise<Handler> {
  const { registerAuthTools } = await import('../src/tools/auth.js');
  const handlers: Record<string, Handler> = {};
  const fakeRegistry = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAction: (...args: any[]) => {
      handlers[args[0]] = args[args.length - 1];
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  registerAuthTools(fakeRegistry);
  return handlers.signup;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.HELIUS_MCP_SHARED_CREDENTIAL;
});

const CONTACT_ERROR = new Error('Signup requires contact info. Missing: email, firstName, lastName.');

describe('signup contact info', () => {
  it.each(['link', 'autopay'] as const)(
    '%s mode surfaces the SDK missing-contact error as a validation error',
    async (mode) => {
      signupMock.mockRejectedValue(CONTACT_ERROR);
      signupAndPayMock.mockRejectedValue(CONTACT_ERROR);
      const signup = await captureSignup();

      const result = await signup({ mode, plan: 'agent' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing: email, firstName, lastName');
      expect(result.content[0].text).toContain('MISSING_CONTACT_INFO');
    },
  );

  it('returns the existing key for a wallet that already has an account, without contact info', async () => {
    signupMock.mockResolvedValue({
      kind: 'already_subscribed',
      jwt: 'jwt-1',
      refId: 'ref-1',
      walletAddress: 'Wallet111',
      projectId: 'proj-1',
      apiKey: 'key-1',
      endpoints: {
        mainnet: 'https://mainnet.helius-rpc.com/?api-key=key-1',
        devnet: 'https://devnet.helius-rpc.com/?api-key=key-1',
      },
    });
    const signup = await captureSignup();

    const result = await signup({ mode: 'link', plan: 'agent' });

    expect(signupMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: undefined, firstName: undefined, lastName: undefined }),
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Helius Account Found');
    expect(result.content[0].text).toContain('key-1');
  });

  it('does not require contact info for resume', async () => {
    const signup = await captureSignup();

    const result = await signup({ mode: 'resume', plan: 'agent' });

    expect(result.content[0].text).not.toContain('requires contact info');
  });
});
