import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasApiKey, getHeliusClient } from '../src/utils/helius.js';
import { callActionHandler } from '../src/router/action-handlers.js';

vi.mock('../src/utils/helius.js', () => ({
  hasApiKey: vi.fn(() => true),
  getApiKey: vi.fn(() => 'test-key'),
  getHeliusClient: vi.fn(),
  getNetwork: vi.fn(() => 'mainnet-beta'),
  getEnhancedWebSocketUrl: vi.fn(() => 'wss://test'),
  getLaserstreamUrl: vi.fn(() => 'https://test'),
  setApiKey: vi.fn(),
  setNetwork: vi.fn(),
  restRequest: vi.fn(),
  setSessionSecretKey: vi.fn(),
  getSessionSecretKey: vi.fn(() => null),
  setSessionWalletAddress: vi.fn(),
  getSessionWalletAddress: vi.fn(() => null),
  loadSignerOrFail: vi.fn(),
}));

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

interface WalletFixture {
  address: string;
  history: Array<{ timestamp: number | null; signature: string; slot: number; fee: number; feePayer: string; error: string | null; balanceChanges: unknown[] }>;
  balances: Array<{ usdValue: number | null }>;
  funded: { timestamp: number } | null;
}

interface DiscoveryFixture {
  holders: Array<{ owner: string; amount: number }>;
  identities: Array<{ address: string; type?: string; name?: string; category?: string; tags?: string[] }>;
  wallets: Map<string, WalletFixture>;
}

function makeTx(daysAgo: number) {
  return {
    timestamp: NOW - Math.round(daysAgo * DAY),
    signature: `sig_${daysAgo}`,
    slot: 100_000_000,
    fee: 0.000005,
    feePayer: 'test',
    error: null,
    balanceChanges: [],
  };
}

function mockClient(fixture: DiscoveryFixture): void {
  vi.mocked(getHeliusClient).mockReturnValue({
    getTokenAccounts: vi.fn().mockResolvedValue({ token_accounts: fixture.holders }),
    wallet: {
      getBatchIdentity: vi.fn().mockResolvedValue(fixture.identities),
      getHistory: vi.fn().mockImplementation(({ wallet }) => {
        const w = fixture.wallets.get(wallet);
        return Promise.resolve({ data: w?.history ?? [], pagination: { hasMore: false } });
      }),
      getBalances: vi.fn().mockImplementation(({ wallet }) => {
        const w = fixture.wallets.get(wallet);
        return Promise.resolve({ balances: w?.balances ?? [], totalUsdValue: 0, pagination: { page: 1, limit: 100, hasMore: false } });
      }),
      getFundedBy: vi.fn().mockImplementation(({ wallet }) => {
        const w = fixture.wallets.get(wallet);
        return w?.funded === null
          ? Promise.reject(new Error('not found'))
          : Promise.resolve(w?.funded);
      }),
    },
  } as unknown as ReturnType<typeof getHeliusClient>);
}

async function search(params: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
  const result = await callActionHandler('searchTopWallets', params, {});
  const text = (result.content?.[0] as { text: string } | undefined)?.text ?? '';
  return { text, isError: result.isError };
}

