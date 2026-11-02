import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Key state is driven by setApiKey; never fall back to the real ~/.helius config.
vi.mock('../src/utils/config.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/utils/config.js')>();
  return { ...original, getSharedApiKey: vi.fn(() => undefined) };
});
import { dispatchRoutedTool } from '../src/router/dispatch.js';
import { getSurfaceActions } from '../src/router/surface.js';
import { setApiKey, setNetwork } from '../src/utils/helius.js';

const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const SOL = 'So11111111111111111111111111111111111111112';
const WALLET = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';

async function call(action: string, params: Record<string, unknown> = {}): Promise<{ text: string; isError?: boolean }> {
  const result = await dispatchRoutedTool('heliusStreaming', { action, detail: 'full', ...params }, {});
  return { text: result.content.map((c) => c.text).join('\n'), isError: result.isError };
}

/** The JSON request a generator printed. */
function request(text: string): Record<string, any> {
  const json = text.match(/\*\*Subscription Request:\*\*\n```json\n([\s\S]*?)\n```/)?.[1];
  expect(json, 'no subscription request in output').toBeTruthy();
  return JSON.parse(json!);
}

function code(text: string): string {
  return text.match(/```typescript\n([\s\S]*?)\n```/)?.[1] ?? '';
}

beforeEach(() => {
  setApiKey('test-key');
  setNetwork('mainnet-beta');
});

afterAll(() => setApiKey(''));

describe('parsedTransactionSubscribe', () => {
  it('requires programs or accountInclude, since there is no unfiltered stream', async () => {
    const { text, isError } = await call('parsedTransactionSubscribe', { instructionNames: ['route'] });
    expect(isError).toBe(true);
    expect(text).toContain('At least one of `programs` or `accountInclude` is required');
  });

  it('maps accountInclude and accountRoles into accounts, and notificationDetails into details', async () => {
    const { text } = await call('parsedTransactionSubscribe', {
      programs: [JUP],
      instructionNames: ['route'],
      accountInclude: [SOL],
      accountRoles: { user_transfer_authority: WALLET },
      includeCpi: false,
      notificationDetails: 'matched',
    });
    expect(request(text)).toEqual({
      jsonrpc: '2.0', id: 1, method: 'parsedTransactionSubscribe',
      params: [
        { programs: [JUP], instructionNames: ['route'], accounts: { include: [SOL], roles: { user_transfer_authority: WALLET } }, includeCpi: false },
        { commitment: 'confirmed', details: 'matched' },
      ],
    });
    expect(text).toContain('`wss://beta.helius-rpc.com/?api-key=test-key`');
  });

  it('checks instruction and role names with describeProgram in the generated code', async () => {
    const { text } = await call('parsedTransactionSubscribe', { programs: [JUP], instructionNames: ['route'], accountRoles: { owner: WALLET } });
    expect(code(text)).toContain('streams.describeProgram(p)');
    expect(code(text)).toContain('Unknown instruction names');
    expect(code(text)).toContain('Unknown account roles');
    expect(text).toContain('must match the catalog exactly');
  });

  it('skips the name check when the filter names nothing', async () => {
    const { text } = await call('parsedTransactionSubscribe', { programs: [JUP] });
    expect(code(text)).not.toContain('describeProgram');
  });

  it('reads raw notifications as program and data, since raw has no decoded fields', async () => {
    const { text } = await call('parsedTransactionSubscribe', { accountInclude: [SOL], notificationDetails: 'raw' });
    expect(code(text)).toContain('ix.programId, ix.data');
    expect(code(text)).not.toContain('matchedIndexes');
    expect(code(text)).toContain('{ details: "raw" }');
  });

  it('rejects more than 10 programs', async () => {
    const programs = Array.from({ length: 11 }, () => JUP);
    const { text, isError } = await call('parsedTransactionSubscribe', { programs });
    expect(isError).toBe(true);
    expect(text).toContain('`programs` has 11 entries; the maximum is 10');
  });

  it('warns on a malformed address and an over-long name', async () => {
    const { text } = await call('parsedTransactionSubscribe', { programs: ['jupiter'], instructionNames: ['x'.repeat(65)] });
    expect(text).toContain('invalid format');
    expect(text).toContain('at most 64 characters');
  });

  it('warns that Gatekeeper streams mainnet when the session is on devnet', async () => {
    setNetwork('devnet');
    const { text } = await call('parsedTransactionSubscribe', { programs: [JUP] });
    expect(text).toContain('The session is on devnet');
    expect(text).toContain('wss://beta.helius-rpc.com');
  });
});

