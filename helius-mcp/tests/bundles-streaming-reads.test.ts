import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const describeProgram = vi.fn();
const close = vi.fn();
vi.mock('helius-sdk/websockets/parsedStreams', () => ({
  makeParsedStreamsClient: vi.fn(() => ({ describeProgram, close })),
}));

import { makeParsedStreamsClient } from 'helius-sdk/websockets/parsedStreams';
import { dispatchRoutedTool } from '../src/router/dispatch.js';
import { getSurfaceActions } from '../src/router/surface.js';
import { setApiKey, setNetwork } from '../src/utils/helius.js';
import type { RoutedPublicToolName } from '../src/router/action-groups.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

/** Queue one JSON-RPC response. */
function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

function lastRequest(): { url: string; body: Record<string, any> } {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: String(url), body: JSON.parse(String(init.body)) };
}

async function call(tool: RoutedPublicToolName, params: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
  const result = await dispatchRoutedTool(tool, { detail: 'full', ...params }, {});
  return { text: result.content.map((c) => c.text).join('\n'), isError: result.isError };
}

const TX_A = 'AQAAAA==';
const TX_B = 'AgAAAA==';

beforeEach(() => {
  fetchMock.mockReset();
  describeProgram.mockReset();
  close.mockReset();
  setApiKey('test-key');
  setNetwork('mainnet-beta');
});

afterAll(() => {
  setApiKey('');
  vi.unstubAllGlobals();
});

describe('simulateBundle', () => {
  it('sends one account config per transaction, with simulateTransaction\'s defaults', async () => {
    respond({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: { summary: 'succeeded', transactionResults: [] } } });
    await call('heliusChain', { action: 'simulateBundle', transactions: [TX_A, TX_B] });

    const { url, body } = lastRequest();
    expect(url).toBe('https://mainnet.helius-rpc.com/?api-key=test-key');
    expect(body.method).toBe('simulateBundle');
    expect(body.params).toEqual([
      { encodedTransactions: [TX_A, TX_B] },
      {
        preExecutionAccountsConfigs: [null, null],
        postExecutionAccountsConfigs: [null, null],
        transactionEncoding: 'base64',
        skipSigVerify: true,
        replaceRecentBlockhash: true,
      },
    ]);
  });

  it('turns off blockhash replacement when verifying signatures, and captures requested accounts', async () => {
    respond({ jsonrpc: '2.0', id: 1, result: { value: { summary: 'succeeded', transactionResults: [] } } });
    await call('heliusChain', { action: 'simulateBundle', transactions: [TX_A], sigVerify: true, addresses: ['Acct1111111111111111111111111111111111111111'] });

    const config = lastRequest().body.params[1];
    expect(config.skipSigVerify).toBe(false);
    expect(config.replaceRecentBlockhash).toBe(false);
    expect(config.postExecutionAccountsConfigs).toEqual([{ addresses: ['Acct1111111111111111111111111111111111111111'], encoding: 'base64' }]);
  });

  it('reports which transaction failed and why', async () => {
    respond({
      jsonrpc: '2.0', id: 1,
      result: {
        context: { slot: 373999891 },
        value: {
          summary: { failed: { error: { TransactionFailure: [[0, 1], 'insufficient funds'] }, tx_signature: 'SigB' } },
          transactionResults: [
            { err: null, logs: ['Program log: ok'], unitsConsumed: 1200, returnData: null },
          ],
        },
      },
    });
    const { text } = await call('heliusChain', { action: 'simulateBundle', transactions: [TX_A, TX_B] });

    expect(text).toContain('❌ Would fail');
    expect(text).toContain('**Error:** insufficient funds');
    expect(text).not.toContain('[[0,1]');
    expect(text).toContain('`SigB`');
    expect(text).toContain('### Transaction 1: ✅ ok');
    expect(text).toContain('1,200');
    expect(text).toContain('Results stop at transaction 1');
  });

  it('rejects more than 5 transactions without calling the RPC', async () => {
    const { text, isError } = await call('heliusChain', { action: 'simulateBundle', transactions: Array(6).fill(TX_A) });
    expect(isError).toBe(true);
    expect(text).toContain('At most 5 transactions');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a JSON-RPC error', async () => {
    respond({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'invalid bundle' } });
    const { text, isError } = await call('heliusChain', { action: 'simulateBundle', transactions: [TX_A] });
    expect(isError).toBe(true);
    expect(text).toContain('RPC error -32602: invalid bundle');
  });

  it('uses the devnet RPC on devnet', async () => {
    setNetwork('devnet');
    respond({ jsonrpc: '2.0', id: 1, result: { value: { summary: 'succeeded', transactionResults: [] } } });
    await call('heliusChain', { action: 'simulateBundle', transactions: [TX_A] });
    expect(lastRequest().url).toBe('https://devnet.helius-rpc.com/?api-key=test-key');
  });
});

