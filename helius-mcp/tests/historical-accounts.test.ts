import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { dispatchRoutedTool } from '../src/router/dispatch.js';
import { getActionCatalogEntry } from '../src/router/catalog.js';
import { getSurfaceActions } from '../src/router/surface.js';
import { createServer } from '../src/server.js';
import { positionBefore, HISTORY_START_SLOT } from '../src/tools/historical-accounts.js';
import { setApiKey, setNetwork } from '../src/utils/helius.js';

// RPC calls are answered from a queue; anything else (telemetry) gets an empty 200.
const rpcResponses: Response[] = [];
const fetchMock = vi.fn(async (url: unknown) =>
  String(url).includes('helius-rpc.com') ? rpcResponses.shift()! : new Response('{}'));
vi.stubGlobal('fetch', fetchMock);

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const OWNER = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';
const TOKEN_ACCOUNT = 'EKyGnXReqmmXyqBHmMjV2CKCLafJS47xyhXXZ5WuFMxD';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// The USDC mint at slot 445000000, from the docs PR's capture against the
// archival router, with the data sliced away.
const mintAt445M = {
  context: { slot: 468129574 },
  value: {
    lamports: 531589475273,
    data: ['', 'base64'],
    owner: TOKEN_PROGRAM,
    executable: false,
    rentEpoch: 18446744073709551615,
    space: 82,
    lastUpdatedAt: { slot: 444999837, transactionIndex: 700 },
  },
};

function tokenAccount(uiAmountString: string, lastUpdatedAt: { slot: number; transactionIndex: number | null }) {
  return {
    pubkey: TOKEN_ACCOUNT,
    account: {
      lamports: 2039280,
      owner: TOKEN_PROGRAM,
      data: {
        program: 'spl-token',
        parsed: {
          type: 'account',
          info: {
            isNative: false,
            mint: USDC,
            owner: OWNER,
            state: 'initialized',
            tokenAmount: { amount: '12500000', decimals: 6, uiAmount: 12.5, uiAmountString },
          },
        },
        space: 165,
      },
      executable: false,
      rentEpoch: 18446744073709551615,
      space: 165,
      lastUpdatedAt,
    },
  };
}

function respond(result: unknown) {
  rpcResponses.push(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result })));
}

function respondError(code: number, message: string) {
  rpcResponses.push(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code, message } })));
}

function rpcCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes('helius-rpc.com')) as unknown as Array<[string, RequestInit]>;
}

/** The latest RPC request. */
function request(): { url: string; body: Record<string, any> } {
  const [url, init] = rpcCalls().at(-1)!;
  return { url: String(url), body: JSON.parse(String(init.body)) };
}

async function call(params: Record<string, unknown>) {
  const result = await dispatchRoutedTool('heliusChain', { detail: 'full', ...params }, {});
  return { text: result.content.map((c) => c.text).join('\n'), isError: result.isError };
}

beforeEach(() => {
  fetchMock.mockClear();
  rpcResponses.length = 0;
  setApiKey('test-key');
  setNetwork('mainnet-beta');
});

afterAll(() => {
  setApiKey('');
  vi.unstubAllGlobals();
});

