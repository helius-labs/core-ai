import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { dispatchRoutedTool } from '../src/router/dispatch.js';
import { createServer } from '../src/server.js';
import { ACTION_NAMES } from '../src/router/actions.js';
import { ACTION_CATALOG, getActionCatalogEntry } from '../src/router/catalog.js';
import { getSurfaceActions, isOnSurface } from '../src/router/surface.js';
import { answerText } from '../src/tools/lana.js';
import { setApiKey, setNetwork } from '../src/utils/helius.js';

const lanaResponses: Array<Response | Error> = [];
const fetchMock = vi.fn(async (url: unknown) => {
  if (!String(url).includes('/v1/lana/messages')) return new Response('{}');
  const next = lanaResponses.shift()!;
  if (next instanceof Error) throw next;
  return next;
});
vi.stubGlobal('fetch', fetchMock);

const WALLET = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';

function respond(body: unknown, status = 200) {
  lanaResponses.push(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
}

function lanaError(status: number, type: string, message: string) {
  respond({ type: 'error', error: { type, message } }, status);
}

function answered(text: string, extra: Record<string, unknown> = {}) {
  respond({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'lana-fast',
    content: [
      { type: 'tool_use', id: 'toolu_1', name: 'lookup', input: {} },
      { type: 'tool_result', tool_use_id: 'toolu_1', content: '{}' },
      { type: 'text', text },
    ],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1, tool_calls: 1, prompt_tokens: 1, context_window: 200000 },
    ...extra,
  });
}

function lanaCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes('/v1/lana/messages')) as unknown as Array<[string, RequestInit]>;
}