describe('getBundleStatuses', () => {
  it('reports landed and missing bundles', async () => {
    respond({
      jsonrpc: '2.0', id: 1,
      result: {
        context: { slot: 242806119 },
        value: [
          { bundle_id: 'landed', transactions: ['sig1', 'sig2'], slot: 242804011, confirmation_status: 'finalized', err: { Ok: null } },
          null,
        ],
      },
    });
    const { text } = await call('heliusChain', { action: 'getBundleStatuses', bundleIds: ['landed', 'missing'] });

    expect(lastRequest().body.params).toEqual([['landed', 'missing']]);
    expect(text).toContain('`landed`: **finalized** at slot 242,804,011');
    expect(text).not.toContain('❌');
    expect(text).toContain('`sig2`');
    expect(text).toContain('`missing`: not found');
  });

  it('rejects more than 5 bundle IDs without calling the RPC', async () => {
    const { isError } = await call('heliusChain', { action: 'getBundleStatuses', bundleIds: ['1', '2', '3', '4', '5', '6'] });
    expect(isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires bundleIds', async () => {
    const { text, isError } = await call('heliusChain', { action: 'getBundleStatuses' });
    expect(isError).toBe(true);
    expect(text).toContain('bundleIds');
  });
});

describe('getPreConfCoverage', () => {
  it('asks Gatekeeper with no params and lists regions largest first', async () => {
    respond({ jsonrpc: '2.0', id: 1, result: { networkSharePercent: 45.84, coverageByRegion: { ams: 0.21, fra: 0.27, dub: 0.02 } } });
    const { text } = await call('heliusStreaming', { action: 'getPreConfCoverage' });

    const { url, body } = lastRequest();
    expect(url).toBe('https://beta.helius-rpc.com/?api-key=test-key');
    expect(body).not.toHaveProperty('params');
    expect(text).toContain('**Network stake covered:** 45.84%');
    expect(text.indexOf('`fra`: 27%')).toBeLessThan(text.indexOf('`ams`: 21%'));
    expect(text.indexOf('`ams`: 21%')).toBeLessThan(text.indexOf('`dub`: 2%'));
  });

  it('maps a 401 to API key guidance', async () => {
    fetchMock.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
    const { text, isError } = await call('heliusStreaming', { action: 'getPreConfCoverage' });
    expect(isError).toBe(true);
    expect(text).toContain('API key is invalid or expired');
  });
});

describe('describeProgram', () => {
  const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

  it('lists instruction and role names with the filter field each goes in, then closes', async () => {
    describeProgram.mockResolvedValueOnce({
      id: JUPITER, name: 'jupiter',
      instructions: ['route', 'shared_accounts_route'], events: ['SwapEvent'], roles: ['user_transfer_authority'],
    });
    const { text } = await call('heliusStreaming', { action: 'describeProgram', program: JUPITER });

    expect(makeParsedStreamsClient).toHaveBeenLastCalledWith('test-key');
    expect(describeProgram).toHaveBeenCalledWith(JUPITER);
    expect(text).toContain('**jupiter**');
    expect(text).toContain('use in `instructionNames`');
    expect(text).toContain('`shared_accounts_route`');
    expect(text).toContain('use in `accounts.roles`');
    expect(text).toContain('`SwapEvent`');
    expect(text).not.toContain('Looked up by name');
    expect(close).toHaveBeenCalledOnce();
  });

  it('warns to check the address after a lookup by name', async () => {
    describeProgram.mockResolvedValueOnce({ id: JUPITER, name: 'jupiter', instructions: [], events: [], roles: [] });
    const { text } = await call('heliusStreaming', { action: 'describeProgram', program: 'jupiter' });
    expect(text).toContain(`check that \`${JUPITER}\` is the program you mean`);
    expect(text).toContain('**Instructions:** none decoded');
  });

  it('closes the connection when the lookup fails', async () => {
    describeProgram.mockRejectedValueOnce(new Error('describeProgram timed out'));
    const { text, isError } = await call('heliusStreaming', { action: 'describeProgram', program: JUPITER });
    expect(isError).toBe(true);
    expect(text).toContain('describeProgram timed out');
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('surfaces', () => {
  it('serves all four on the read-only surface', () => {
    expect(getSurfaceActions('heliusChain', 'readOnly')).toEqual(expect.arrayContaining(['simulateBundle', 'getBundleStatuses']));
    expect(getSurfaceActions('heliusStreaming', 'readOnly')).toEqual(expect.arrayContaining(['describeProgram', 'getPreConfCoverage']));
  });
});