describe('getHistoricalAccountInfo', () => {
  it('sends [address, query, config] to the mainnet endpoint and reports the write behind the state', async () => {
    respond(mintAt445M);
    const { text, isError } = await call({ action: 'getHistoricalAccountInfo', address: USDC, slot: 445000000, transactionIndex: 10 });

    expect(isError).not.toBe(true);
    expect(request().url).toBe('https://mainnet.helius-rpc.com/?api-key=test-key');
    expect(request().body).toMatchObject({
      method: 'getHistoricalAccountInfo',
      params: [USDC, { slot: 445000000, transactionIndex: 10 }, { encoding: 'jsonParsed', commitment: 'finalized' }],
    });
    expect(text).toContain('right after transaction 10 in slot 445,000,000');
    expect(text).toContain('**Last written:** slot 444,999,837, transaction 700');
    expect(text).toContain('**Data Size:** 82 bytes');
    expect(text).toContain('not the slot queried');
    expect(text).toContain('`slot: 444999837, transactionIndex: 699`');
  });

  it('sends an empty query object for the latest slot, never nulls', async () => {
    respond(mintAt445M);
    await call({ action: 'getHistoricalAccountInfo', address: USDC });
    expect(request().body.params).toEqual([USDC, {}, { encoding: 'jsonParsed', commitment: 'finalized' }]);
  });

  it('switches to base64 when dataSlice is set without an encoding, and shows the bytes', async () => {
    respond({ ...mintAt445M, value: { ...mintAt445M.value, data: ['AQAAAA==', 'base64'] } });
    const { text } = await call({ action: 'getHistoricalAccountInfo', address: USDC, slot: 445000000, dataSlice: { offset: 0, length: 4 } });

    expect(request().body.params[2]).toEqual({ encoding: 'base64', commitment: 'finalized', dataSlice: { offset: 0, length: 4 } });
    expect(text).toContain('**Data (base64):**');
    expect(text).toContain('AQAAAA==');
    expect(text).not.toContain('not parseable');
  });

  it('says when jsonParsed fell back to base64', async () => {
    respond({ ...mintAt445M, value: { ...mintAt445M.value, data: ['AQAAAA==', 'base64'] } });
    const { text } = await call({ action: 'getHistoricalAccountInfo', address: USDC, slot: 445000000 });
    expect(text).toContain('not parseable at this position');
  });

  it('treats a null value as an account that did not exist, not an error', async () => {
    respond({ context: { slot: 468129574 }, value: null });
    const { text, isError } = await call({ action: 'getHistoricalAccountInfo', address: USDC, slot: 445000000 });
    expect(isError).not.toBe(true);
    expect(text).toContain('did not exist at this position');
    expect(text).toContain('getTransactionHistory');
  });

  it('explains state unchanged since coverage began, and offers no earlier state', async () => {
    respond({ ...mintAt445M, value: { ...mintAt445M.value, lastUpdatedAt: { slot: HISTORY_START_SLOT, transactionIndex: null } } });
    const { text } = await call({ action: 'getHistoricalAccountInfo', address: USDC, slot: 445000000 });
    expect(text).toContain('unchanged since history coverage began');
    expect(text).toContain('**Previous state:** none available');
  });
});

describe('walking back through history', () => {
  it('steps to the previous transaction, or to the previous slot from index 0 or a non-transaction write', () => {
    expect(positionBefore({ slot: 445000000, transactionIndex: 10 })).toEqual({ slot: 445000000, transactionIndex: 9 });
    expect(positionBefore({ slot: 445000000, transactionIndex: 0 })).toEqual({ slot: 444999999 });
    expect(positionBefore({ slot: 445000000, transactionIndex: null })).toEqual({ slot: 444999999 });
    expect(positionBefore({ slot: HISTORY_START_SLOT, transactionIndex: null })).toBeNull();
  });
});

describe('validation before the RPC', () => {
  it.each([
    ['transactionIndex without slot', { action: 'getHistoricalAccountInfo', address: USDC, transactionIndex: 3 }, '`transactionIndex` requires `slot`'],
    ['a slot before coverage', { action: 'getHistoricalAccountInfo', address: USDC, slot: 444000000 }, 'History isn\'t available before slot 444,959,999'],
    ['both mint and programId', { action: 'getHistoricalTokenAccountsByOwner', address: OWNER, mint: USDC, programId: TOKEN_PROGRAM }, 'not both'],
    ['a programId that is not a token program', { action: 'getHistoricalTokenAccountsByOwner', address: OWNER, programId: '11111111111111111111111111111111' }, 'must be a token program'],
  ])('rejects %s', async (_label, params, message) => {
    const { text, isError } = await call(params);
    expect(isError).toBe(true);
    expect(text).toContain(message);
    expect(rpcCalls()).toHaveLength(0);
  });

  it('refuses devnet, where the methods do not exist', async () => {
    setNetwork('devnet');
    const { text, isError } = await call({ action: 'getHistoricalAccountInfo', address: USDC, slot: 445000000 });
    expect(isError).toBe(true);
    expect(text).toContain('not available on devnet');
    expect(rpcCalls()).toHaveLength(0);
  });
});

describe('RPC errors', () => {
  it.each([
    [-32018, 'Account history not available', 'History isn\'t available before slot'],
    [-32004, 'Slot not yet available', '`commitment: "confirmed"`'],
    [-32602, 'Invalid params: paginationKey mint does not match mint', 'Invalid parameters: Invalid params: paginationKey mint does not match mint'],
  ])('maps %i to guidance', async (code, message, expected) => {
    respondError(code, message);
    const { text, isError } = await call({ action: 'getHistoricalAccountInfo', address: USDC, slot: 445000000 });
    expect(isError).toBe(true);
    expect(text).toContain(expected);
  });
});