function request() {
  const [url, init] = lanaCalls().at(-1)!;
  return { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
}

async function ask(params: Record<string, unknown>, surface: 'full' | 'readOnly' = 'full') {
  const result = await dispatchRoutedTool('heliusLana', { action: 'ask', ...params }, {}, surface);
  return { text: result.content.map((c) => c.text).join('\n'), isError: result.isError };
}

beforeEach(() => {
  fetchMock.mockClear();
  lanaResponses.length = 0;
  setApiKey('test-key');
  setNetwork('mainnet-beta');
});

afterAll(() => {
  setApiKey('');
  vi.unstubAllGlobals();
});

describe('heliusLana.ask', () => {
  it('posts a non-streaming lana-fast turn with the key in X-Api-Key and returns the answer', async () => {
    answered('That transaction failed on slippage: it got 3.2% against a 1% limit.');
    const { text, isError } = await ask({ question: 'Why did my last swap fail?' });

    expect(isError).not.toBe(true);
    expect(request().url).toBe('https://beta.helius-rpc.com/v1/lana/messages');
    expect(request().headers['X-Api-Key']).toBe('test-key');
    expect(request().headers).not.toHaveProperty('Authorization');
    expect(request().url).not.toContain('api-key');
    expect(request().body).toEqual({
      model: 'lana-fast',
      stream: false,
      messages: [{ role: 'user', content: 'Why did my last swap fail?' }],
      extensions: { read_only: true, user_context: { network: 'mainnet' } },
    });
    expect(text).toContain('That transaction failed on slippage');
    expect(text).toContain('Answered by lana-fast for 2,000 credits.');
  });

  it('passes the wallet, the chosen model, and the session network', async () => {
    setNetwork('devnet');
    answered('Funded by one exchange wallet.', { model: 'lana-thinking' });
    const { text } = await ask({ question: 'Where did my funds come from?', wallet: WALLET, model: 'lana-thinking' });

    expect(request().body.model).toBe('lana-thinking');
    expect(request().body.extensions.user_context).toEqual({ network: 'devnet', wallet: WALLET });
    expect(text).toContain('Answered by lana-thinking for 10,000 credits.');
  });

  it('requires a question before calling Lana', async () => {
    const { text, isError } = await ask({});
    expect(isError).toBe(true);
    expect(text).toContain('question');
    expect(lanaCalls()).toHaveLength(0);
  });

  it('rejects an unknown model before calling Lana', async () => {
    const { isError } = await ask({ question: 'hi', model: 'claude-opus' });
    expect(isError).toBe(true);
    expect(lanaCalls()).toHaveLength(0);
  });

  it('asks for a key instead of calling Lana without one', async () => {
    setApiKey('');
    const saved = process.env.HELIUS_API_KEY;
    delete process.env.HELIUS_API_KEY;
    try {
      const { text, isError } = await ask({ question: 'hi' });
      expect(isError).toBe(true);
      expect(text).toContain('setHeliusApiKey');
      expect(lanaCalls()).toHaveLength(0);
    } finally {
      if (saved !== undefined) process.env.HELIUS_API_KEY = saved;
    }
  });

  it('flags an answer that hit the token or step limit', async () => {
    answered('The top holders are', { stop_reason: 'max_tokens' });
    const { text } = await ask({ question: 'Top holders of USDC?' });
    expect(text).toContain('may be cut off');
  });

  it('returns the whole charged answer even when the host asks for a summary', async () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) => `Paragraph ${i + 1}. ${'detail '.repeat(150)}`);
    answered(paragraphs.join('\n\n'));
    const server = createServer({ surface: 'full' });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'lana-test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({
      name: 'heliusLana',
      arguments: { action: 'ask', question: 'Explain this wallet', detail: 'summary', _feedback: 'test', _feedbackTool: 'heliusLana.ask', _model: 'test' },
    });
    await client.close();
    const text = (result.content as Array<{ text: string }>).map((c) => c.text).join('\n');
    expect(text).toContain('Paragraph 6.');
    expect(text).not.toContain('resultId');
  });

  it('returns a failed turn with a partial answer in full, marked incomplete and charged', async () => {
    const partial = `I found two transfers so far. ${'context '.repeat(400)}The end.`;
    answered(partial, { stop_reason: 'error', error: { type: 'tool_error', message: 'A lookup service failed.' } });
    const { text, isError } = await ask({ question: 'Are these wallets connected?' });

    expect(isError).not.toBe(true);
    expect(text).toContain('**Incomplete answer:** A lookup service failed.');
    expect(text).toContain('charged 2,000 credits');
    expect(text).toContain('The end.');
  });

  it('returns a failed turn with nothing to show as an error', async () => {
    respond({ content: [], stop_reason: 'error', error: { type: 'api_error', message: 'Lana failed.' } });
    const { text, isError } = await ask({ question: 'hi' });
    expect(isError).toBe(true);
    expect(text).toContain('Lana failed.');
    expect(text).toContain('charged 2,000 credits');
  });

  it('says an unreadable 200 was charged and should not be retried as is', async () => {
    respond('<html>oops</html>');
    const { text, isError } = await ask({ question: 'hi' });
    expect(isError).toBe(true);
    expect(text).toContain('still charged 2,000 credits');
    expect(text).toContain('Do not retry');
  });

  it('aborts the Lana request when the host cancels the tool call', async () => {
    const controller = new AbortController();
    lanaResponses.push(new Response('{}'));
    controller.abort();
    await dispatchRoutedTool('heliusLana', { action: 'ask', question: 'hi' }, { signal: controller.signal });
    const signal = lanaCalls().at(-1)![1].signal!;
    expect(signal.aborted).toBe(true);
  });

  it('refuses on a shared-credential server, which would bill the operator', async () => {
    process.env.HELIUS_MCP_SHARED_CREDENTIAL = '1';
    try {
      const { text, isError } = await ask({ question: 'hi' });
      expect(isError).toBe(true);
      expect(text).toContain('shared API key');
      expect(lanaCalls()).toHaveLength(0);
    } finally {
      delete process.env.HELIUS_MCP_SHARED_CREDENTIAL;
    }
  });
});

