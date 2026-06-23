import { describe, expect, it, vi } from 'vitest';
import {
  isRetryable,
  withTimeout,
  withResilience,
  wrapClientWithResilience,
  type ResilienceOptions,
} from '../src/utils/resilience.js';

// Fast settings so retry/backoff tests don't sleep for real.
const FAST: ResilienceOptions = { baseDelayMs: 0, maxDelayMs: 0, jitter: 0, attempts: 3, timeoutMs: 1_000 };

function err(props: Record<string, unknown>, message = 'boom'): Error {
  return Object.assign(new Error(message), props);
}

/** A fn that rejects `failCount` times then resolves to `value`. */
function flaky(failCount: number, error: unknown, value: unknown = 'ok') {
  let calls = 0;
  return vi.fn(async () => {
    calls += 1;
    if (calls <= failCount) throw error;
    return value;
  });
}

describe('isRetryable', () => {
  it('retries kit SolanaError 429 via context.statusCode', () => {
    expect(isRetryable(err({ context: { statusCode: 429 } }, 'HTTP error (429): Too Many Requests'))).toBe(true);
  });

  it('retries 502/503/504 via statusCode', () => {
    expect(isRetryable(err({ statusCode: 502 }))).toBe(true);
    expect(isRetryable(err({ statusCode: 503 }))).toBe(true);
    expect(isRetryable(err({ statusCode: 504 }))).toBe(true);
  });

  it('retries on a bare status code in the message', () => {
    expect(isRetryable(new Error('HTTP 429: rate limited'))).toBe(true);
    expect(isRetryable(new Error('RPC error: server returned 503'))).toBe(true);
  });

  it('retries network resets via code and cause.code', () => {
    expect(isRetryable(err({ code: 'ECONNRESET' }))).toBe(true);
    expect(isRetryable(err({ cause: { code: 'ETIMEDOUT' } }))).toBe(true);
    expect(isRetryable(new Error('fetch failed'))).toBe(true);
  });

  it('does NOT retry client-side timeouts/aborts (fail fast)', () => {
    expect(isRetryable(err({ name: 'TimeoutError' }))).toBe(false);
    expect(isRetryable(err({ name: 'AbortError' }))).toBe(false);
  });

  it('does NOT retry 4xx client errors', () => {
    expect(isRetryable(err({ statusCode: 400 }))).toBe(false);
    expect(isRetryable(err({ context: { statusCode: 404 } }, 'HTTP error (404): Not Found'))).toBe(false);
    expect(isRetryable(new Error('invalid address'))).toBe(false);
  });
});

describe('withTimeout', () => {
  it('returns the value when fn resolves in time', async () => {
    await expect(withTimeout(async () => 42, 1_000)).resolves.toBe(42);
  });

  it('rejects with a non-retryable TimeoutError when fn hangs', async () => {
    const p = withTimeout(() => new Promise<never>(() => {}), 20, 'getThing');
    await expect(p).rejects.toMatchObject({ name: 'TimeoutError' });
    await p.catch((e) => expect(isRetryable(e)).toBe(false));
  });

  it('passes through when ms <= 0', async () => {
    await expect(withTimeout(async () => 'x', 0)).resolves.toBe('x');
  });
});

