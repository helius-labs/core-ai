import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callLegacyAction } from '../src/router/legacy-executors.js';

const getTransactionsForAddress = vi.fn(async () => ({
  data: [],
}));

vi.mock('../src/utils/helius.js', () => ({
  hasApiKey: vi.fn(() => true),
  getApiKey: vi.fn(() => 'test-key'),
  getHeliusClient: vi.fn(() => ({
    getTransactionsForAddress,
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

describe('legacy executor bridge', () => {
  beforeEach(() => {
    getTransactionsForAddress.mockClear();
  });

  it('applies legacy zod defaults before invoking getTransactionHistory', async () => {
    const result = await callLegacyAction(
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

  it('returns a clear validation error when a required legacy field is missing', async () => {
    await expect(
      callLegacyAction(
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
});
