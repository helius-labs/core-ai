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
  /**
   * Absent when the request did not state one. That is not the same as
   * mainnet: a self-hosted server with `HELIUS_NETWORK=devnet` and a middleware
   * that sets a token but no network must keep answering on devnet, so the
   * resolver falls through to env and session rather than defaulting here.
   */
  network?: 'mainnet-beta' | 'devnet';
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

  // `extra.apiKey` first: `token` is the transport credential, and reading it
  // as the Helius key couples the two. Once a hosted entrypoint fronts this
  // with real OAuth, every access token would be appended as `?api-key=` to a
  // Helius host. `token` stays as a fallback for a transport that authenticates
  // with the Helius key itself, which is the shape we expect first.
  const rawExtra = isRecord(authInfo.extra) ? authInfo.extra : undefined;
  const fromExtra = typeof rawExtra?.apiKey === 'string' ? rawExtra.apiKey : '';
  const apiKey = fromExtra || (typeof authInfo.token === 'string' ? authInfo.token : '');
  if (!apiKey) {
    return null;
  }

  // Both of ours live under `extra`, which the SDK documents as the home for
  // additional token data. Deliberately not `clientId`: that identifies the
  // OAuth client application, and a Helius project is not one.
  const authExtra = isRecord(authInfo.extra) ? authInfo.extra : undefined;

  const rawProjectId = authExtra?.projectId;
  const projectId = typeof rawProjectId === 'string' && rawProjectId ? rawProjectId : undefined;

  // Unknown values are refused rather than coerced. `'Devnet'` or `'testnet'`
  // silently routing a caller's writes to mainnet is not a safe default.
  const rawNetwork = authExtra?.network;
  let network: 'mainnet-beta' | 'devnet' | undefined;
  if (rawNetwork !== undefined) {
    if (rawNetwork !== 'devnet' && rawNetwork !== 'mainnet-beta') {
      throw new Error(
        `INVALID_NETWORK: request declared network "${String(rawNetwork)}"; `
        + 'expected "mainnet-beta" or "devnet".',
      );
    }
    network = rawNetwork;
  }

  return {
    apiKey,
    projectId,
    network,
    sessionKey: deriveSessionKey(apiKey, projectId),
  };
}
