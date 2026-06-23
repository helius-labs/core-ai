/**
 * RPC resilience for the Helius client: a per-call timeout plus retry-with-backoff
 * for transient failures (HTTP 429/502/503/504 and network resets).
 *
 * Only idempotent reads are wrapped — methods whose name matches `READ_METHOD_RE`
 * (`get*` / `search*` / `simulate*`). Everything else passes through untouched:
 * sends (`sendTransactionWithSender`, `sendSmartTransaction`, `broadcastTransaction`),
 * webhook `create`/`update`/`delete`, `pollTransactionConfirmation`, and streaming
 * (`ws`). This guarantees we never retry a non-idempotent write or abandon a
 * transaction that is still confirming — sends self-bound via the SDK's poll timeout.
 *
 * Client-side timeouts fail fast (no retry): retrying a hung call just hangs again.
 * Only fast-failing transients (429/5xx/network reset) are retried.
 */

const READ_METHOD_RE = /^(get|search|simulate)/;
const WRAPPED_NAMESPACES = new Set(['enhanced', 'webhooks', 'tx', 'wallet', 'zk']);
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EPIPE',
]);

/** Default per-attempt timeout for idempotent reads. */
export const READ_TIMEOUT_MS = 30_000;

export interface ResilienceOptions {
  /** Total attempts including the first. */
  attempts?: number;
  baseDelayMs?: number;
  factor?: number;
  maxDelayMs?: number;
  /** Fractional jitter, 0..1. */
  jitter?: number;
  /** Per-attempt timeout in ms. 0 disables the timeout race. */
  timeoutMs?: number;
}

const DEFAULTS: Required<ResilienceOptions> = {
  attempts: 3,
  baseDelayMs: 400,
  factor: 2,
  maxDelayMs: 5_000,
  jitter: 0.2,
  timeoutMs: READ_TIMEOUT_MS,
};

class TimeoutError extends Error {
  constructor(ms: number, label: string) {
    super(`Request timed out after ${ms}ms${label ? ` (${label})` : ''}`);
    this.name = 'TimeoutError';
  }
}

function statusOf(err: { context?: { statusCode?: number }; statusCode?: number; status?: number }): number | undefined {
  return err?.context?.statusCode ?? err?.statusCode ?? err?.status;
}

/** True when an error is a transient failure worth retrying. */
export function isRetryable(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; code?: string; cause?: { code?: string } };
    // Client-side timeout/abort: fail fast (retrying a hung call just hangs again).
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return false;
    const status = statusOf(e as Parameters<typeof statusOf>[0]);
    if (typeof status === 'number' && RETRYABLE_STATUS.has(status)) return true;
    const code = e.code ?? e.cause?.code;
    if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  // Match a bare status code (kit: "HTTP error (429): ...", restRequest: "HTTP 429: ...").
  if (/(?:^|[^\d])(429|502|503|504)(?:[^\d]|$)/.test(msg)) return true;
  if (/fetch failed|socket hang up|network error|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i.test(msg)) return true;
  return false;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Race a promise-returning fn against a timeout. `ms <= 0` disables the race. */
export async function withTimeout<T>(fn: () => Promise<T>, ms: number, label = ''): Promise<T> {
  if (!ms || ms <= 0) return fn();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(ms, label)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Run `fn` with a timeout and exponential backoff on transient errors. */
export async function withResilience<T>(fn: () => Promise<T>, label = '', opts: ResilienceOptions = {}): Promise<T> {
  const o = { ...DEFAULTS, ...opts };
  for (let attempt = 1; ; attempt++) {
    try {
      return await withTimeout(fn, o.timeoutMs, label);
    } catch (err) {
      if (attempt >= o.attempts || !isRetryable(err)) throw err;
      const base = Math.min(o.maxDelayMs, o.baseDelayMs * o.factor ** (attempt - 1));
      const jittered = base * (1 + (Math.random() * 2 - 1) * o.jitter);
      await sleep(Math.max(0, Math.round(jittered)));
    }
  }
}

/**
 * Wrap a Helius client so idempotent reads get timeout + retry. Recurses into the
 * `enhanced`/`webhooks`/`tx`/`wallet`/`zk` namespaces; leaves `ws` (streaming) and
 * all non-read methods (sends, webhook mutations) untouched.
 */
export function wrapClientWithResilience<T extends object>(client: T, opts: ResilienceOptions = {}): T {
  const makeHandler = (prefix: string): ProxyHandler<Record<string | symbol, unknown>> => ({
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string') return value;

      // Recurse into request/response namespaces. `ws` is intentionally excluded.
      if (WRAPPED_NAMESPACES.has(prop) && value && typeof value === 'object') {
        return new Proxy(value as Record<string | symbol, unknown>, makeHandler(`${prop}.`));
      }

      if (typeof value !== 'function') return value;

      const retry = READ_METHOD_RE.test(prop);
      const label = `${prefix}${prop}`;
      const fn = value as (...args: unknown[]) => unknown;
      return (...args: unknown[]) => {
        const invoke = () => fn.apply(target, args);
        // Reads: timeout + retry. Everything else: untouched passthrough.
        return retry ? withResilience(() => Promise.resolve(invoke()), label, opts) : invoke();
      };
    },
  });

  return new Proxy(client as Record<string | symbol, unknown>, makeHandler('')) as T;
}
