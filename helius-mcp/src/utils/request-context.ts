import { createHash } from 'node:crypto';

/**
 * Per-request credential and network state.
 *
 * Everything the tool layer needs to act *as one caller*. The stdio build has a
 * single caller for the life of the process, so it resolves this from module
 * state; a hosted build has a different caller every request and resolves it
 * from the request itself.
 *
 * This type is deliberately small: it carries what identifies and authorises a
 * caller, not a grab-bag of request metadata. Anything that is the same for
 * every caller — public docs, the action catalogue — stays shared.
 *
 * Lives in `utils/` rather than `router/` because `utils/helius.ts` consumes it
 * and `utils/` never imports from `router/`.
 */
export type RequestContext = {
  /** The caller's own Helius API key. Downstream calls bill this key. */
  apiKey: string;
  /** Helius project the key belongs to, when the transport can resolve it. */
  projectId?: string;
  network: 'mainnet-beta' | 'devnet';
  /**
   * Opaque, stable per caller — not per request.
   *
   * It buckets `expandResult` handles. Per-request would break expansion
   * immediately, since a handle is issued by one request and redeemed by the
   * next; per-caller means a handle survives exactly as long as the caller does
   * and is invisible to everyone else.
   *
   * Note this duplicates a responsibility `RouterContext` currently holds:
   * `getRouterContext()` takes no argument and hands `dispatch.ts` a
   * process-global session key. Nothing bridges the two yet, and nothing can
   * until call sites start passing a context. The migration that converts them
   * is where `getRouterContext` learns to derive from this field; until then
   * this is the declared intent and `RouterContext` is the live implementation.
   */
  sessionKey: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Stable, non-reversible bucket id, so the raw key is not also a map key. */
function deriveSessionKey(apiKey: string, projectId?: string): string {
  return createHash('sha256')
    .update(`${projectId ?? ''}:${apiKey}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Build a context from the SDK's per-request `extra`, or `null` when the request
 * carries no identity.
 *
 * `null` is the stdio case and is not an error: callers fall back to the module
 * state that has always answered for them. A hosted entrypoint is expected to
 * reject an unidentified request before dispatch ever reaches here.
 */
export function contextFromExtra(extra: unknown): RequestContext | null {
  if (!isRecord(extra)) {
    return null;
  }

  const authInfo = extra.authInfo;
  if (!isRecord(authInfo)) {
    return null;
  }

  const apiKey = typeof authInfo.token === 'string' ? authInfo.token : '';
  if (!apiKey) {
    return null;
  }

  // Both of ours live under `extra`, which the SDK documents as the home for
  // additional token data. Deliberately not `clientId`: that identifies the
  // OAuth client application, and a Helius project is not one — under any
  // registration model it would end up holding something else.
  const authExtra = isRecord(authInfo.extra) ? authInfo.extra : undefined;

  const rawProjectId = authExtra?.projectId;
  const projectId = typeof rawProjectId === 'string' && rawProjectId ? rawProjectId : undefined;

  const network = authExtra?.network === 'devnet' ? 'devnet' : 'mainnet-beta';

  return {
    apiKey,
    projectId,
    network,
    sessionKey: deriveSessionKey(apiKey, projectId),
  };
}
