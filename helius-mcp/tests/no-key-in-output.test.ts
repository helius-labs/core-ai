import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Key state is driven by setApiKey; never fall back to the real ~/.helius config.
vi.mock('../src/utils/config.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/utils/config.js')>();
  return { ...original, getSharedApiKey: vi.fn(() => undefined) };
});
import { dispatchRoutedTool } from '../src/router/dispatch.js';
import { setApiKey, setNetwork } from '../src/utils/helius.js';

/**
 * Tool output goes into the model's context, and from there into transcripts
 * and the code the model writes. The output scrubber only runs in
 * shared-credential mode, so in the stdio build these tools are the only thing
 * keeping the configured key out of it.
 */

const KEY = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const SOL = 'So11111111111111111111111111111111111111112';
const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

async function call(tool: string, action: string, params: Record<string, unknown> = {}) {
  const result = await dispatchRoutedTool(tool, { action, detail: 'full', ...params }, {});
  return { text: result.content.map((c) => c.text).join('\n'), isError: result.isError };
}

const DOC = '# Enhanced WebSockets\n\n## Capabilities\nFaster than standard WebSockets.\n';

beforeEach(() => {
  setApiKey(KEY);
  setNetwork('mainnet-beta');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(DOC, { status: 200 })));
});

afterEach(() => vi.unstubAllGlobals());

afterAll(() => setApiKey(''));

describe('streaming config generators never print the configured key', () => {
  const cases: [string, string, Record<string, unknown>][] = [
    ['heliusKnowledge', 'getEnhancedWebSocketInfo', {}],
    ['heliusStreaming', 'transactionSubscribe', { accountInclude: [SOL] }],
    ['heliusStreaming', 'accountSubscribe', { account: SOL }],
    ['heliusStreaming', 'parsedTransactionSubscribe', { programs: [JUP] }],
    ['heliusStreaming', 'preconfSubscribe', {}],
    ['heliusStreaming', 'preprocessedSubscribe', { accountInclude: [JUP] }],
  ];

  it.each(cases)('%s.%s', async (tool, action, params) => {
    const { text, isError } = await call(tool, action, params);
    expect(isError, text).toBeFalsy();
    expect(text).not.toContain(KEY);
    expect(text).toContain('api-key=YOUR_HELIUS_API_KEY');
  });

  it('has Enhanced WebSocket example code read the key from the environment', async () => {
    for (const [action, params] of [['transactionSubscribe', { accountInclude: [SOL] }], ['accountSubscribe', { account: SOL }]] as const) {
      const { text } = await call('heliusStreaming', action, params);
      expect(text).toContain('new WebSocket(`wss://atlas-mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`)');
    }
  });
});

describe('without a key', () => {
  const envKey = process.env.HELIUS_API_KEY;
  beforeEach(() => {
    setApiKey('');
    delete process.env.HELIUS_API_KEY;
  });
  afterAll(() => {
    if (envKey !== undefined) process.env.HELIUS_API_KEY = envKey;
  });

  it('still serves the Enhanced WebSocket docs, which need no key', async () => {
    const { text, isError } = await call('heliusKnowledge', 'getEnhancedWebSocketInfo');
    expect(isError, text).toBeFalsy();
    expect(text).toContain('wss://atlas-mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_API_KEY');
  });

  it('still asks for a key before generating an Enhanced WebSocket subscription', async () => {
    const { text } = await call('heliusStreaming', 'transactionSubscribe', { accountInclude: [SOL] });
    expect(text).not.toContain('Subscription Request');
    expect(text.toLowerCase()).toContain('api key');
  });
});
