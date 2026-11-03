import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ParsedTransactionResult, ScanSummary } from 'helius-sdk/parsedEvents/types';

const scan = vi.hoisted(() => vi.fn());
const getAssetBatch = vi.hoisted(() => vi.fn(async () => []));

vi.mock('../src/utils/helius.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/utils/helius.js')>();
  return {
    ...original,
    hasApiKey: vi.fn(() => true),
    getNetwork: vi.fn(() => 'mainnet-beta'),
    getHeliusClient: vi.fn(() => ({ parsedEvents: { scan }, getAssetBatch, getAsset: vi.fn(async () => null) })),
  };
});

import { callActionHandler } from '../src/router/action-handlers.js';
import { getSurfaceActions } from '../src/router/surface.js';
import { createServer } from '../src/server.js';
import { getNetwork } from '../src/utils/helius.js';

// A real Parsed Events result recorded from mainnet (a Jupiter swap).
const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/parsed-events/results.json', import.meta.url), 'utf8'),
) as Record<'swap' | 'notFound', ParsedTransactionResult>;

const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WALLET = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';

function summary(overrides: Partial<ScanSummary> = {}): ScanSummary {
  return {
    stoppedOn: 'windowEnd',
    scannedTransactions: 2_400,
    matchedTransactions: 1,
    scannedThrough: { slot: 380_000_000, blockTime: 1_761_000_000 },
    creditsCharged: 13,
    ...overrides,
  };
}

async function run(params: Record<string, unknown>) {
  const result = await callActionHandler('scanTransactionHistory', params, {});
  return { text: result.content?.[0]?.text ?? '', isError: result.isError };
}

beforeEach(() => {
  scan.mockReset();
  vi.mocked(getNetwork).mockReturnValue('mainnet-beta');
});

describe('scanTransactionHistory', () => {
  it('sends the match, window, and options, and renders parsed matches', async () => {
    scan.mockResolvedValueOnce({ data: [fixtures.swap], scan: summary() });
    const { text, isError } = await run({
      address: WALLET,
      programs: [{ programId: PUMP, instructions: ['buy', 'sell'] }],
      mints: [{ mint: USDC, scope: 'transaction' }],
      maxScannedTransactions: 5_000,
      status: 'any',
      tokenAccounts: 'balanceChanged',
      blockTimeGte: 1_735_689_600,
      slotLte: 390_000_000,
    });

    expect(isError).not.toBe(true);
    expect(scan).toHaveBeenCalledWith({
      address: WALLET,
      match: { programs: [{ programId: PUMP, instructions: ['buy', 'sell'] }], mints: [{ mint: USDC, scope: 'transaction' }] },
      returnShape: 'transactions',
      sortOrder: 'desc',
      limit: 10,
      budget: { maxScannedTransactions: 5_000 },
      status: 'any',
      tokenAccounts: 'balanceChanged',
      time: { gte: 1_735_689_600 },
      slot: { lte: 390_000_000 },
    });
    expect(text).toContain(`- Program \`${PUMP}\`: buy, sell`);
    expect(text).toContain(`- Mint \`${USDC}\` (anywhere in the transaction)`);
    expect(text).toContain('Scanned 2,400 transactions through slot 380,000,000');
    expect(text).toContain('Stopped on `windowEnd`');
    expect(text).toContain('Credits charged: 13');
    expect(text).toContain(`Sig: \`${fixtures.swap.signature}\``);
    expect(text).toContain('**swap** (jupiter)');
    expect(text).not.toContain('Next Page Token');
  });

  it('lists signatures without a limit, and offers the next page', async () => {
    scan.mockResolvedValueOnce({
      data: [{ signature: 'sigA', slot: 1_234, transactionIndex: 0, blockTime: null }],
      paginationToken: 'TKN1',
      scan: summary({ stoppedOn: 'budget' }),
    });
    const { text } = await run({ address: PUMP, programs: [{ programId: PUMP }], returnShape: 'signatures' });

    expect(scan.mock.calls[0][0]).not.toHaveProperty('limit');
    expect(text).toContain('- `sigA` | Slot: 1,234 | N/A');
    expect(text).toContain('Stopped on `budget`');
    expect(text).toContain('**Next Page Token:** `TKN1`');
  });

  it('reports a count, and says it covers only the scanned range while history remains', async () => {
    scan.mockResolvedValueOnce({ paginationToken: 'TKN2', scan: summary({ stoppedOn: 'deadline', matchedTransactions: 42 }) });
    const { text } = await run({ address: USDC, mints: [{ mint: USDC }], returnShape: 'count' });

    expect(text).toContain('**Matches:** 42');
    expect(text).toContain('add up the counts');
  });

  it('keeps going when a page has no matches but the history continues', async () => {
    scan.mockResolvedValueOnce({ data: [], paginationToken: 'TKN3', scan: summary({ stoppedOn: 'budget', matchedTransactions: 0 }) });
    const { text, isError } = await run({ address: PUMP, programs: [{ programId: PUMP, instructions: ['withdraw'] }] });

    expect(isError).not.toBe(true);
    expect(text).toContain('No matches in the range this request scanned. The history continues');
    expect(text).toContain('**Next Page Token:** `TKN3`');
  });

  it('requires programs or mints, and treats empty arrays as unset', async () => {
    const { text, isError } = await run({ address: WALLET, programs: [], mints: [] });

    expect(isError).toBe(true);
    expect(text).toContain('Set `programs`, `mints`, or both');
    expect(scan).not.toHaveBeenCalled();
  });

  it('refuses on devnet, since Parsed Events serves mainnet only', async () => {
    vi.mocked(getNetwork).mockReturnValue('devnet');
    const { text, isError } = await run({ address: WALLET, mints: [{ mint: USDC }] });

    expect(isError).toBe(true);
    expect(text).toContain('mainnet only');
    expect(scan).not.toHaveBeenCalled();
  });

  it('shows the API reason for a rejected match, such as an unknown instruction name', async () => {
    scan.mockRejectedValueOnce(new Error('Helius HTTP 400: {"error":"unknown instruction \\"buyy\\" for program 6EF8"}'));
    const { text, isError } = await run({ address: PUMP, programs: [{ programId: PUMP, instructions: ['buyy'] }] });

    expect(isError).toBe(true);
    expect(text).toContain('Scan Transaction History Error');
    expect(text).toContain('buyy');
  });

  it('rejects more than 20 programs before calling the API', async () => {
    const programs = Array.from({ length: 21 }, () => ({ programId: PUMP }));
    await expect(run({ address: PUMP, programs })).rejects.toThrow(/programs/);
    expect(scan).not.toHaveBeenCalled();
  });

  it('is a read, on the read-only surface', () => {
    expect(getSurfaceActions('heliusTransaction', 'readOnly')).toContain('scanTransactionHistory');
  });
});