describe('preconfSubscribe', () => {
  it('omits params and warns about cost when unfiltered', async () => {
    const { text } = await call('preconfSubscribe');
    expect(request(text)).toEqual({ jsonrpc: '2.0', id: 1, method: 'preconfSubscribe' });
    expect(text).toContain('No filter: this streams every transaction');
    expect(code(text)).toContain('client.preconfSubscribe()');
    expect(text).toContain('helius-sdk 3.3.0 or later for filters');
  });

  it('passes undefined as the filter when only slot events are requested', async () => {
    const { text } = await call('preconfSubscribe', { slots: true });
    expect(code(text)).toContain('client.preconfSubscribe(undefined, { slots: true })');
    expect(code(text)).toContain('event.type === "slot"');
    expect(text).toContain('helius-sdk 3.4.0 or later');
  });

  it('sends every filter field, keeps slots client-side, and needs 3.4.0 for includeSource', async () => {
    const instructions = [{ programId: JUP, memcmp: [{ offset: 0, bytes: '66063d1201daebea', encoding: 'hex' }], dataSize: 24 }];
    const { text } = await call('preconfSubscribe', {
      includeSource: ['helius'], failed: false, regionInclude: ['ewr'],
      accountInclude: [JUP], signerExclude: [WALLET], instructions, slots: true,
    });
    expect(request(text).params).toEqual([{
      includeSource: ['helius'], failed: false, regionInclude: ['ewr'],
      accountInclude: [JUP], signerExclude: [WALLET], instructions,
    }]);
    expect(text).toContain('helius-sdk 3.4.0 or later for `includeSource` and slot events');
    expect(text).toContain('drops transactions that carry no region information');
  });

  it('rejects an unknown region code', async () => {
    const { text, isError } = await call('preconfSubscribe', { regionInclude: ['ewr', 'nyc'] });
    expect(isError).toBe(true);
    expect(text).toContain('`nyc`');
  });

  it('rejects more than 1,000 signatures', async () => {
    const { isError, text } = await call('preconfSubscribe', { signatures: Array(1001).fill('sig') });
    expect(isError).toBe(true);
    expect(text).toContain('maximum is 1,000');
  });

  it('flags an account in both accountInclude and accountExclude', async () => {
    const { text } = await call('preconfSubscribe', { accountInclude: [JUP], accountExclude: [JUP] });
    expect(text).toContain('appear in both accountInclude and accountExclude');
  });
});

describe('preprocessedSubscribe', () => {
  it('requires accountInclude or accountRequired', async () => {
    const { text, isError } = await call('preprocessedSubscribe', { accountExclude: [JUP] });
    expect(isError).toBe(true);
    expect(text).toContain('must name at least one account between them');
  });

  it('sends params as an object with all three lists, as the reference does', async () => {
    const { text } = await call('preprocessedSubscribe', { accountRequired: [JUP, SOL] });
    expect(request(text)).toEqual({
      jsonrpc: '2.0', id: 1, method: 'preprocessedSubscribe',
      params: { accountInclude: [], accountExclude: [], accountRequired: [JUP, SOL] },
    });
    expect(code(text)).toContain('buf.readBigUInt64LE(1)');
    expect(code(text)).toContain('setTimeout(connect, 1_000)');
  });

  it('rejects more than 5,000 addresses in a list', async () => {
    const { isError, text } = await call('preprocessedSubscribe', { accountInclude: Array(5001).fill(JUP) });
    expect(isError).toBe(true);
    expect(text).toContain('maximum is 5,000');
  });
});

describe('all three', () => {
  it('ask for an API key before printing a URL', async () => {
    setApiKey('');
    const saved = process.env.HELIUS_API_KEY;
    delete process.env.HELIUS_API_KEY;
    try {
      for (const [action, params] of [
        ['parsedTransactionSubscribe', { programs: [JUP] }],
        ['preconfSubscribe', {}],
        ['preprocessedSubscribe', { accountInclude: [JUP] }],
      ] as const) {
        const { text, isError } = await call(action, params);
        expect(isError, action).toBe(true);
        expect(text, action).toContain('Helius API Key Required');
      }
    } finally {
      if (saved !== undefined) process.env.HELIUS_API_KEY = saved;
    }
  });

  it('print the key placeholder in shared-credential mode', async () => {
    const saved = { shared: process.env.HELIUS_MCP_SHARED_CREDENTIAL, key: process.env.HELIUS_API_KEY };
    process.env.HELIUS_MCP_SHARED_CREDENTIAL = '1';
    process.env.HELIUS_API_KEY = 'operator-key';
    try {
      const { text } = await call('preprocessedSubscribe', { accountInclude: [JUP] });
      expect(text).toContain('api-key=YOUR_HELIUS_API_KEY');
      expect(text).not.toContain('operator-key');
    } finally {
      if (saved.shared === undefined) delete process.env.HELIUS_MCP_SHARED_CREDENTIAL; else process.env.HELIUS_MCP_SHARED_CREDENTIAL = saved.shared;
      if (saved.key === undefined) delete process.env.HELIUS_API_KEY; else process.env.HELIUS_API_KEY = saved.key;
    }
  });

  it('are on the read-only surface', () => {
    expect(getSurfaceActions('heliusStreaming', 'readOnly')).toEqual(
      expect.arrayContaining(['parsedTransactionSubscribe', 'preconfSubscribe', 'preprocessedSubscribe']),
    );
  });
});
