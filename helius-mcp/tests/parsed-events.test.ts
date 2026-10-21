import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedTransactionResult } from 'helius-sdk/parsedEvents/types';
import { callActionHandler } from '../src/router/action-handlers.js';
import { getNetwork } from '../src/utils/helius.js';

// Real Parsed Events responses recorded from mainnet: a Jupiter swap, a swap
// that failed with a decoded program error, a failed transfer with only a raw
// error, and a signature that does not exist.
const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/parsed-events/results.json', import.meta.url), 'utf8'),
) as Record<'swap' | 'failedDecoded' | 'failedRaw' | 'notFound', ParsedTransactionResult>;

const bySignature = new Map(Object.values(fixtures).map((r) => [r.signature, r]));

const parseTransactions = vi.fn(async ({ transactions }: { transactions: string[] }) =>
  transactions.map((sig) => bySignature.get(sig) ?? {
    signature: sig,
    parserStatus: 'ERROR' as const,
    parserError: { code: 'transaction_not_found', message: 'transaction was not found' },
  }),
);
const enhancedGetTransactions = vi.fn(async () => []);
const getTransactionsForAddress = vi.fn();
const getAssetBatch = vi.fn(async () => []);
const getAsset = vi.fn(async () => null);

vi.mock('../src/utils/helius.js', () => ({
  hasApiKey: vi.fn(() => true),
  getApiKey: vi.fn(() => 'test-key'),
  getHeliusClient: vi.fn(() => ({
    parsedEvents: { parseTransactions },
    enhanced: { getTransactions: enhancedGetTransactions },
    getTransactionsForAddress,
    getAssetBatch,
    getAsset,
  })),
  getEnhancedWebSocketUrl: vi.fn(() => 'wss://atlas-mainnet.helius-rpc.com/?api-key=test'),
  getLaserstreamUrl: vi.fn(() => 'https://laserstream-mainnet-ewr.helius-rpc.com'),
  getNetwork: vi.fn(() => 'mainnet-beta'),
  setApiKey: vi.fn(),
  setNetwork: vi.fn(),
  restRequest: vi.fn(),
  setSessionSecretKey: vi.fn(),
  getSessionSecretKey: vi.fn(() => null),
  setSessionWalletAddress: vi.fn(),
  getSessionWalletAddress: vi.fn(() => null),
  loadSignerOrFail: vi.fn(),
}));

const SWAP = fixtures.swap.signature;
const FAILED_DECODED = fixtures.failedDecoded.signature;
const FAILED_RAW = fixtures.failedRaw.signature;
const NOT_FOUND = fixtures.notFound.signature;

async function run(action: string, params: Record<string, unknown>): Promise<string> {
  const result = await callActionHandler(action as never, params, {});
  expect(result.isError, result.content?.[0]?.text).not.toBe(true);
  return result.content?.[0]?.text ?? '';
}

beforeEach(() => {
  vi.mocked(getNetwork).mockReturnValue('mainnet-beta');
  for (const mock of [parseTransactions, enhancedGetTransactions, getTransactionsForAddress, getAssetBatch, getAsset]) {
    mock.mockClear();
  }
});