describe('scanTransactionHistory through the MCP client', () => {
  async function connect() {
    const server = createServer({ surface: 'readOnly' });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'scan-test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return client;
  }

  const textOf = (result: Awaited<ReturnType<Client['callTool']>>) =>
    (result.content as Array<{ text: string }>).map((c) => c.text).join('\n');

  it('keeps the match and filter fields through the public schema, and continues with expandResult', async () => {
    const client = await connect();
    scan
      .mockResolvedValueOnce({ data: [], paginationToken: 'TKN4', scan: summary({ stoppedOn: 'budget', matchedTransactions: 0 }) })
      .mockResolvedValueOnce({ data: [], scan: summary() });

    const args = {
      action: 'scanTransactionHistory',
      detail: 'summary',
      address: WALLET,
      programs: [{ programId: PUMP, instructions: ['buy'] }],
      mints: [{ mint: USDC }],
      returnShape: 'signatures',
      maxScannedTransactions: 1_000,
      blockTimeGte: 1_735_689_600,
      _feedback: 'test',
      _feedbackTool: 'heliusTransaction.scanTransactionHistory',
      _model: 'test',
    };
    const first = await client.callTool({ name: 'heliusTransaction', arguments: args });
    expect(first.isError, textOf(first)).not.toBe(true);
    expect(scan.mock.calls[0][0]).toMatchObject({
      match: { programs: [{ programId: PUMP, instructions: ['buy'] }], mints: [{ mint: USDC }] },
      returnShape: 'signatures',
      budget: { maxScannedTransactions: 1_000 },
      time: { gte: 1_735_689_600 },
    });

    const resultId = textOf(first).match(/resultId:\s+(\S+)/)?.[1];
    expect(resultId, 'response should carry a resultId').toBeTruthy();
    await client.callTool({
      name: 'expandResult',
      arguments: { resultId, continuation: 'next', _feedback: 'test', _feedbackTool: 'expandResult', _model: 'test' },
    });
    expect(scan.mock.calls[1][0]).toMatchObject({
      address: WALLET,
      match: { programs: [{ programId: PUMP, instructions: ['buy'] }], mints: [{ mint: USDC }] },
      paginationToken: 'TKN4',
    });
  });
});
