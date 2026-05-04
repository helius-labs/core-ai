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

interface ScoreFixture {
  history: Array<{
    timestamp: number | null;
    signature: string;
    slot: number;
    fee: number;
    feePayer: string;
    error: string | null;
    balanceChanges: unknown[];
  }>;
  balances: Array<{ usdValue: number | null }>;
  funded: { timestamp: number } | null;
}

function mockClient(fixture: ScoreFixture): void {
  vi.mocked(getHeliusClient).mockReturnValue({
    wallet: {
      getHistory: vi.fn().mockResolvedValue({
        data: fixture.history,
        pagination: { hasMore: false },
      }),
      getBalances: vi.fn().mockResolvedValue({
        balances: fixture.balances,
        totalUsdValue: 0,
        pagination: { page: 1, limit: 100, hasMore: false },
      }),
      getFundedBy: vi.fn().mockImplementation(() =>
        fixture.funded === null
          ? Promise.reject(new Error('not found'))
          : Promise.resolve(fixture.funded),
      ),
    },
  } as unknown as ReturnType<typeof getHeliusClient>);
}

function makeTx(daysAgo: number) {
  return {
    timestamp: NOW - Math.round(daysAgo * DAY),
    signature: `sig_${daysAgo}`,
    slot: 100_000_000 - Math.round(daysAgo * 200_000),
    fee: 0.000005,
    feePayer: 'test',
    error: null,
    balanceChanges: [],
  };
}

async function score(params: Record<string, unknown>): Promise<{ score: number; text: string }> {
  const result = await callActionHandler('scoreWallet', params, {});
  const text = (result.content?.[0] as { text: string } | undefined)?.text ?? '';
  const m = text.match(/Wallet Score:\s*(\d+)\/100/);
  if (!m) throw new Error(`No score in output. isError=${result.isError}, text=${text.slice(0, 300)}`);
  return { score: parseInt(m[1], 10), text };
}

describe('scoreWallet — formula correctness', () => {
  beforeEach(() => {
    vi.mocked(hasApiKey).mockReturnValue(true);
    vi.mocked(getHeliusClient).mockReset();
  });

  it('high-quality active trader profile scores ≥ 70', async () => {
    mockClient({
      history: Array.from({ length: 60 }, (_, i) => makeTx(i * 0.5)),
      balances: Array.from({ length: 15 }, () => ({ usdValue: 100 })),
      funded: { timestamp: NOW - 730 * DAY },
    });

    const { score: s, text } = await score({ address: 'test', lookbackDays: 30 });
    expect(s).toBeGreaterThanOrEqual(70);
    expect(text).not.toContain('EMPTY_WALLET');
    expect(text).not.toContain('NO_RECENT_ACTIVITY');
  });

  it('bag holder profile scores low (10-40)', async () => {
    mockClient({
      history: [makeTx(15)],
      balances: Array.from({ length: 5 }, () => ({ usdValue: 100 })),
      funded: { timestamp: NOW - 1500 * DAY },
    });

    const { score: s } = await score({ address: 'test', lookbackDays: 30 });
    expect(s).toBeGreaterThanOrEqual(10);
    expect(s).toBeLessThanOrEqual(40);
  });

  it('empty wallet flags EMPTY_WALLET', async () => {
    mockClient({
      history: [makeTx(1)],
      balances: [],
      funded: { timestamp: NOW - 100 * DAY },
    });

    const { text } = await score({ address: 'test', lookbackDays: 30 });
    expect(text).toContain('EMPTY_WALLET');
  });

  it('no recent activity flags NO_RECENT_ACTIVITY', async () => {
    mockClient({
      history: [makeTx(60), makeTx(90)],
      balances: [{ usdValue: 100 }],
      funded: { timestamp: NOW - 200 * DAY },
    });

    const { text } = await score({ address: 'test', lookbackDays: 30 });
    expect(text).toContain('NO_RECENT_ACTIVITY');
  });

  it('newly-funded wallet flags NEW_WALLET', async () => {
    mockClient({
      history: [makeTx(1)],
      balances: [{ usdValue: 50 }],
      funded: { timestamp: NOW - 3 * DAY },
    });

    const { text } = await score({ address: 'test', lookbackDays: 30 });
    expect(text).toContain('NEW_WALLET');
  });

  it('falls back to oldest history tx when getFundedBy 404s', async () => {
    mockClient({
      history: [makeTx(1), makeTx(50), makeTx(200)],
      balances: [{ usdValue: 100 }],
      funded: null,
    });

    const { score: s, text } = await score({ address: 'test', lookbackDays: 30 });
    expect(text).toContain('est. from history');
    expect(s).toBeGreaterThan(0);
  });

  it('only counts txs within lookback window for activity', async () => {
    const recentTxs = Array.from({ length: 15 }, (_, i) => makeTx(i * 1.5));
    const oldTxs = Array.from({ length: 35 }, (_, i) => makeTx(40 + i * 1.5));
    mockClient({
      history: [...recentTxs, ...oldTxs],
      balances: [{ usdValue: 100 }],
      funded: { timestamp: NOW - 300 * DAY },
    });

    const { text } = await score({ address: 'test', lookbackDays: 30 });
    expect(text).toMatch(/Activity:\s*25\/100\s*\(15 txs/);
  });

  it('caps holdAge at 100 for very old wallets', async () => {
    mockClient({
      history: [makeTx(1)],
      balances: [{ usdValue: 100 }],
      funded: { timestamp: NOW - 5000 * DAY },
    });

    const { text } = await score({ address: 'test', lookbackDays: 30 });
    expect(text).toMatch(/Hold age:\s*100\/100/);
  });

  it('caps activity at 100 for hyper-active wallets', async () => {
    mockClient({
      history: Array.from({ length: 1000 }, (_, i) => makeTx(i * 0.03)),
      balances: [{ usdValue: 100 }],
      funded: { timestamp: NOW - 100 * DAY },
    });

    const { text } = await score({ address: 'test', lookbackDays: 30 });
    expect(text).toMatch(/Activity:\s*100\/100/);
  });

  it('respects lookbackDays parameter', async () => {
    const fixture: ScoreFixture = {
      history: [makeTx(2), makeTx(5), makeTx(10), makeTx(20)],
      balances: [{ usdValue: 100 }],
      funded: { timestamp: NOW - 100 * DAY },
    };

    mockClient(fixture);
    const r7 = await score({ address: 'test', lookbackDays: 7 });
    expect(r7.text).toMatch(/Activity:\s*\d+\/100\s*\(2 txs in last 7d/);

    mockClient(fixture);
    const r30 = await score({ address: 'test', lookbackDays: 30 });
    expect(r30.text).toMatch(/Activity:\s*\d+\/100\s*\(4 txs in last 30d/);
  });

  it('produces a deterministic score for identical inputs', async () => {
    const fixture: ScoreFixture = {
      history: [makeTx(1), makeTx(5), makeTx(15)],
      balances: [{ usdValue: 50 }, { usdValue: 200 }],
      funded: { timestamp: NOW - 365 * DAY },
    };

    mockClient(fixture);
    const r1 = await score({ address: 'test', lookbackDays: 30 });
    mockClient(fixture);
    const r2 = await score({ address: 'test', lookbackDays: 30 });
    expect(r1.score).toBe(r2.score);
  });
});
