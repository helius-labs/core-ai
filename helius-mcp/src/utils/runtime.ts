/**
 * Deployment mode.
 *
 * The stdio build is single-tenant: the Helius API key belongs to whoever is
 * running the process, so echoing it back — e.g. in the Enhanced WebSocket URL
 * that `accountSubscribe` prints — is both expected and necessary.
 *
 * A hosted build is the opposite: one shared server-side credential serves many
 * anonymous callers, so the key must never reach tool output. Set
 * `HELIUS_MCP_SHARED_CREDENTIAL=1` on that deployment.
 */
export function isSharedCredentialMode(): boolean {
  const raw = process.env.HELIUS_MCP_SHARED_CREDENTIAL;
  return raw === '1' || raw === 'true';
}
