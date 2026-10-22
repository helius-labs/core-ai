import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchRoutedTool, expandStoredResult } from '../src/router/dispatch.js';
import { getRouterContext } from '../src/router/context.js';
import { clearStoredResults } from '../src/results/store.js';
import { callActionHandler } from '../src/router/action-handlers.js';

vi.mock('../src/router/action-handlers.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/router/action-handlers.js')>();
  return { ...original, callActionHandler: vi.fn() };
});

const handler = vi.mocked(callActionHandler);

/** The SDK `extra` a hosted transport attaches for an authenticated caller. */
function hostedCaller(apiKey: string, sessionId?: string): Record<string, unknown> {
  return { authInfo: { token: apiKey, clientId: 'test', scopes: [] }, ...(sessionId ? { sessionId } : {}) };
}

const STDIO = {};
const ADDRESS = '11111111111111111111111111111111';

async function storeHandle(extra: unknown): Promise<string> {
  handler.mockResolvedValueOnce({
    content: [{ type: 'text', text: 'page 1' }],
    continuation: { kind: 'paginationToken', api: 'history', token: 'TKN1' },
  });
  const response = await dispatchRoutedTool(
    'heliusTransaction',
    { action: 'getTransactionHistory', address: ADDRESS, detail: 'summary' },
    extra,
  );
  const match = response.content[0].text.match(/resultId:\s+([^\n]+)/);
  expect(match, 'the summary response should carry a resultId').toBeTruthy();
  return match![1].trim();
}

async function expand(resultId: string, extra: unknown, params: Record<string, unknown> = {}) {
  handler.mockResolvedValueOnce({
    content: [{ type: 'text', text: 'page 2' }],
    continuation: { kind: 'paginationToken', api: 'history', token: 'TKN2' },
  });
  return expandStoredResult({ resultId, ...params }, extra);
}

function wasFound(response: Awaited<ReturnType<typeof expand>>): boolean {
  return !response.content[0].text.includes('Result handle not found');
}

beforeEach(() => {
  clearStoredResults();
  handler.mockReset();
});

describe('result handle ownership', () => {
  it('works as before for stdio, where requests carry no identity', async () => {
    const resultId = await storeHandle(STDIO);
    expect(wasFound(await expand(resultId, STDIO))).toBe(true);
  });

  it('keeps one hosted caller from redeeming another caller\'s handle', async () => {
    const resultId = await storeHandle(hostedCaller('key-alice'));

    expect(wasFound(await expand(resultId, hostedCaller('key-bob')))).toBe(false);
    expect(wasFound(await expand(resultId, hostedCaller('key-alice')))).toBe(true);
  });

  it('does not re-run the stored recipe for a caller who does not own it', async () => {
    const resultId = await storeHandle(hostedCaller('key-alice'));
    handler.mockClear();

    await expandStoredResult({ resultId }, hostedCaller('key-bob'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('separates two transport sessions on the same API key', async () => {
    const resultId = await storeHandle(hostedCaller('key-alice', 'session-1'));

    expect(wasFound(await expand(resultId, hostedCaller('key-alice', 'session-2')))).toBe(false);
    expect(wasFound(await expand(resultId, hostedCaller('key-alice', 'session-1')))).toBe(true);
  });

  it('keeps stdio and hosted callers apart in both directions', async () => {
    const stdioHandle = await storeHandle(STDIO);
    const hostedHandle = await storeHandle(hostedCaller('key-alice'));

    expect(wasFound(await expand(stdioHandle, hostedCaller('key-alice')))).toBe(false);
    expect(wasFound(await expand(hostedHandle, STDIO))).toBe(false);
  });

  it('gives a next-page handle the same owner as the caller who expanded it', async () => {
    const first = await storeHandle(hostedCaller('key-alice'));
    const next = await expand(first, hostedCaller('key-alice'), { continuation: 'next', detail: 'summary' });

    const match = next.content[0].text.match(/resultId:\s+([^\n]+)/);
    expect(match, 'expanding the next page in summary detail should issue a new handle').toBeTruthy();
    const nextHandle = match![1].trim();

    expect(wasFound(await expand(nextHandle, hostedCaller('key-bob')))).toBe(false);
    expect(wasFound(await expand(nextHandle, hostedCaller('key-alice')))).toBe(true);
  });
});

describe('getRouterContext', () => {
  it('is stable for the same caller and session', () => {
    expect(getRouterContext(hostedCaller('key-alice', 's1')).sessionKey)
      .toBe(getRouterContext(hostedCaller('key-alice', 's1')).sessionKey);
    expect(getRouterContext().sessionKey).toBe(getRouterContext(STDIO).sessionKey);
  });

  it('does not expose the API key in the owner key', () => {
    expect(getRouterContext(hostedCaller('key-alice')).sessionKey).not.toContain('key-alice');
    expect(getRouterContext(hostedCaller('key-alice', 's1')).sessionKey).not.toContain('key-alice');
  });
});
