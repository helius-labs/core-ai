import { describe, it, expect, beforeEach, vi } from 'vitest';

// Projects no longer get an API key at creation. Signup must finish with a
// keyless project and offer `createApiKey`, rather than wait for a key.

const { getJwtMock, setSharedApiKeyMock, clearSharedApiKeyMock, listProjectsMock, getProjectMock, createApiKeyMock, signupMock } = vi.hoisted(() => ({
  getJwtMock: vi.fn<() => string | undefined>(() => 'jwt-1'),
  setSharedApiKeyMock: vi.fn(),
  clearSharedApiKeyMock: vi.fn(),
  listProjectsMock: vi.fn(),
  getProjectMock: vi.fn(),
  createApiKeyMock: vi.fn(),
  signupMock: vi.fn(),
}));

vi.mock('../src/utils/config.js', () => ({
  getSharedApiKey: vi.fn(() => undefined),
  loadConfig: vi.fn(() => ({})),
  saveConfig: vi.fn(),
  setSharedApiKey: setSharedApiKeyMock,
  clearSharedApiKey: clearSharedApiKeyMock,
  getJwt: getJwtMock,
  setJwt: vi.fn(),
  getPreferences: vi.fn(() => ({})),
  savePreferences: vi.fn(),
  keypairExistsOnDisk: vi.fn(() => false),
  loadKeypairFromDisk: vi.fn(() => null),
  saveKeypairToDisk: vi.fn(),
  SHARED_CONFIG_PATH: '',
  KEYPAIR_PATH: '',
}));

vi.mock('helius-sdk', () => ({ createHelius: vi.fn(() => ({ mock: 'helius-client' })) }));
vi.mock('helius-sdk/auth/listProjects', () => ({ listProjects: listProjectsMock }));
vi.mock('helius-sdk/auth/getProject', () => ({ getProject: getProjectMock }));
vi.mock('helius-sdk/auth/createApiKey', () => ({ createApiKey: createApiKeyMock }));
vi.mock('helius-sdk/auth/signup', () => ({ signup: signupMock }));
vi.mock('../src/utils/helius.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/utils/helius.js')>()),
  loadSignerOrFail: vi.fn(async () => ({ secretKey: new Uint8Array(64), walletAddress: 'Wallet111' })),
}));

type Result = { content: { type: string; text: string }[]; isError?: boolean };
type Handler = (args: unknown, extra?: unknown) => Promise<Result>;

async function captureHandlers(): Promise<Record<string, Handler>> {
  const { registerAuthTools } = await import('../src/tools/auth.js');
  const handlers: Record<string, Handler> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerAuthTools({ registerAction: (...args: any[]) => { handlers[args[0]] = args[args.length - 1]; } } as any);
  return handlers;
}

const PROJECT = { id: 'proj-1', users: [{ id: 'OwnerWallet', role: 'Owner', name: '', email: '' }] };

beforeEach(async () => {
  vi.clearAllMocks();
  delete process.env.HELIUS_MCP_SHARED_CREDENTIAL;
  delete process.env.HELIUS_API_KEY;
  getJwtMock.mockReturnValue('jwt-1');
  listProjectsMock.mockResolvedValue([PROJECT]);
  getProjectMock.mockResolvedValue({ apiKeys: [] });
  const { setApiKey } = await import('../src/utils/helius.js');
  setApiKey('');
});

describe('signup resume with a keyless project', () => {
  it('reports signup complete and offers createApiKey instead of asking to retry', async () => {
    const { signup } = await captureHandlers();
    const { isError, content } = await signup({ mode: 'resume', plan: 'agent' });
    const text = content[0].text;

    expect(isError).toBeFalsy();
    expect(text).toContain('Signup complete');
    expect(text).toContain('proj-1');
    expect(text).toContain('createApiKey');
    expect(text).not.toMatch(/try again/i);
    expect(createApiKeyMock).not.toHaveBeenCalled();
    expect(setSharedApiKeyMock).not.toHaveBeenCalled();
  });

  it('drops a key left from another account, so tools stop billing it', async () => {
    const { setApiKey, hasApiKey } = await import('../src/utils/helius.js');
    setApiKey('account-a-key');
    const { signup } = await captureHandlers();
    await signup({ mode: 'resume', plan: 'agent' });

    expect(hasApiKey()).toBe(false);
    expect(clearSharedApiKeyMock).toHaveBeenCalled();
  });

  it('still configures the key when the project already has one', async () => {
    getProjectMock.mockResolvedValue({ apiKeys: [{ keyId: 'key-1' }] });
    const { signup } = await captureHandlers();
    const { content } = await signup({ mode: 'resume', plan: 'agent' });

    expect(content[0].text).toContain('key-1');
    expect(setSharedApiKeyMock).toHaveBeenCalledWith('key-1');
  });

  it('link mode handles an existing account with no key', async () => {
    signupMock.mockResolvedValue({
      kind: 'already_subscribed', jwt: 'jwt-1', refId: 'r', walletAddress: 'Wallet111', projectId: 'proj-1',
      apiKey: undefined, endpoints: undefined,
    });
    const { signup } = await captureHandlers();
    const { isError, content } = await signup({ mode: 'link', plan: 'agent' });

    expect(isError).toBeFalsy();
    expect(content[0].text).toContain('Helius Account Found');
    expect(content[0].text).toContain('createApiKey');
    expect(setSharedApiKeyMock).not.toHaveBeenCalled();
  });
});

