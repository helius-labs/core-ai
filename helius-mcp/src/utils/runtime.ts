import type { ErrorMeta } from './errors.js';

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

/**
 * Refusal for capabilities that need a wallet or mutate process-global config.
 * Shared between the tool layer and the signer helpers so a caller gets the same
 * explanation wherever they hit the boundary.
 */
export const SHARED_CREDENTIAL_META: ErrorMeta = {
  type: 'UNSUPPORTED',
  code: 'SHARED_CREDENTIAL',
  retryable: false,
  recovery: 'Run the Helius MCP locally (`npx helius-mcp@latest`) for wallet and account operations.',
};

export function sharedCredentialRefusal(capability: string): string {
  return `${capability} is unavailable on this server. It serves many callers from one `
    + 'deployment-managed credential and holds no wallet, so it cannot generate keys, sign '
    + 'transactions, or provision accounts. Run the Helius MCP locally for those: '
    + '`npx helius-mcp@latest`.';
}
