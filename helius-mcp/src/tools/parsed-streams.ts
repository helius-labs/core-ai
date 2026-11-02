import { z } from 'zod';
import { makeParsedStreamsClient } from 'helius-sdk/websockets/parsedStreams';
import type { ActionRegistry } from '../router/action-registry.js';
import { getApiKey, getGatekeeperWebSocketUrl, hasApiKey } from '../utils/helius.js';
import { noApiKeyResponse } from './shared.js';
import { mcpError, mcpText, handleToolError } from '../utils/errors.js';
import { contextFromExtra } from '../utils/request-context.js';
import { addressWarnings, codeLiteral, devnetWarning, limitError, renderStreamConfig } from './stream-config.js';

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Per-filter limits from the Parsed Streams reference. */
const LIMITS = { programs: 10, instructionNames: 50, accountInclude: 100, accountRoles: 20, nameLength: 64 };

const SUBSCRIBE_TITLE = 'Parsed Streams - Transaction Subscribe';

/** The loop body for each `details` level: `raw` has no decoded names, only program and data. */
function notificationLoop(details: 'full' | 'matched' | 'raw'): string {
  switch (details) {
    case 'full':
      return [
        'for await (const { context, value } of sub) {',
        '  for (const i of value.matchedIndexes ?? []) {',
        '    const ix = value.instructions[i];',
        '    console.log(context.slot, value.transaction.signature, ix.instructionName, ix.summary?.description ?? ix.decoded?.args);',
        '  }',
        '}',
      ].join('\n');
    case 'matched':
      return [
        'for await (const { context, value } of sub) {',
        '  for (const ix of value.instructions) {',
        '    console.log(context.slot, value.transaction.signature, ix.instructionName, ix.summary?.description ?? ix.decoded?.args);',
        '  }',
        '}',
      ].join('\n');
    case 'raw':
      return [
        'for await (const { context, value } of sub) {',
        '  for (const ix of value.instructions) {',
        '    console.log(context.slot, value.transaction.signature, ix.programId, ix.data); // base58 instruction data',
        '  }',
        '}',
      ].join('\n');
  }
}

function list(label: string, names: string[], field?: string): string[] {
  if (names.length === 0) return [`**${label}:** none decoded`];
  const use = field ? ` — use in \`${field}\`` : '';
  return [`**${label} (${names.length})**${use}:`, names.map((n) => `\`${n}\``).join(', ')];
}