describe('heliusLana.ask errors', () => {
  it('maps 403 to the paid-plan message that points at upgradePlan', async () => {
    respond('Forbidden', 403);
    const { text, isError } = await ask({ question: 'hi' });
    expect(isError).toBe(true);
    expect(text).toContain('Lana needs a paid Helius plan');
    expect(text).toContain('upgradePlan');
  });

  it.each([
    [403, 'Forbidden'],
    [429, 'max usage reached'],
  ])('points the read-only surface at the dashboard for a %i, never at a removed action', async (status, body) => {
    respond(body, status);
    const { text } = await ask({ question: 'hi' }, 'readOnly');
    for (const removed of ACTION_NAMES.filter((action) => !isOnSurface(ACTION_CATALOG[action], 'readOnly'))) {
      expect(text, removed).not.toMatch(new RegExp(`\\b${removed}\\b`));
    }
    expect(text).toContain('dashboard.helius.dev');
  });

  it('maps 401 to the set-your-key guidance', async () => {
    respond('Unauthorized', 401);
    const { text } = await ask({ question: 'hi' });
    expect(text).toContain('API key is invalid or expired');
    expect(text).toContain('setHeliusApiKey');
  });

  it('tells an out-of-credits project to add credits, not to retry', async () => {
    respond('max usage reached', 429);
    const { text } = await ask({ question: 'hi' });
    expect(text).toContain('out of credits');
    expect(text).toContain('Retrying fails');
    expect(text).toContain('purchaseCredits');
  });

  it('tells a project at the concurrency limit to wait and ask one question at a time', async () => {
    lanaError(429, 'rate_limit_error', 'Too many concurrent requests.');
    const { text } = await ask({ question: 'hi' });
    expect(text).toContain('about 3 Lana requests running');
    expect(text).toContain('then retry');
  });

  it.each([503, 529])('treats %i as capacity and retryable', async (status) => {
    lanaError(status, 'overloaded_error', 'Lana is temporarily overloaded.');
    const { text } = await ask({ question: 'hi' });
    expect(text).toContain('at capacity');
    expect(text).toContain('Retry in 5 to 30 seconds');
  });

  it('suggests lana-fast when lana-thinking times out', async () => {
    lanaError(504, 'timeout_error', 'The turn ran out of time.');
    const { text } = await ask({ question: 'hi', model: 'lana-thinking' });
    expect(text).toContain('ran out of time');
    expect(text).toContain('lana-fast');
  });

  it('reports a client-side timeout as Lana running out of time', async () => {
    lanaResponses.push(new DOMException('The operation was aborted due to timeout', 'TimeoutError') as unknown as Error);
    const { text } = await ask({ question: 'hi' });
    expect(text).toContain('ran out of time');
  });

  it('asks for a narrower question on context overflow', async () => {
    lanaError(400, 'context_overflow', 'Too much context.');
    const { text } = await ask({ question: 'hi' });
    expect(text).toContain("didn't fit in its context window");
    expect(text).toContain('narrower question');
  });

  it('shows the message of an invalid request', async () => {
    lanaError(400, 'invalid_request_error', 'messages.0.content: must not be empty');
    const { text } = await ask({ question: 'hi' });
    expect(text).toContain('messages.0.content: must not be empty');
    expect(text).toContain('Fix the request.');
  });

  it('never retries, since every 200 is charged', async () => {
    lanaError(502, 'tool_error', 'A lookup service failed.');
    const { text } = await ask({ question: 'hi' });
    expect(text).toContain('A lookup service failed.');
    expect(lanaCalls()).toHaveLength(1);
  });
});

describe('answerText', () => {
  it('joins the text blocks in order and links citations to their sources', () => {
    const text = answerText({
      content: [
        { type: 'text', text: 'SOL is up today{{cite:0}}.' },
        { type: 'tool_use' },
        { type: 'text', text: 'Volume is flat{{cite:5}}.' },
      ],
      sources: [{ index: 0, url: 'https://example.com/sol' }],
    });
    expect(text).toBe('SOL is up today [1](https://example.com/sol).\n\nVolume is flat.');
  });
});

describe('heliusLana catalog entry', () => {
  it('is a paid-plan read that expandResult never replays, so a second charge cannot happen', () => {
    const entry = getActionCatalogEntry('ask');
    expect(entry.mutability).toBe('read');
    expect(entry.handleEligibility).toBe(false);
    expect(entry.capabilityGate.baseline.minimumPlan).toBe('developer');
  });

  it('is on the read-only surface', () => {
    expect(getSurfaceActions('heliusLana', 'readOnly')).toEqual(['ask']);
  });
});