describe('createApiKey', () => {
  it('creates a key bound to the project owner and configures it', async () => {
    createApiKeyMock.mockResolvedValue({ keyId: 'new-key' });
    const { createApiKey } = await captureHandlers();
    const { isError, content } = await createApiKey({});

    expect(isError).toBeFalsy();
    expect(createApiKeyMock).toHaveBeenCalledWith('jwt-1', 'proj-1', 'OwnerWallet', expect.any(String));
    expect(setSharedApiKeyMock).toHaveBeenCalledWith('new-key');
    expect(content[0].text).toContain('new-key');
  });

  it('refuses without a session', async () => {
    getJwtMock.mockReturnValue(undefined);
    const { createApiKey } = await captureHandlers();
    const { isError, content } = await createApiKey({});

    expect(isError).toBe(true);
    expect(content[0].text).toContain('NOT_AUTHENTICATED');
    expect(createApiKeyMock).not.toHaveBeenCalled();
  });

  it('rejects a project the account does not have', async () => {
    const { createApiKey } = await captureHandlers();
    const { isError, content } = await createApiKey({ projectId: 'proj-other' });

    expect(isError).toBe(true);
    expect(content[0].text).toContain('PROJECT_NOT_FOUND');
    expect(createApiKeyMock).not.toHaveBeenCalled();
  });

  it('refuses under a shared credential, before creating anything', async () => {
    process.env.HELIUS_MCP_SHARED_CREDENTIAL = '1';
    const { createApiKey } = await captureHandlers();
    const { isError } = await createApiKey({});

    expect(isError).toBe(true);
    expect(createApiKeyMock).not.toHaveBeenCalled();
  });
});

describe('a signed-in session with no key', () => {
  it('getAccountStatus shows the account and offers createApiKey', async () => {
    getProjectMock.mockResolvedValue({ apiKeys: [], subscriptionPlanDetails: { currentPlan: 'agent' } });
    const { getAccountStatus } = await captureHandlers();
    const { content } = await getAccountStatus({});
    const text = content[0].text;

    expect(text).not.toContain('Not authenticated');
    expect(text).toContain('proj-1');
    expect(text).toContain('createApiKey');
  });

  it('getAccountStatus lists the project\'s keys by name with masked IDs, never the full key', async () => {
    const full1 = '1a2b3c4d-0000-0000-0000-00000000beef';
    const full2 = '5e6f7a8b-0000-0000-0000-00000000cafe';
    getProjectMock.mockResolvedValue({
      apiKeys: [{ keyId: full1, keyName: 'default' }, { keyId: full2, keyName: '' }],
      subscriptionPlanDetails: { currentPlan: 'agent' },
    });
    const { getAccountStatus } = await captureHandlers();
    const { content } = await getAccountStatus({});
    const text = content[0].text;

    expect(text).not.toContain(full1);
    expect(text).not.toContain(full2);
    expect(text).toContain('default `1a2b…beef`');
    expect(text).toContain('`5e6f…cafe`');
    expect(text).toContain('setHeliusApiKey');
    expect(text).toContain('helius apikeys');
    expect(text).not.toContain('createApiKey');
  });

  it('getAccountStatus caps the key list', async () => {
    const apiKeys = Array.from({ length: 7 }, (_, i) => ({ keyId: `key${i + 1}-0000-0000-0000-000000000000`, keyName: `k${i + 1}` }));
    getProjectMock.mockResolvedValue({ apiKeys, subscriptionPlanDetails: { currentPlan: 'agent' } });
    const { getAccountStatus } = await captureHandlers();
    const { content } = await getAccountStatus({});
    const text = content[0].text;

    expect(text).toContain('k5 ');
    expect(text).not.toContain('k6 ');
    expect(text).toContain('2 more');
  });

  it('getAccountStatus does not list the host\'s keys under a shared credential', async () => {
    process.env.HELIUS_MCP_SHARED_CREDENTIAL = '1';
    getProjectMock.mockResolvedValue({
      apiKeys: [{ keyId: 'host-key', keyName: 'default' }],
      subscriptionPlanDetails: { currentPlan: 'agent' },
    });
    const { getAccountStatus } = await captureHandlers();
    const { content } = await getAccountStatus({});

    expect(content[0].text).not.toContain('host-key');
  });

  it('getStarted offers createApiKey rather than a fresh signup', async () => {
    const { getStarted } = await captureHandlers();
    const { content } = await getStarted({});

    expect(content[0].text).toContain('createApiKey');
    expect(content[0].text).not.toContain('Path C');
  });
});
