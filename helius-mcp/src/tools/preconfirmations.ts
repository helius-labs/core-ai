import { z } from 'zod';
import type { ActionRegistry } from '../router/action-registry.js';
import { GATEKEEPER_RPC_URL, getGatekeeperWebSocketUrl, hasApiKey, rpcRequest } from '../utils/helius.js';
import { noApiKeyResponse } from './shared.js';
import { mcpError, mcpText, handleToolError } from '../utils/errors.js';
import { contextFromExtra } from '../utils/request-context.js';
import { addressWarnings, codeLiteral, devnetWarning, limitError, renderStreamConfig } from './stream-config.js';

/** Region codes from the preconfSubscribe reference. */
const PRECONF_REGIONS = ['slc', 'fra', 'lon', 'pit', 'sgp', 'ewr', 'iad', 'hkg', 'tyo', 'ams', 'dal', 'dub', 'mia', 'lax', 'sea', 'sqq'];

/** Per-filter caps from the preconfSubscribe reference. */
const LIMITS = { addresses: 10_000, signatures: 1_000, instructions: 16 };

const SUBSCRIBE_TITLE = 'Preconfirmations - preconfSubscribe';

type PreConfCoverage = { networkSharePercent: number; coverageByRegion: Record<string, number> };

export function registerPreconfirmationTools(registry: ActionRegistry) {
  registry.registerAction(
    'getPreConfCoverage',
    'BEST FOR: deciding whether Preconfirmations will see enough of the network for a use case. Returns the share of mainnet stake that Preconfirmations covers (Helius and Jito BAM combined) and how that covered stake splits across regions, for choosing a subscription region. Coverage is by stake, not by share of transactions delivered.',
    {},
    async (_args, extra) => {
      const ctx = contextFromExtra(extra);
      if (!hasApiKey(ctx)) return noApiKeyResponse();

      let coverage: PreConfCoverage;
      try {
        // Gatekeeper serves mainnet only, so this is mainnet coverage on any network setting.
        coverage = await rpcRequest<PreConfCoverage>('getPreConfCoverage', undefined, ctx, GATEKEEPER_RPC_URL);
      } catch (err) {
        return handleToolError(err, 'Preconfirmations Coverage Error');
      }

      const regions = Object.entries(coverage.coverageByRegion ?? {}).sort(([, a], [, b]) => b - a);
      const lines = [
        '**Preconfirmations Coverage (mainnet)**',
        '',
        `**Network stake covered:** ${coverage.networkSharePercent}%`,
      ];
      if (regions.length > 0) {
        lines.push('', '**Covered stake by region:**');
        for (const [region, share] of regions) {
          lines.push(`- \`${region}\`: ${(share * 100).toFixed(0)}%`);
        }
      }
      lines.push('', '_Coverage is measured by stake. It does not guarantee a continuous stream or a share of transactions delivered._');
      return mcpText(lines.join('\n'));
    },
  );

  registry.registerAction(
    'preconfSubscribe',
    'BEST FOR: latency-critical trading that needs the earliest transaction signal, before shredding. Returns a validated `preconfSubscribe` request for the Gatekeeper WebSocket and helius-sdk code that subscribes and decodes the binary notifications; does not open a connection itself. Filter by source (Helius, with execution status, or Jito BAM), status, region, accounts, signers, signatures, and instruction data. A preconfirmation is an early signal, not a guarantee, and the stream has gaps: check getPreConfCoverage. Paid plans (Developer and up). Cost: each open subscription pays the greater of 300 credits or 10 credits per message in every slot that delivers a message.',
    {
      includeSource: z.array(z.enum(['helius', 'bam'])).optional().describe('Sources to receive: "helius" (carries execution status) and/or "bam" (Jito BAM, status unknown). Omit for both.'),
      failed: z.boolean().optional().describe('true: only failed transactions. false: only successful ones. Omit for every status.'),
      regionInclude: z.array(z.string()).optional().describe(`Regions a transaction must originate from: ${PRECONF_REGIONS.join(', ')}. Transactions without region information are dropped when set.`),
      accountInclude: z.array(z.string()).optional().describe('Accounts (base58), any of which the transaction must reference, including through lookup tables. Up to 10,000.'),
      accountExclude: z.array(z.string()).optional().describe('Drop transactions that reference any of these accounts. Wins over accountInclude. Up to 10,000.'),
      accountRequired: z.array(z.string()).optional().describe('Accounts the transaction must reference, all of them. Up to 10,000.'),
      signerInclude: z.array(z.string()).optional().describe('Signers (base58), at least one of which must sign. Up to 10,000.'),
      signerExclude: z.array(z.string()).optional().describe('Drop transactions signed by any of these. Wins over signerInclude. Up to 10,000.'),
      signatures: z.array(z.string()).optional().describe('First signatures (base58) to match. Up to 1,000.'),
      instructions: z.array(z.object({
        programId: z.string(),
        memcmp: z.array(z.object({
          offset: z.number().int().nonnegative(),
          bytes: z.string(),
          encoding: z.enum(['base58', 'base64', 'hex']).optional(),
        })).max(4).optional(),
        dataSize: z.number().int().positive().max(4096).optional(),
      })).optional().describe('Top-level instruction filters, any of which must match: { programId, memcmp?: [{ offset, bytes, encoding? }] (up to 4, all must match), dataSize? }. Up to 16. CPI instructions are not matched.'),
      slots: z.boolean().optional().describe('Also deliver slot events (leader bank created and frozen). helius-sdk option, applied client-side.'),
    },
    async (params, extra) => {
      const ctx = contextFromExtra(extra);
      if (!hasApiKey(ctx)) return noApiKeyResponse();

      const unknownRegions = (params.regionInclude ?? []).filter((r) => !PRECONF_REGIONS.includes(r));
      if (unknownRegions.length > 0) {
        return mcpError(`**${SUBSCRIBE_TITLE}**\n\nUnknown region code(s): ${unknownRegions.map((r) => `\`${r}\``).join(', ')}. Valid codes: ${PRECONF_REGIONS.join(', ')}.`, {
          type: 'VALIDATION',
          code: 'INVALID_REGION',
          retryable: false,
          recovery: `Use region codes from: ${PRECONF_REGIONS.join(', ')}.`,
        });
      }

      const addressLists: Array<[string, string[] | undefined]> = [
        ['accountInclude', params.accountInclude],
        ['accountExclude', params.accountExclude],
        ['accountRequired', params.accountRequired],
        ['signerInclude', params.signerInclude],
        ['signerExclude', params.signerExclude],
      ];
      for (const [field, list] of addressLists) {
        if ((list?.length ?? 0) > LIMITS.addresses) return limitError(SUBSCRIBE_TITLE, field, list!.length, LIMITS.addresses);
      }
      if ((params.signatures?.length ?? 0) > LIMITS.signatures) {
        return limitError(SUBSCRIBE_TITLE, 'signatures', params.signatures!.length, LIMITS.signatures);
      }
      if ((params.instructions?.length ?? 0) > LIMITS.instructions) {
        return limitError(SUBSCRIBE_TITLE, 'instructions', params.instructions!.length, LIMITS.instructions);
      }

      const filter: Record<string, unknown> = {};
      if (params.includeSource?.length) filter.includeSource = params.includeSource;
      if (params.failed !== undefined) filter.failed = params.failed;
      if (params.regionInclude?.length) filter.regionInclude = params.regionInclude;
      for (const [field, list] of addressLists) {
        if (list?.length) filter[field] = list;
      }
      if (params.signatures?.length) filter.signatures = params.signatures;
      if (params.instructions?.length) filter.instructions = params.instructions;
      const unfiltered = Object.keys(filter).length === 0;

      const warnings = [
        ...devnetWarning(ctx),
        ...addressWarnings(
          [...addressLists, ['instructions programId', params.instructions?.map((ix) => ix.programId)]],
          [['accountInclude', 'accountExclude'], ['signerInclude', 'signerExclude']],
        ),
      ];
      if (unfiltered) {
        warnings.push('No filter: this streams every transaction from Helius and BAM, and the subscription pays the 300-credit minimum in every slot that delivers one. Filter by account, signer, or instruction to cut volume.');
      }
      if (params.regionInclude?.length) {
        warnings.push('`regionInclude` drops transactions that carry no region information.');
      }

      const usesNewFeatures = Boolean(params.includeSource?.length) || params.slots === true;
      const subscribeArgs = [
        unfiltered ? (params.slots ? 'undefined' : '') : codeLiteral(filter, 0),
        params.slots ? '{ slots: true }' : '',
      ].filter(Boolean).join(', ');

      const code = [
        'import { getSignatureFromTransaction } from "@solana/kit";',
        'import { makePreconfWsClientForApiKey } from "helius-sdk/websockets/preconfWs";',
        '',
        'const client = makePreconfWsClientForApiKey(process.env.HELIUS_API_KEY!);',
        `const sub = await client.preconfSubscribe(${subscribeArgs});`,
        '',
        'try {',
        '  for await (const event of sub) {',
        ...(params.slots ? [
          '    if (event.type === "slot") {',
          '      console.log("slot", event.slot, event.status); // PreconfSlotStatus: bank created or frozen',
          '      continue;',
          '    }',
        ] : []),
        '    // status is a PreconfStatus: Failed (0), Success (1), or Unknown (2, always for BAM)',
        '    console.log(event.slot, event.status, getSignatureFromTransaction(event.transaction));',
        '  }',
        '} finally {',
        '  await sub.unsubscribe();',
        '  client.close();',
        '}',
      ].join('\n');

      return renderStreamConfig({
        title: SUBSCRIBE_TITLE,
        url: getGatekeeperWebSocketUrl(ctx),
        warnings,
        request: { jsonrpc: '2.0', id: 1, method: 'preconfSubscribe', ...(unfiltered ? {} : { params: [filter] }) },
        code,
        notes: [
          `Needs helius-sdk ${usesNewFeatures ? '3.4.0' : '3.3.0'} or later${usesNewFeatures ? ' for `includeSource` and slot events' : ' for filters'}. Notifications are binary frames; the client decodes them.`,
          'Paid plans only (Developer and up).',
          'A preconfirmation is an early signal, not a guarantee: a streamed transaction can still fail to land. Helius preconfirmations carry execution status; BAM ones report unknown.',
          'The stream has gaps: coverage follows the share of stake forwarding to Helius or running BAM. Check getPreConfCoverage, and handle slots with no messages.',
          'Cost: each open subscription pays the greater of 300 credits or 10 credits per delivered message, in every slot that delivers at least one message. Slots with no messages cost nothing.',
        ],
      });
    },
  );
}
