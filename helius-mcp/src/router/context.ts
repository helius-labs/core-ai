import { createHash, randomUUID } from 'node:crypto';
import { getNetwork } from '../utils/helius.js';
import { contextFromExtra, type RequestContext } from '../utils/request-context.js';

/**
 * Owner of results stored for requests that carry no identity: the stdio
 * server, where one process serves one user.
 */
const PROCESS_SESSION_KEY = randomUUID();

export type RouterContext = {
  /** Owner of the `expandResult` handles this request stores and may redeem. */
  sessionKey: string;
  network: 'mainnet-beta' | 'devnet';
};

function transportSessionId(extra: unknown): string | undefined {
  if (typeof extra !== 'object' || extra === null) return undefined;
  const sessionId = (extra as { sessionId?: unknown }).sessionId;
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : undefined;
}

/**
 * Whose handles a request can see.
 *
 * Without a request context, every request shares the process key, as it
 * always has. With one, the owner is the caller's key, narrowed to the
 * transport session when the transport has one, so two connections on the
 * same API key do not evict or read each other's handles.
 */
function resultOwnerKey(ctx: RequestContext | null, extra: unknown): string {
  if (!ctx) return PROCESS_SESSION_KEY;
  const sessionId = transportSessionId(extra);
  if (!sessionId) return ctx.sessionKey;
  return createHash('sha256').update(`${ctx.sessionKey}:${sessionId}`).digest('hex').slice(0, 32);
}

/** Router state for one request. Pass the SDK's `extra` so handles are scoped to the caller. */
export function getRouterContext(extra?: unknown): RouterContext {
  const ctx = contextFromExtra(extra);
  return {
    sessionKey: resultOwnerKey(ctx, extra),
    network: getNetwork(ctx) === 'devnet' ? 'devnet' : 'mainnet-beta',
  };
}
