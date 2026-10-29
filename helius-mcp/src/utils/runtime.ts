import { AsyncLocalStorage } from 'node:async_hooks';
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

/**
 * Which actions a server exposes; `router/surface.ts` derives each surface from
 * the action catalog. The type lives here so `utils/` can read the current
 * surface without importing from `router/`.
 */
export type Surface = 'full' | 'readOnly';

const surfaceStorage = new AsyncLocalStorage<Surface>();

/**
 * Run an action handler on behalf of a surface. Dispatch wraps every handler
 * call in this, so guidance written deep in the tool layer can tell whether the
 * actions it would point to exist on the server answering. Scoped per call
 * rather than per process, so one process can serve both surfaces.
 */
export function runOnSurface<T>(surface: Surface, fn: () => T): T {
  return surfaceStorage.run(surface, fn);
}

/** The surface the current handler call serves. `full` outside dispatch. */
export function getCurrentSurface(): Surface {
  return surfaceStorage.getStore() ?? 'full';
}

export function isReadOnlySurface(): boolean {
  return getCurrentSurface() === 'readOnly';
}

/**
 * Setup guidance for the read-only surface, which can neither set a key, sign
 * up, nor pay. Messages that would send the model to `setHeliusApiKey`,
 * `signup`, or `upgradePlan` on the full surface use these instead.
 */
export const READ_ONLY_GUIDANCE = {
  apiKey: 'Set `HELIUS_API_KEY` in this MCP server\'s environment and restart it. Get a key at https://dashboard.helius.dev/api-keys.',
  account: 'Create an account at https://dashboard.helius.dev, then set its API key as `HELIUS_API_KEY` in this MCP server\'s environment.',
  project: 'Create a project at https://dashboard.helius.dev.',
  session: 'Run `npx helius-cli@latest login` in a terminal to sign in with your dashboard.helius.dev account; this server picks up the session automatically.',
  accountChanges: 'This server is read-only. For upgrades and other account changes, use https://dashboard.helius.dev or the full Helius MCP (`npx helius-mcp@latest`).',
} as const;