describe('withResilience', () => {
  it('retries a transient failure then succeeds', async () => {
    const fn = flaky(2, err({ statusCode: 429 }), 'done');
    await expect(withResilience(fn, 'read', FAST)).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-retryable error', async () => {
    const fn = flaky(1, err({ statusCode: 400 }), 'done');
    await expect(withResilience(fn, 'read', FAST)).rejects.toMatchObject({ statusCode: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt budget', async () => {
    const fn = flaky(99, err({ statusCode: 503 }), 'never');
    await expect(withResilience(fn, 'read', FAST)).rejects.toMatchObject({ statusCode: 503 });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('wrapClientWithResilience', () => {
  function makeClient() {
    return {
      getThing: flaky(1, err({ statusCode: 429 }), 'read-ok'),
      searchThing: flaky(0, null, 'search-ok'),
      sendThing: flaky(1, err({ statusCode: 429 }), 'send-ok'),
      version: '1.0.0',
      tx: {
        getComputeUnits: flaky(1, err({ statusCode: 429 }), 4200),
        sendTransactionWithSender: flaky(1, err({ statusCode: 429 }), 'sig'),
      },
      // wallet/zk are pure-read namespaces; the second method in each is a
      // synthetic non-read that guards the prefix gate within the namespace.
      wallet: {
        getBalances: flaky(1, err({ statusCode: 429 }), 'wallet-read'),
        updateLabel: flaky(1, err({ statusCode: 429 }), 'wallet-write'),
      },
      zk: {
        getCompressedAccount: flaky(1, err({ statusCode: 429 }), 'zk-read'),
        sendCompressed: flaky(1, err({ statusCode: 429 }), 'zk-write'),
      },
      ws: {
        // Streaming: must NOT be wrapped.
        logsNotifications: flaky(1, err({ statusCode: 429 }), 'sub'),
      },
    };
  }

  it('retries read methods (get/search/simulate)', async () => {
    const c = makeClient();
    const wrapped = wrapClientWithResilience(c, FAST);
    await expect(wrapped.getThing()).resolves.toBe('read-ok');
    expect(c.getThing).toHaveBeenCalledTimes(2); // 1 fail + 1 success
  });

  it('does NOT retry non-read methods (sends)', async () => {
    const c = makeClient();
    const wrapped = wrapClientWithResilience(c, FAST);
    await expect(wrapped.sendThing()).rejects.toMatchObject({ statusCode: 429 });
    expect(c.sendThing).toHaveBeenCalledTimes(1);
  });

  it('recurses into the tx namespace: getComputeUnits retried, send not', async () => {
    const c = makeClient();
    const wrapped = wrapClientWithResilience(c, FAST);
    await expect(wrapped.tx.getComputeUnits()).resolves.toBe(4200);
    expect(c.tx.getComputeUnits).toHaveBeenCalledTimes(2);

    await expect(wrapped.tx.sendTransactionWithSender()).rejects.toMatchObject({ statusCode: 429 });
    expect(c.tx.sendTransactionWithSender).toHaveBeenCalledTimes(1);
  });

  it('recurses into the wallet namespace: getBalances retried, non-read not', async () => {
    const c = makeClient();
    const wrapped = wrapClientWithResilience(c, FAST);
    await expect(wrapped.wallet.getBalances()).resolves.toBe('wallet-read');
    expect(c.wallet.getBalances).toHaveBeenCalledTimes(2);

    await expect(wrapped.wallet.updateLabel()).rejects.toMatchObject({ statusCode: 429 });
    expect(c.wallet.updateLabel).toHaveBeenCalledTimes(1);
  });

  it('recurses into the zk namespace: getCompressedAccount retried, non-read not', async () => {
    const c = makeClient();
    const wrapped = wrapClientWithResilience(c, FAST);
    await expect(wrapped.zk.getCompressedAccount()).resolves.toBe('zk-read');
    expect(c.zk.getCompressedAccount).toHaveBeenCalledTimes(2);

    await expect(wrapped.zk.sendCompressed()).rejects.toMatchObject({ statusCode: 429 });
    expect(c.zk.sendCompressed).toHaveBeenCalledTimes(1);
  });

  it('leaves the ws namespace untouched (no retry on streaming)', async () => {
    const c = makeClient();
    const wrapped = wrapClientWithResilience(c, FAST);
    await expect(wrapped.ws.logsNotifications()).rejects.toMatchObject({ statusCode: 429 });
    expect(c.ws.logsNotifications).toHaveBeenCalledTimes(1);
  });

  it('returns non-function properties as-is', () => {
    const wrapped = wrapClientWithResilience(makeClient(), FAST);
    expect(wrapped.version).toBe('1.0.0');
  });

  it('does not retry a read that times out', async () => {
    const hang = vi.fn(() => new Promise<never>(() => {}));
    const wrapped = wrapClientWithResilience({ getStuck: hang }, { ...FAST, timeoutMs: 20 });
    await expect(wrapped.getStuck()).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(hang).toHaveBeenCalledTimes(1);
  });
});