export function registerParsedStreamsTools(registry: ActionRegistry) {
  registry.registerAction(
    'describeProgram',
    'BEST FOR: building Parsed Streams or Parsed Events filters that actually match. Lists a program\'s decoded instruction names, event names, and account role names exactly as the matcher compares them, for any of the 3,600+ programs in the catalog. Pass a program address (preferred; names can be ambiguous across versions) or a catalog name. Read-only discovery: it does not subscribe to anything.',
    {
      program: z.string().describe('Program address (base58, preferred) or catalog name such as "jupiter".'),
    },
    async ({ program }, extra) => {
      const ctx = contextFromExtra(extra);
      if (!hasApiKey(ctx)) return noApiKeyResponse();

      // One short-lived discovery connection per call; nothing is subscribed.
      const client = makeParsedStreamsClient(getApiKey(ctx));
      try {
        const described = await client.describeProgram(program);
        const lines = [
          `**${described.name}** \`${described.id}\``,
          '',
          ...list('Instructions', described.instructions, 'instructionNames'),
          '',
          ...list('Account roles', described.roles, 'accounts.roles'),
          '',
          ...list('Events', described.events),
        ];
        if (!BASE58_ADDRESS.test(program)) {
          lines.push('', `_Looked up by name: check that \`${described.id}\` is the program you mean before subscribing._`);
        }
        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Describe Program Error');
      } finally {
        client.close();
      }
    },
  );

  registry.registerAction(
    'parsedTransactionSubscribe',
    'BEST FOR: streaming decoded transactions for specific programs or accounts, filtered server-side by program, instruction name, and account role. Successor to Enhanced Transaction webhooks for parsed real-time pipelines. Returns a validated `parsedTransactionSubscribe` request for the Gatekeeper WebSocket and helius-sdk code that subscribes and reconnects; does not open a connection itself. Take instruction and role names from `describeProgram`: a guessed name is valid but matches nothing. All plans. Cost: 1 credit per delivered event.',
    {
      programs: z.array(z.string()).optional().describe('Program IDs to match (base58 addresses, not names). OR within the list. Up to 10. At least one of programs or accountInclude is required.'),
      instructionNames: z.array(z.string()).optional().describe('Decoded instruction names from describeProgram, such as "route". OR within the list. Up to 50.'),
      accountInclude: z.array(z.string()).optional().describe('Accounts (base58) an instruction must touch, any of them. Sent as accounts.include. Up to 100.'),
      accountRoles: z.record(z.string(), z.string()).optional().describe('Decoded account role name to address, all must hold, e.g. { "user_transfer_authority": "<pubkey>" }. Sent as accounts.roles. Names match exactly; take them from describeProgram. Up to 20.'),
      includeFailed: z.boolean().optional().describe('Include instructions from failed transactions (default false).'),
      includeCpi: z.boolean().optional().describe('Let inner (CPI) instructions match (default true). Set false for top-level instructions only.'),
      notificationDetails: z.enum(['full', 'matched', 'raw']).optional().default('full').describe('What each notification carries, sent as `details`: "full" (default) the whole decoded transaction plus matchedIndexes, "matched" only the matching instructions (about a third of the size), "raw" matching instructions as program ID and base58 data only.'),
    },
    async (params, extra) => {
      const ctx = contextFromExtra(extra);
      if (!hasApiKey(ctx)) return noApiKeyResponse();

      if (!params.programs?.length && !params.accountInclude?.length) {
        return mcpError(`**${SUBSCRIBE_TITLE}**\n\nAt least one of \`programs\` or \`accountInclude\` is required: Parsed Streams has no unfiltered stream.`, {
          type: 'VALIDATION',
          code: 'MISSING_FILTER',
          retryable: false,
          recovery: 'Pass `programs` (program IDs) or `accountInclude` (addresses). Use describeProgram to find instruction and role names for a program.',
        });
      }

      const roles = Object.entries(params.accountRoles ?? {});
      const counts: Array<[string, number, number]> = [
        ['programs', params.programs?.length ?? 0, LIMITS.programs],
        ['instructionNames', params.instructionNames?.length ?? 0, LIMITS.instructionNames],
        ['accountInclude', params.accountInclude?.length ?? 0, LIMITS.accountInclude],
        ['accountRoles', roles.length, LIMITS.accountRoles],
      ];
      for (const [field, count, max] of counts) {
        if (count > max) return limitError(SUBSCRIBE_TITLE, field, count, max);
      }

      const warnings = [
        ...devnetWarning(ctx),
        ...addressWarnings([
          ['programs', params.programs],
          ['accountInclude', params.accountInclude],
          ['accountRoles values', roles.length ? roles.map(([, address]) => address) : undefined],
        ]),
      ];
      const tooLong = [...(params.instructionNames ?? []), ...roles.map(([name]) => name)]
        .filter((name) => name.length > LIMITS.nameLength);
      if (tooLong.length > 0) {
        warnings.push(`Instruction and role names are at most ${LIMITS.nameLength} characters; the server rejects: ${tooLong.map((n) => `\`${n.slice(0, 20)}…\``).join(', ')}.`);
      }
      const checksNames = (params.instructionNames?.length ?? 0) > 0 || roles.length > 0;
      if (checksNames) {
        warnings.push('Instruction and role names must match the catalog exactly, or the filter is valid but matches nothing. The code below checks them with describeProgram before subscribing.');
      }

      const filter: Record<string, unknown> = {};
      if (params.programs?.length) filter.programs = params.programs;
      if (params.instructionNames?.length) filter.instructionNames = params.instructionNames;
      if (params.accountInclude?.length || roles.length) {
        filter.accounts = {
          ...(params.accountInclude?.length ? { include: params.accountInclude } : {}),
          ...(roles.length ? { roles: Object.fromEntries(roles) } : {}),
        };
      }
      if (params.includeFailed !== undefined) filter.includeFailed = params.includeFailed;
      if (params.includeCpi !== undefined) filter.includeCpi = params.includeCpi;
      const options = { commitment: 'confirmed', details: params.notificationDetails };

      const check = checksNames && params.programs?.length
        ? [
          '',
          '// A guessed name is valid but matches nothing: check names against the catalog first',
          `const described = await Promise.all(${JSON.stringify(params.programs)}.map((p) => streams.describeProgram(p)));`,
          ...(params.instructionNames?.length ? [
            `const unknownNames = ${JSON.stringify(params.instructionNames)}.filter((n) => !described.some((d) => d.instructions.includes(n)));`,
            'if (unknownNames.length) throw new Error(`Unknown instruction names: ${unknownNames.join(", ")}`);',
          ] : []),
          ...(roles.length ? [
            `const unknownRoles = ${JSON.stringify(roles.map(([name]) => name))}.filter((r) => !described.some((d) => d.roles.includes(r)));`,
            'if (unknownRoles.length) throw new Error(`Unknown account roles: ${unknownRoles.join(", ")}`);',
          ] : []),
        ]
        : [];

      const code = [
        'import { makeParsedStreamsClient } from "helius-sdk/websockets/parsedStreams";',
        '',
        '// Reconnects and resubscribes on its own; lastSlot bounds the gap to backfill from RPC',
        'const streams = makeParsedStreamsClient(process.env.HELIUS_API_KEY!, {',
        '  onReconnect: ({ closeCode, lastSlot }) =>',
        '    console.warn(`Reconnected after close ${closeCode}; backfill after slot ${lastSlot}`),',
        '});',
        ...check,
        '',
        `const sub = await streams.parsedTransactionSubscribe(${codeLiteral(filter, 0)}, { details: "${params.notificationDetails}" });`,
        '',
        notificationLoop(params.notificationDetails),
      ].join('\n');

      return renderStreamConfig({
        title: SUBSCRIBE_TITLE,
        url: getGatekeeperWebSocketUrl(ctx),
        warnings,
        request: { jsonrpc: '2.0', id: 1, method: 'parsedTransactionSubscribe', params: [filter, options] },
        code,
        notes: [
          'Needs helius-sdk 3.3.0 or later. On Node 20, pass `WebSocket` from the `ws` package: `makeParsedStreamsClient(apiKey, { WebSocket })`.',
          'Up to 25 subscriptions per connection. Concurrent connections per project: 5 (Free), 10 (Developer), 50 (Business and Professional).',
          'The server closes a connection after 10 minutes without a match, and on deploys; the client reconnects, and `onReconnect` reports the last delivered slot.',
          'Unknown filter fields are rejected with `-32602` rather than ignored.',
          'Cost: 1 credit per delivered event.',
        ],
      });
    },
  );
}