describe('parseTransactions on mainnet', () => {
  it('uses Parsed Events, not Enhanced Transactions', async () => {
    await run('parseTransactions', { signatures: [SWAP] });

    expect(parseTransactions).toHaveBeenCalledWith({ transactions: [SWAP] });
    expect(enhancedGetTransactions).not.toHaveBeenCalled();
  });

  it('renders the summary, protocol, and decoded instruction names', async () => {
    const text = await run('parseTransactions', { signatures: [SWAP] });

    expect(text).toContain(`**Transaction: ${SWAP}**`);
    expect(text).toContain('**Type:** swap');
    expect(text).toContain('**Protocol:** jupiter');
    expect(text).toContain('**Status:** ✅ Success');
    expect(text).toContain('**Description:** BKvk2wiTCsyMsh6MxfbCUMC8jW9DK9jK84nHYURSGd1X swapped');
    expect(text).toContain('- [0] compute_budget.set_compute_unit_limit');
    expect(text).toContain('- [3] jupiter.route');
  });

  it('formats token transfers as UI amounts', async () => {
    const text = await run('parseTransactions', { signatures: [SWAP] });

    // 13286113421628 raw at 6 decimals
    expect(text).toContain('13,286,113.421628');
  });

  it('shows a decoded program error for a failed transaction', async () => {
    const text = await run('parseTransactions', { signatures: [FAILED_DECODED] });

    expect(text).toContain('**Status:** ❌ Failed');
    expect(text).toContain('**Error:** jupiter error 6001 SlippageToleranceExceeded: Slippage tolerance exceeded (instruction 0)');
  });

  it('falls back to the raw error and marks undecoded instructions', async () => {
    const text = await run('parseTransactions', { signatures: [FAILED_RAW] });

    expect(text).toContain('**Error:** Instruction 0 failed: {"Custom":7}');
    expect(text).toContain('(not decoded)');
  });

  it('lists signatures the parser could not find as warnings', async () => {
    const text = await run('parseTransactions', { signatures: [SWAP, NOT_FOUND] });

    expect(text).toContain(`**Transaction: ${SWAP}**`);
    expect(text).toContain('*Not found on Solana mainnet');
    expect(text).toContain(`- \`${NOT_FOUND}\``);
  });

  it('reports when nothing was found', async () => {
    const text = await run('parseTransactions', { signatures: [NOT_FOUND] });

    expect(text).toContain('**No Transactions Found on Mainnet**');
    expect(text).toContain(NOT_FOUND);
  });

  it('includes decoded args and named accounts with showRaw', async () => {
    const text = await run('parseTransactions', { signatures: [SWAP], showRaw: true });

    expect(text).toContain('**Raw Instructions:**');
    expect(text).toContain('Args: {"units":"1400000"}');
    expect(text).toMatch(/Accounts \(\d+\):\n\s+0: \w+: \w+/);
  });

  it('batches more than 100 signatures', async () => {
    const signatures = Array.from({ length: 150 }, (_, i) => `${'5'.repeat(84)}${String(i).padStart(3, '0')}`.replace(/0/g, '1'));
    await run('parseTransactions', { signatures });

    expect(parseTransactions).toHaveBeenCalledTimes(2);
    expect(parseTransactions.mock.calls[0][0].transactions).toHaveLength(100);
    expect(parseTransactions.mock.calls[1][0].transactions).toHaveLength(50);
  });
});

describe('parseTransactions on devnet', () => {
  it('falls back to Enhanced Transactions, because Parsed Events is mainnet-only', async () => {
    vi.mocked(getNetwork).mockReturnValue('devnet');
    const text = await run('parseTransactions', { signatures: [SWAP] });

    expect(enhancedGetTransactions).toHaveBeenCalledWith({ transactions: [SWAP] });
    expect(parseTransactions).not.toHaveBeenCalled();
    expect(text).toContain('**No Transactions Found on Devnet**');
  });
});

describe('getTransactionHistory parsed mode', () => {
  beforeEach(() => {
    getTransactionsForAddress.mockResolvedValue({
      data: [{ signature: FAILED_DECODED }, { signature: SWAP }],
      paginationToken: 'next-page',
    });
  });

  it('keeps the signature lookup and its filters, then parses with Parsed Events', async () => {
    const text = await run('getTransactionHistory', { address: 'BenchWallet11111111111111111111111111111111', status: 'any' });

    expect(getTransactionsForAddress).toHaveBeenCalledWith([
      'BenchWallet11111111111111111111111111111111',
      expect.objectContaining({ transactionDetails: 'signatures', sortOrder: 'desc', filters: { status: 'any' } }),
    ]);
    expect(parseTransactions).toHaveBeenCalledWith({ transactions: [FAILED_DECODED, SWAP] });
    expect(enhancedGetTransactions).not.toHaveBeenCalled();

    expect(text.indexOf(FAILED_DECODED)).toBeLessThan(text.indexOf(SWAP));
    expect(text).toContain('❌ **swap** (jupiter)');
    expect(text).toContain('Error: jupiter error 6001 SlippageToleranceExceeded');
    expect(text).toContain('**Next Page Token:** `next-page`');
  });

  it('flags listed signatures the parser could not find', async () => {
    getTransactionsForAddress.mockResolvedValue({ data: [{ signature: SWAP }, { signature: NOT_FOUND }] });
    const text = await run('getTransactionHistory', { address: 'BenchWallet11111111111111111111111111111111' });

    expect(text).toContain(`⚠️ \`${NOT_FOUND}\` was listed but not found by the parser`);
  });

  it('falls back to Enhanced Transactions on devnet', async () => {
    vi.mocked(getNetwork).mockReturnValue('devnet');
    await run('getTransactionHistory', { address: 'BenchWallet11111111111111111111111111111111' });

    expect(enhancedGetTransactions).toHaveBeenCalled();
    expect(parseTransactions).not.toHaveBeenCalled();
  });
});