describe('getHistoricalTokenAccountsByOwner', () => {
  it('takes the owner as `owner` or `address`, and renders balances with the write position', async () => {
    respond({ context: { slot: 468129574 }, value: { accounts: [tokenAccount('12.5', { slot: 444999837, transactionIndex: 700 })], paginationKey: null } });
    const { text, isError } = await call({ action: 'getHistoricalTokenAccountsByOwner', owner: OWNER, slot: 445000000, mint: USDC });

    expect(isError).not.toBe(true);
    expect(request().body).toMatchObject({
      method: 'getHistoricalTokenAccountsByOwner',
      params: [OWNER, { slot: 445000000 }, { encoding: 'jsonParsed', commitment: 'finalized', limit: 100, mint: USDC }],
    });
    expect(text).toContain(`**${TOKEN_ACCOUNT}**`);
    expect(text).toContain(`Mint: ${USDC}`);
    expect(text).toContain('Balance: 12.5 (12500000 raw, 6 decimals)');
    expect(text).toContain('Program: SPL Token');
    expect(text).toContain('Last written: slot 444,999,837, transaction 700');
    expect(text).not.toContain('Next page');
  });

  it('passes paginationToken through as the RPC\'s paginationKey', async () => {
    respond({ context: { slot: 1 }, value: { accounts: [], paginationKey: null } });
    await call({ action: 'getHistoricalTokenAccountsByOwner', address: OWNER, slot: 445000000, paginationToken: `${USDC}:${TOKEN_ACCOUNT}` });
    expect(request().body.params[2].paginationKey).toBe(`${USDC}:${TOKEN_ACCOUNT}`);
  });

  it('does not stop at an empty page that still has a cursor', async () => {
    respond({ context: { slot: 1 }, value: { accounts: [], paginationKey: `${USDC}:${TOKEN_ACCOUNT}` } });
    const { text } = await call({ action: 'getHistoricalTokenAccountsByOwner', address: OWNER, slot: 445000000 });
    expect(text).toContain('the scan stopped early');
    expect(text).toContain(`paginationToken: "${USDC}:${TOKEN_ACCOUNT}"`);
  });

  it('warns when pages are not pinned to a slot', async () => {
    respond({ context: { slot: 1 }, value: { accounts: [], paginationKey: `${USDC}:${TOKEN_ACCOUNT}` } });
    const { text } = await call({ action: 'getHistoricalTokenAccountsByOwner', address: OWNER });
    expect(text).toContain('no `slot` was pinned');
  });
});

describe('on the router', () => {
  it('sits on heliusChain behind the Business gate, on both surfaces', () => {
    for (const action of ['getHistoricalAccountInfo', 'getHistoricalTokenAccountsByOwner'] as const) {
      const entry = getActionCatalogEntry(action);
      expect(entry.publicTool).toBe('heliusChain');
      expect(entry.mutability).toBe('read');
      expect(entry.capabilityGate.baseline.minimumPlan).toBe('business');
      expect(getSurfaceActions('heliusChain', 'readOnly')).toContain(action);
    }
  });

  it('continues a token-account read through expandResult with the same slot and the next cursor', async () => {
    const server = createServer({ surface: 'readOnly' });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'historical-test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const telemetry = { _feedback: 'test', _feedbackTool: 'heliusChain.getHistoricalTokenAccountsByOwner', _model: 'test' };

    const cursor = `${USDC}:${TOKEN_ACCOUNT}`;
    respond({ context: { slot: 1 }, value: { accounts: [tokenAccount('12.5', { slot: 444999837, transactionIndex: 700 })], paginationKey: cursor } });
    const first = await client.callTool({
      name: 'heliusChain',
      arguments: { action: 'getHistoricalTokenAccountsByOwner', detail: 'summary', address: OWNER, slot: 445000000, limit: 1, ...telemetry },
    });
    const text = (first.content as Array<{ text: string }>).map((c) => c.text).join('\n');
    const resultId = text.match(/resultId:\s+(\S+)/)?.[1];
    expect(resultId, text).toBeTruthy();
    expect(text).toContain('continuation');

    respond({ context: { slot: 1 }, value: { accounts: [], paginationKey: null } });
    await client.callTool({ name: 'expandResult', arguments: { resultId, continuation: 'next', ...telemetry, _feedbackTool: 'expandResult' } });
    expect(request().body.params).toEqual([
      OWNER,
      { slot: 445000000 },
      { encoding: 'jsonParsed', commitment: 'finalized', limit: 1, paginationKey: cursor },
    ]);
  });
});
