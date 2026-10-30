import { z } from 'zod';
import { makeParsedStreamsClient } from 'helius-sdk/websockets/parsedStreams';
import type { ActionRegistry } from '../router/action-registry.js';
import { getApiKey, hasApiKey } from '../utils/helius.js';
import { noApiKeyResponse } from './shared.js';
import { mcpText, handleToolError } from '../utils/errors.js';
import { contextFromExtra } from '../utils/request-context.js';

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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
}
