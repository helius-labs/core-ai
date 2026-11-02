import { z } from 'zod';
import type { ActionRegistry } from '../router/action-registry.js';
import { getGatekeeperWebSocketUrl, hasApiKey } from '../utils/helius.js';
import { noApiKeyResponse } from './shared.js';
import { mcpError } from '../utils/errors.js';
import { contextFromExtra } from '../utils/request-context.js';
import { addressWarnings, codeLiteral, devnetWarning, limitError, renderStreamConfig } from './stream-config.js';

/** Each account list accepts up to 5,000 addresses. */
const MAX_ADDRESSES = 5_000;

const SUBSCRIBE_TITLE = 'Preprocessed Transactions - preprocessedSubscribe';

export function registerPreprocessedTools(registry: ActionRegistry) {
  registry.registerAction(
    'preprocessedSubscribe',
    'BEST FOR: seeing signed transactions before execution, with broad network coverage, for trading and mempool-style monitoring. Returns a validated `preprocessedSubscribe` request for the Gatekeeper WebSocket and code that subscribes, decodes the binary notifications, and reconnects; does not open a connection itself. Filters by accounts (lookup tables resolved server-side). Best-effort and pre-execution: no status, logs, or balances. Successor to the preprocessed LaserStream gRPC feed. Public beta, paid plans (Developer and up). Cost: 0.1 credits per message.',
    {
      accountInclude: z.array(z.string()).optional().describe('Accounts (base58), any of which the transaction must reference. Up to 5,000. accountInclude and accountRequired need at least one account between them.'),
      accountExclude: z.array(z.string()).optional().describe('Drop transactions that reference any of these accounts. Up to 5,000.'),
      accountRequired: z.array(z.string()).optional().describe('Accounts the transaction must reference, all of them. Up to 5,000.'),
    },
    async (params, extra) => {
      const ctx = contextFromExtra(extra);
      if (!hasApiKey(ctx)) return noApiKeyResponse();

      if (!params.accountInclude?.length && !params.accountRequired?.length) {
        return mcpError(`**${SUBSCRIBE_TITLE}**\n\n\`accountInclude\` and \`accountRequired\` must name at least one account between them: there is no unfiltered stream.`, {
          type: 'VALIDATION',
          code: 'MISSING_FILTER',
          retryable: false,
          recovery: 'Pass the accounts (or program IDs) to watch in `accountInclude`, or accounts every transaction must touch in `accountRequired`.',
        });
      }

      const lists: Array<[string, string[] | undefined]> = [
        ['accountInclude', params.accountInclude],
        ['accountExclude', params.accountExclude],
        ['accountRequired', params.accountRequired],
      ];
      for (const [field, list] of lists) {
        if ((list?.length ?? 0) > MAX_ADDRESSES) return limitError(SUBSCRIBE_TITLE, field, list!.length, MAX_ADDRESSES);
      }

      // The reference sends all three lists, empty when unused.
      const filter = {
        accountInclude: params.accountInclude ?? [],
        accountExclude: params.accountExclude ?? [],
        accountRequired: params.accountRequired ?? [],
      };

      const code = [
        'import WebSocket from "ws";',
        'import { getBase58Decoder } from "@solana/kit";',
        '',
        'const URL = `wss://beta.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;',
        'const base58 = getBase58Decoder();',
        '',
        '// Delivery is best-effort with no replay: reconnect, resubscribe, and dedupe by signature',
        'function connect() {',
        '  const ws = new WebSocket(URL);',
        '  let ping: NodeJS.Timeout | undefined;',
        '  ws.on("open", () => {',
        '    ws.send(JSON.stringify({',
        '      jsonrpc: "2.0",',
        '      id: 1,',
        '      method: "preprocessedSubscribe",',
        `      params: ${codeLiteral(filter, 6)},`,
        '    }));',
        '    ping = setInterval(() => ws.ping(), 30_000);',
        '  });',
        '  ws.on("message", (data, isBinary) => {',
        '    const buf = data as Buffer; // ws delivers a Buffer by default (binaryType "nodebuffer")',
        '    if (!isBinary) {',
        '      console.log("ack", buf.toString()); // { result: <subscription id> } or an error',
        '      return;',
        '    }',
        '    // version (u8) | slot (u64 LE) | first signature (64 bytes) | transaction (Solana wire format)',
        '    if (buf.readUInt8(0) !== 1) return; // unknown schema version: update the decoder',
        '    const slot = buf.readBigUInt64LE(1);',
        '    const signature = base58.decode(buf.subarray(9, 73));',
        '    const transaction = buf.subarray(73); // legacy, v0, or v1: decode with @solana/kit 8+',
        '    console.log(slot, signature, transaction.length);',
        '  });',
        '  ws.on("error", console.error);',
        '  ws.on("close", () => {',
        '    clearInterval(ping);',
        '    setTimeout(connect, 1_000);',
        '  });',
        '}',
        '',
        'connect();',
      ].join('\n');

      return renderStreamConfig({
        title: SUBSCRIBE_TITLE,
        url: getGatekeeperWebSocketUrl(ctx),
        warnings: [
          ...devnetWarning(ctx),
          ...addressWarnings(lists, [['accountInclude', 'accountExclude']]),
        ],
        request: { jsonrpc: '2.0', id: 1, method: 'preprocessedSubscribe', params: filter },
        code,
        notes: [
          'Public beta. Paid plans only (Developer and up). No helius-sdk helper yet, so the code uses `ws` directly.',
          'Pre-execution and best-effort: no execution status, logs, balances, or compute units, and a transaction can still fail, be dropped, or land on another fork. Reconcile against a processed or confirmed stream when results matter.',
          'Up to 10 concurrent connections or subscriptions per API key.',
          'The server closes the connection if more than 4,000 messages back up, so keep decoding and strategy work off the receive loop.',
          'Transactions are forwarded as observed, including v1. Older decoders (`VersionedTransaction.deserialize`) only handle legacy and v0.',
          'Cost: 0.1 credits per message (one per delivered transaction).',
        ],
      });
    },
  );
}
