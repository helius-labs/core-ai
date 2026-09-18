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
   */
  sessionKey: string;
};

/**
 * The `AuthInfo` shape the MCP SDK surfaces on `extra.authInfo`, narrowed to the
 * fields we populate. Declared structurally rather than imported so this module
 * stays free of SDK types.
 */
type AuthInfoLike = {
  token?: unknown;
  clientId?: unknown;
  extra?: unknown;
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

  const authInfo = extra.authInfo as AuthInfoLike | undefined;
  if (!isRecord(authInfo)) {
    return null;
  }

  const apiKey = typeof authInfo.token === 'string' ? authInfo.token : '';
  if (!apiKey) {
    return null;
  }

  const projectId = typeof authInfo.clientId === 'string' && authInfo.clientId
    ? authInfo.clientId
    : undefined;

  const rawNetwork = isRecord(authInfo.extra) ? authInfo.extra.network : undefined;
  const network = rawNetwork === 'devnet' ? 'devnet' : 'mainnet-beta';

  return {
    apiKey,
    projectId,
    network,
    sessionKey: deriveSessionKey(apiKey, projectId),
  };
}
