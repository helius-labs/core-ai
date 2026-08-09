import { isSharedCredentialMode } from './runtime.js';

/**
 * Last-resort scrubber for outbound tool text.
 *
 * Tools are expected not to emit the API key in the first place; this exists to
 * catch the paths nobody audited — an upstream error message that echoes a
 * request URL, a doc snippet with a key in an example, a future tool that
 * formats an endpoint. It only runs in shared-credential mode, so the
 * single-tenant stdio build keeps printing the user's own key where that is the
 * point of the tool.
 */

const REDACTED = '***REDACTED***';

/** Matches `api-key=<value>` in a query string, however the URL is delimited. */
const API_KEY_QUERY_RE = /([?&]api-key=)[^&\s'"`)\]}<]+/gi;

const secrets = new Set<string>();

/**
 * Register a credential to scrub from output. Called wherever a key is
 * resolved, so the registry covers session, env, and on-disk sources without
 * each caller having to know which one won.
 */
export function registerSecret(value: string | null | undefined): void {
  // Short values would match far too much text; a real Helius key is a UUID.
  if (value && value.length >= 8) {
    secrets.add(value);
  }
}

export function clearRegisteredSecrets(): void {
  secrets.clear();
}

export function redactSecrets(text: string): string {
  if (!isSharedCredentialMode()) {
    return text;
  }

  let out = text.replace(API_KEY_QUERY_RE, `$1${REDACTED}`);
  for (const secret of secrets) {
    // split/join rather than RegExp so key contents need no escaping.
    out = out.split(secret).join(REDACTED);
  }
  return out;
}
