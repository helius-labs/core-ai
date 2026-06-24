import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callActionHandler } from '../src/router/action-handlers.js';
import { restRequest } from '../src/utils/helius.js';

const getTransactionsForAddress = vi.fn(async () => ({
  data: [],
}));
const getTransfersByAddress = vi.fn(async () => ({
  data: [],
  paginationToken: null,
}));
const getAssetBatch = vi.fn(async () => []);
const getAsset = vi.fn(async () => null);

vi.mock('../src/utils/helius.js', () => ({
  hasApiKey: vi.fn(() => true),
  getApiKey: vi.fn(() => 'test-key'),
  getHeliusClient: vi.fn(() => ({
    getTransactionsForAddress,
    getTransfersByAddress,
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

describe('action handler bridge', () => {
  beforeEach(() => {
    getTransactionsForAddress.mockClear();
    getTransfersByAddress.mockClear();
    getAssetBatch.mockClear();
    getAsset.mockClear();
    vi.mocked(restRequest).mockClear();
  });

  it('applies action-schema defaults before invoking getTransactionHistory', async () => {
    const result = await callActionHandler(
      'getTransactionHistory',
      {
        address: 'BenchWallet11111111111111111111111111111111',
        mode: 'signatures',
        limit: 10,
      },
      {},
    );

    expect(result.isError).not.toBe(true);
    expect(getTransactionsForAddress).toHaveBeenCalledWith([
      'BenchWallet11111111111111111111111111111111',
      {
        transactionDetails: 'signatures',
        sortOrder: 'desc',
        limit: 10,
        maxSupportedTransactionVersion: 0,
        filters: {
          status: 'succeeded',
        },
      },
    ]);
    expect(result.content?.[0]?.text).toContain('No signatures found.');
  });

  it('returns a clear validation error when a required action field is missing', async () => {
    await expect(
      callActionHandler(
        'getTransactionHistory',
        {
          mode: 'signatures',
          limit: 10,
        },
        {},
      ),
    ).rejects.toThrow('Invalid parameters for getTransactionHistory: address Required');
    expect(getTransactionsForAddress).not.toHaveBeenCalled();
  });

  it('applies action-schema defaults before invoking getTransfersByAddress', async () => {
    const result = await callActionHandler(
      'getTransfersByAddress',
      {
        address: 'BenchWallet11111111111111111111111111111111',
        limit: 5,
      },
      {},
    );

    expect(result.isError).not.toBe(true);
    expect(getTransfersByAddress).toHaveBeenCalledWith(
      'BenchWallet11111111111111111111111111111111',
      {
        direction: 'any',
        limit: 5,
        sortOrder: 'desc',
      },
    );
    expect(result.content?.[0]?.text).toContain('No transfers found.');
  });

  it('forwards filters and pagination to getTransfersByAddress', async () => {
    getTransfersByAddress.mockResolvedValueOnce({
      data: [
        {
          signature: '5J8' + 'a'.repeat(85),
          slot: 123456,
          blockTime: 1700000000,
          type: 'transfer',
          fromUserAccount: 'AAA11111111111111111111111111111111111111111',
          toUserAccount: 'BBB22222222222222222222222222222222222222222',
          fromTokenAccount: 'TA1',
          toTokenAccount: 'TA2',
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: '1000000',
          decimals: 6,
          uiAmount: '1.000000',
          confirmationStatus: 'finalized',
          transactionIdx: 0,
          instructionIdx: 0,
          innerInstructionIdx: 0,
        },
      ],
      paginationToken: 'NEXT_TOKEN',
    } as any);

    const result = await callActionHandler(
      'getTransfersByAddress',
      {
        address: 'BenchWallet11111111111111111111111111111111',
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        direction: 'in',
        limit: 10,
        blockTimeGte: 1700000000,
        paginationToken: 'PREV',
      },
      {},
    );

    expect(result.isError).not.toBe(true);
    expect(getTransfersByAddress).toHaveBeenCalledWith(
      'BenchWallet11111111111111111111111111111111',
      {
        direction: 'in',
        limit: 10,
        sortOrder: 'desc',
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        paginationToken: 'PREV',
        filters: { blockTime: { gte: 1700000000 } },
      },
    );
    expect(result.content?.[0]?.text).toContain('**Next Page Token:** `NEXT_TOKEN`');
  });

  it('rejects amount bounds that exceed JS safe-integer range', async () => {
    const result = await callActionHandler(
      'getTransfersByAddress',
      {
        address: 'BenchWallet11111111111111111111111111111111',
        amountGte: '9999999999999999999', // > 2^53
      },
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('amountGte');
    expect(result.content?.[0]?.text).toContain('safe integer range');
    expect(getTransfersByAddress).not.toHaveBeenCalled();
  });

  it('returns a clear validation error when getTransfersByAddress is missing address', async () => {
    await expect(
      callActionHandler(
        'getTransfersByAddress',
        { limit: 5 },
        {},
      ),
    ).rejects.toThrow('Invalid parameters for getTransfersByAddress: address Required');
    expect(getTransfersByAddress).not.toHaveBeenCalled();
  });

  it('builds the balance-at REST query and renders the historical balance', async () => {
    vi.mocked(restRequest).mockResolvedValueOnce({
      wallet: 'BenchWallet11111111111111111111111111111111',
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      isNative: false,
      balance: '284961463.392936',
      balanceRaw: '284961463392936',
      decimals: 6,
      requested: { time: null, slot: 313000000, datetime: null },
      asOf: { slot: 313000000, blockTime: 1736536794, signature: '5Cyy7Mh9nVgFq3T8wJp2sKxR4dE6bA1uZoNcLrXmYqUpon' },
    });

    const result = await callActionHandler(
      'getWalletBalanceAt',
      {
        address: 'BenchWallet11111111111111111111111111111111',
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        slot: 313000000,
      },
      {},
    );

    expect(result.isError).not.toBe(true);
    expect(restRequest).toHaveBeenCalledWith(
      '/v1/wallet/BenchWallet11111111111111111111111111111111/balance-at?mint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&slot=313000000',
    );
    expect(result.content?.[0]?.text).toContain('Historical Token Balance');
    expect(result.content?.[0]?.text).toContain('284961463.392936');
    expect(result.content?.[0]?.text).toContain('slot 313000000');
  });

  it('echoes the resolved epoch and encodes datetime for a datetime query', async () => {
    vi.mocked(restRequest).mockResolvedValueOnce({
      wallet: 'BenchWallet11111111111111111111111111111111',
      mint: 'So11111111111111111111111111111111111111111',
      isNative: true,
      balance: '1.5',
      balanceRaw: '1500000000',
      decimals: 9,
      requested: { time: 1736536800, slot: null, datetime: '2025-01-10 19:20:00' },
      asOf: { slot: 313000000, blockTime: 1736536794, signature: '5Cyy7Mh' },
    });

    const result = await callActionHandler(
      'getWalletBalanceAt',
      {
        address: 'BenchWallet11111111111111111111111111111111',
        mint: 'So11111111111111111111111111111111111111111',
        datetime: '2025-01-10 19:20:00',
      },
      {},
    );

    expect(result.isError).not.toBe(true);
    expect(restRequest).toHaveBeenCalledWith(
      '/v1/wallet/BenchWallet11111111111111111111111111111111/balance-at?mint=So11111111111111111111111111111111111111111&datetime=2025-01-10+19%3A20%3A00',
    );
    expect(result.content?.[0]?.text).toContain('Resolved:');
  });

  it('reports a genuine zero balance when balance-at returns asOf: null', async () => {
    vi.mocked(restRequest).mockResolvedValueOnce({
      wallet: 'BenchWallet11111111111111111111111111111111',
      mint: 'So11111111111111111111111111111111111111111',
      isNative: true,
      balance: '0',
      balanceRaw: '0',
      decimals: 9,
      requested: { time: 1736536800, slot: null, datetime: null },
      asOf: null,
    });

    const result = await callActionHandler(
      'getWalletBalanceAt',
      {
        address: 'BenchWallet11111111111111111111111111111111',
        mint: 'So11111111111111111111111111111111111111111',
        time: 1736536800,
      },
      {},
    );

    expect(result.isError).not.toBe(true);
    expect(result.content?.[0]?.text).toContain('genuinely 0');
    expect(result.content?.[0]?.text).toContain('SOL');
  });

  it('rejects balance-at when not exactly one of time/datetime/slot is given', async () => {
    const none = await callActionHandler(
      'getWalletBalanceAt',
      { address: 'BenchWallet11111111111111111111111111111111', mint: 'So11111111111111111111111111111111111111111' },
      {},
    );
    expect(none.isError).toBe(true);
    expect(none.content?.[0]?.text).toContain('exactly one');

    const both = await callActionHandler(
      'getWalletBalanceAt',
      { address: 'BenchWallet11111111111111111111111111111111', mint: 'So11111111111111111111111111111111111111111', time: 1, slot: 2 },
      {},
    );
    expect(both.isError).toBe(true);
    expect(both.content?.[0]?.text).toContain('exactly one');
  });
});