describe('searchTopWallets — orchestration', () => {
  beforeEach(() => {
    vi.mocked(hasApiKey).mockReturnValue(true);
    vi.mocked(getHeliusClient).mockReset();
  });

  it('returns ranked list with score components', async () => {
    const wallets = new Map<string, WalletFixture>([
      ['active', {
        address: 'active',
        history: Array.from({ length: 30 }, (_, i) => makeTx(i)),
        balances: Array.from({ length: 10 }, () => ({ usdValue: 100 })),
        funded: { timestamp: NOW - 365 * DAY },
      }],
      ['quiet', {
        address: 'quiet',
        history: [makeTx(20)],
        balances: [{ usdValue: 100 }],
        funded: { timestamp: NOW - 365 * DAY },
      }],
      ['dormant', {
        address: 'dormant',
        history: [makeTx(60)],
        balances: [{ usdValue: 100 }],
        funded: { timestamp: NOW - 365 * DAY },
      }],
    ]);

    mockClient({
      holders: [
        { owner: 'active', amount: 1000 },
        { owner: 'quiet', amount: 500 },
        { owner: 'dormant', amount: 100 },
      ],
      identities: [
        { address: 'active' },
        { address: 'quiet' },
        { address: 'dormant' },
      ],
      wallets,
    });

    const { text, isError } = await search({ mint: 'fake_mint', limit: 3 });
    expect(isError).toBeFalsy();
    // Active should rank #1
    expect(text).toMatch(/\|\s*1\s*\|\s*`?active/);
    expect(text).toContain('Top 3 Wallets');
    // Components header should be in the table
    expect(text).toContain('Activity');
    expect(text).toContain('Diversification');
    expect(text).toContain('Recency');
    expect(text).toContain('HoldAge');
  });

  it('filters out CEX/labeled wallets before scoring', async () => {
    const wallets = new Map<string, WalletFixture>([
      ['unlabeled', {
        address: 'unlabeled',
        history: [makeTx(1)],
        balances: [{ usdValue: 100 }],
        funded: { timestamp: NOW - 100 * DAY },
      }],
    ]);

    mockClient({
      holders: [
        { owner: 'cex_1', amount: 1000 },
        { owner: 'cex_2', amount: 800 },
        { owner: 'unlabeled', amount: 200 },
      ],
      identities: [
        { address: 'cex_1', type: 'exchange', name: 'Binance' },
        { address: 'cex_2', type: 'exchange', name: 'Coinbase' },
        { address: 'unlabeled' }, // no name → not filtered
      ],
      wallets,
    });

    const { text } = await search({ mint: 'fake_mint', limit: 5 });
    expect(text).toContain('3 top holders, 1 after CEX/program filter');
    expect(text).not.toContain('cex_1');
    expect(text).not.toContain('cex_2');
    expect(text).toMatch(/unlab/);
  });

  it('returns NO_HOLDERS error when mint has no holders', async () => {
    mockClient({
      holders: [],
      identities: [],
      wallets: new Map(),
    });

    const { text, isError } = await search({ mint: 'empty_mint' });
    expect(isError).toBeTruthy();
    expect(text).toContain('No holders found');
  });

  it('reports when all candidates are filtered out as CEX/programs', async () => {
    mockClient({
      holders: [
        { owner: 'cex_1', amount: 1000 },
        { owner: 'cex_2', amount: 500 },
      ],
      identities: [
        { address: 'cex_1', type: 'exchange', name: 'Binance' },
        { address: 'cex_2', type: 'exchange', name: 'Coinbase' },
      ],
      wallets: new Map(),
    });

    const { text, isError } = await search({ mint: 'all_cex_mint' });
    expect(isError).toBeFalsy();
    expect(text).toContain('All 2 top holders are labeled');
  });

  it('caps limit at 20', async () => {
    const wallets = new Map<string, WalletFixture>();
    const holders: Array<{ owner: string; amount: number }> = [];
    const identities: Array<{ address: string }> = [];
    for (let i = 0; i < 15; i++) {
      const addr = `wallet_${i}`;
      holders.push({ owner: addr, amount: 1000 - i });
      identities.push({ address: addr });
      wallets.set(addr, {
        address: addr,
        history: [makeTx(1)],
        balances: [{ usdValue: 100 }],
        funded: { timestamp: NOW - 100 * DAY },
      });
    }

    mockClient({ holders, identities, wallets });

    const { text } = await search({ mint: 'fake', limit: 50 });
    // 50 capped at 20, but only 15 available → all 15 shown
    expect(text).toContain('Top 15 Wallets');
  });

  it('continues when individual scoreWallet calls fail', async () => {
    const goodWallet: WalletFixture = {
      address: 'good',
      history: [makeTx(1)],
      balances: [{ usdValue: 100 }],
      funded: { timestamp: NOW - 100 * DAY },
    };
    const wallets = new Map([['good', goodWallet]]);

    vi.mocked(getHeliusClient).mockReturnValue({
      getTokenAccounts: vi.fn().mockResolvedValue({
        token_accounts: [
          { owner: 'good', amount: 1000 },
          { owner: 'bad', amount: 500 },
        ],
      }),
      wallet: {
        getBatchIdentity: vi.fn().mockResolvedValue([
          { address: 'good' },
          { address: 'bad' },
        ]),
        getHistory: vi.fn().mockImplementation(({ wallet }) =>
          wallet === 'bad' ? Promise.reject(new Error('rate limited')) : Promise.resolve({ data: goodWallet.history })
        ),
        getBalances: vi.fn().mockImplementation(({ wallet }) =>
          wallet === 'bad' ? Promise.reject(new Error('rate limited')) : Promise.resolve({ balances: goodWallet.balances })
        ),
        getFundedBy: vi.fn().mockImplementation(({ wallet }) =>
          wallet === 'bad' ? Promise.reject(new Error('rate limited')) : Promise.resolve(goodWallet.funded)
        ),
      },
    } as unknown as ReturnType<typeof getHeliusClient>);

    const { text, isError } = await search({ mint: 'fake', limit: 5 });
    expect(isError).toBeFalsy();
    // Both should appear; bad shows ERR
    expect(text).toContain('good');
    expect(text).toContain('bad');
    expect(text).toMatch(/ERR/);
  });

  it('produces deterministic ranking for identical fixtures', async () => {
    const wallets = new Map<string, WalletFixture>([
      ['a', { address: 'a', history: [makeTx(1)], balances: [{ usdValue: 100 }], funded: { timestamp: NOW - 100 * DAY } }],
      ['b', { address: 'b', history: [makeTx(5)], balances: [{ usdValue: 200 }], funded: { timestamp: NOW - 200 * DAY } }],
    ]);
    const fixture: DiscoveryFixture = {
      holders: [{ owner: 'a', amount: 1000 }, { owner: 'b', amount: 500 }],
      identities: [{ address: 'a' }, { address: 'b' }],
      wallets,
    };

    mockClient(fixture);
    const r1 = await search({ mint: 'm', limit: 2 });
    mockClient(fixture);
    const r2 = await search({ mint: 'm', limit: 2 });

    const order1 = (r1.text.match(/\|\s*[12]\s*\|\s*`?(\w+)/g) || []).join('|');
    const order2 = (r2.text.match(/\|\s*[12]\s*\|\s*`?(\w+)/g) || []).join('|');
    expect(order1).toBe(order2);
  });
});
