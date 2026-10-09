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

type Handler = (args: unknown) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;

/** Captures registered handlers; the handler is always the last argument. */
async function captureSignup(): Promise<Handler> {
  const { registerAuthTools } = await import('../src/tools/auth.js');
  const handlers: Record<string, Handler> = {};
  const fakeServer = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool: (...args: any[]) => {
      handlers[args[0]] = args[args.length - 1];
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  registerAuthTools(fakeServer);
  return handlers.signup;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.HELIUS_MCP_SHARED_CREDENTIAL;
});

describe('signup contact info', () => {
  it.each(['link', 'autopay'] as const)('%s mode refuses without email before any SDK call', async (mode) => {
    const signup = await captureSignup();

    const result = await signup({ mode, plan: 'agent', firstName: 'Ada', lastName: 'Lovelace' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing: email');
    expect(signupMock).not.toHaveBeenCalled();
    expect(signupAndPayMock).not.toHaveBeenCalled();
  });

  it('lists every missing field', async () => {
    const signup = await captureSignup();

    const result = await signup({ mode: 'link', plan: 'agent' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing: email, firstName, lastName');
  });

  it('does not require contact info for resume', async () => {
    const signup = await captureSignup();

    const result = await signup({ mode: 'resume', plan: 'agent' });

    expect(result.content[0].text).not.toContain('requires contact info');
  });
});
