import { getNetwork } from '../utils/helius.js';
import { mcpError, mcpText, warnAddressConflicts, warnInvalidAddresses } from '../utils/errors.js';
import type { RequestContext } from '../utils/request-context.js';

/**
 * Shared pieces of the Gatekeeper subscription config generators
 * (`parsedTransactionSubscribe`, `preconfSubscribe`, `preprocessedSubscribe`).
 * They validate a filter and print a ready-to-run subscription; none of them
 * opens a connection.
 */

/** Reject a list longer than the server accepts, before the user hits `-32000`/`-32602`. */
export function limitError(title: string, field: string, count: number, max: number) {
  return mcpError(`**${title}**\n\n\`${field}\` has ${count} entries; the maximum is ${max.toLocaleString()}.`, {
    type: 'VALIDATION',
    code: 'FILTER_LIMIT',
    retryable: false,
    recovery: `Pass ${max.toLocaleString()} or fewer entries in \`${field}\`, or split the filter across subscriptions.`,
  });
}

/** Address-format warnings for each list, plus overlap between an include and exclude list. */
export function addressWarnings(
  lists: Array<[string, string[] | undefined]>,
  conflicts: Array<[string, string]> = [],
): string[] {
  const byName = new Map(lists);
  const warnings: string[] = [];
  for (const [name, addresses] of lists) {
    if (!addresses) continue;
    if (addresses.length === 0) {
      warnings.push(`\`${name}\` is an empty array, so it has no effect.`);
    } else {
      warnings.push(...warnInvalidAddresses(name, addresses));
    }
  }
  for (const [include, exclude] of conflicts) {
    const conflict = warnAddressConflicts(include, byName.get(include), exclude, byName.get(exclude));
    if (conflict) warnings.push(conflict);
  }
  return warnings;
}

/** Gatekeeper serves mainnet only; say so when the session is on devnet. */
export function devnetWarning(ctx: RequestContext | null): string[] {
  return getNetwork(ctx) === 'devnet'
    ? ['The session is on devnet, but this stream is served by Gatekeeper (`wss://beta.helius-rpc.com`), which the docs list for mainnet only. The config below streams mainnet.']
    : [];
}

export function renderStreamConfig(config: {
  title: string;
  url: string;
  warnings: string[];
  request: unknown;
  code: string;
  notes: string[];
}) {
  const lines = [`**${config.title}**`, '', `**URL:** \`${config.url}\``, ''];
  if (config.warnings.length > 0) {
    lines.push('**Warnings:**', ...config.warnings.map((w) => `- ${w}`), '');
  }
  lines.push(
    '**Subscription Request:**',
    '```json',
    JSON.stringify(config.request, null, 2),
    '```',
    '',
    '**Example Code:**',
    '```typescript',
    config.code,
    '```',
    '',
    '**Notes:**',
    ...config.notes.map((n) => `- ${n}`),
  );
  return mcpText(lines.join('\n'));
}

/** A JS literal for generated code: JSON, indented to sit inside a call. */
export function codeLiteral(value: unknown, indent: number): string {
  return JSON.stringify(value, null, 2).split('\n').join(`\n${' '.repeat(indent)}`);
}
