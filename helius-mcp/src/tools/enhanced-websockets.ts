import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getEnhancedWebSocketUrl } from '../utils/helius.js';
import { mcpText, mcpError, validateEnum, handleToolError, warnInvalidAddresses, warnInvalidAddress, warnAddressConflicts } from '../utils/errors.js';
import { fetchDoc, extractSections, truncateDoc } from '../utils/docs.js';

export function registerEnhancedWebSocketTools(server: McpServer) {

  server.tool(
    'transactionSubscribe',
    'BEST FOR: real-time transaction streaming for live UI updates (WebSocket). PREFER createWebhook for fire-and-forget server-to-server notifications. PREFER laserstreamSubscribe for lowest-latency production streaming. Get Enhanced WebSocket config for real-time Solana transaction streaming. Filter by accounts, vote/failed txns, or signatures. Up to 50,000 addresses per filter. Developer+ plans only. Returns connection config and code example. Data streaming cost: 2 credits per 0.1 MB received.',
    {
      vote: z.boolean().optional().describe('Include vote transactions'),
      failed: z.boolean().optional().describe('Include failed transactions'),
      signature: z.string().optional().describe('Transaction signature (base58 encoded, 86-88 characters) to filter to'),
      accountInclude: z.array(z.string()).optional().describe('Accounts to include (base58 encoded, up to 50,000, OR logic)'),
      accountExclude: z.array(z.string()).optional().describe('Accounts to exclude (base58 encoded)'),
      accountRequired: z.array(z.string()).optional().describe('Accounts required (base58 encoded, AND logic)'),
      commitment: z.string().optional().default('confirmed'),
      encoding: z.string().optional().default('jsonParsed'),
      transactionDetails: z.string().optional().default('full'),
      showRewards: z.boolean().optional().default(false),
      maxSupportedTransactionVersion: z.number().optional().default(0)
    },
    async (params) => {
      let err;
      err = validateEnum(params.commitment, ['processed', 'confirmed', 'finalized'], 'Transaction Subscribe Error', 'commitment');
      if (err) return err;
      err = validateEnum(params.encoding, ['base58', 'base64', 'jsonParsed'], 'Transaction Subscribe Error', 'encoding');
      if (err) return err;
      err = validateEnum(params.transactionDetails, ['full', 'signatures', 'accounts', 'none'], 'Transaction Subscribe Error', 'transactionDetails');
      if (err) return err;

      // Collect warnings for config issues that would fail at runtime
      const warnings: string[] = [];

      const addressArrays: [string, string[] | undefined][] = [
        ['accountInclude', params.accountInclude],
        ['accountExclude', params.accountExclude],
        ['accountRequired', params.accountRequired],
      ];
      for (const [name, arr] of addressArrays) {
        if (arr) {
          if (arr.length === 0) {
            warnings.push(`${name} is an empty array. This filter will have no effect.`);
          } else {
            warnings.push(...warnInvalidAddresses(name, arr));
          }
        }
      }

      const conflict = warnAddressConflicts('accountInclude', params.accountInclude, 'accountExclude', params.accountExclude);
      if (conflict) warnings.push(conflict);

      if (!params.accountInclude && !params.accountExclude && !params.accountRequired && !params.signature) {
        warnings.push('No account filters or signature specified. This will stream ALL transactions on the network, which produces very high volume. Consider adding filters to reduce traffic.');
      }

      try {
        const wsUrl = getEnhancedWebSocketUrl();

        const filter: any = {};
        if (params.vote !== undefined) filter.vote = params.vote;
        if (params.failed !== undefined) filter.failed = params.failed;
        if (params.signature) filter.signature = params.signature;
        if (params.accountInclude) filter.accountInclude = params.accountInclude;
        if (params.accountExclude) filter.accountExclude = params.accountExclude;
        if (params.accountRequired) filter.accountRequired = params.accountRequired;

        const options: any = {
          commitment: params.commitment,
          encoding: params.encoding,
          transactionDetails: params.transactionDetails,
          showRewards: params.showRewards,
          maxSupportedTransactionVersion: params.maxSupportedTransactionVersion
        };

        const subscriptionRequest = {
          jsonrpc: '2.0', id: 1,
          method: 'transactionSubscribe',
          params: [filter, options]
        };

        const lines = [
          '**Enhanced WebSocket - Transaction Subscribe**',
          '',
          `**URL:** \`${wsUrl}\``,
          '',
        ];

        if (warnings.length > 0) {
          lines.push('**Warnings:**');
          warnings.forEach(w => lines.push(`- ${w}`));
          lines.push('');
        }

        lines.push(
          '**Subscription Request:**',
          '```json',
          JSON.stringify(subscriptionRequest, null, 2),
          '```',
          '',
          '**Example Code:**',
          '```typescript',
          `const ws = new WebSocket('${wsUrl}');`,
          'ws.on("open", () => {',
          '  ws.send(JSON.stringify(' + JSON.stringify(subscriptionRequest) + '));',
          '  setInterval(() => ws.ping(), 30000);',
          '});',
          'ws.on("message", (data) => {',
          '  const msg = JSON.parse(data.toString());',
          '  if (msg.method === "transactionNotification") {',
          '    console.log("Transaction:", msg.params);',
          '  }',
          '});',
          '```',
        );

        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error');
      }
    }
  );

  server.tool(
    'accountSubscribe',
    'BEST FOR: real-time account change monitoring for live UI updates (WebSocket). PREFER createWebhook for fire-and-forget notifications on account changes. PREFER laserstreamSubscribe for lowest-latency production streaming. Get Enhanced WebSocket config for real-time Solana account monitoring. Track balance changes and data updates. Developer+ plans only. Returns connection config and code example. Data streaming cost: 2 credits per 0.1 MB received.',
    {
      account: z.string().describe('Account address (base58 encoded)'),
      encoding: z.string().optional().default('base58'),
      commitment: z.string().optional().default('finalized')
    },
    async ({ account, encoding, commitment }) => {
      let err;
      err = validateEnum(encoding, ['base58', 'base64', 'base64+zstd', 'jsonParsed'], 'Account Subscribe Error', 'encoding');
      if (err) return err;
      err = validateEnum(commitment, ['finalized', 'confirmed', 'processed'], 'Account Subscribe Error', 'commitment');
      if (err) return err;

      // Collect warnings for config issues that would fail at runtime
      const warnings: string[] = [];

      const addrWarning = warnInvalidAddress('account', account);
      if (addrWarning) warnings.push(addrWarning);

      try {
        const wsUrl = getEnhancedWebSocketUrl();

        const subscriptionRequest = {
          jsonrpc: '2.0', id: 1,
          method: 'accountSubscribe',
          params: [account, { encoding, commitment }]
        };

        const lines = [
          '**Enhanced WebSocket - Account Subscribe**',
          '',
          `**Account:** \`${account}\``,
          `**URL:** \`${wsUrl}\``,
          '',
        ];

        if (warnings.length > 0) {
          lines.push('**Warnings:**');
          warnings.forEach(w => lines.push(`- ${w}`));
          lines.push('');
        }

        lines.push(
          '**Subscription Request:**',
          '```json',
          JSON.stringify(subscriptionRequest, null, 2),
          '```',
          '',
          '**Example Code:**',
          '```typescript',
          `const ws = new WebSocket('${wsUrl}');`,
          'ws.on("open", () => {',
          '  ws.send(JSON.stringify(' + JSON.stringify(subscriptionRequest) + '));',
          '  setInterval(() => ws.ping(), 30000);',
          '});',
          'ws.on("message", (data) => {',
          '  const msg = JSON.parse(data.toString());',
          '  if (msg.method === "accountNotification") {',
          '    console.log("Account updated:", msg.params.result.value);',
          '  }',
          '});',
          '```',
        );

        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error');
      }
    }
  );

  server.tool(
    'getEnhancedWebSocketInfo',
    'Get Helius Enhanced WebSocket capabilities, endpoints, and plan requirements. 1.5-2x faster than standard WebSockets. Fetches live from official documentation.',
    {},
    async () => {
      let wsUrl: string;
      try {
        wsUrl = getEnhancedWebSocketUrl();
      } catch (err) {
        return handleToolError(err, 'Enhanced WebSocket Error');
      }

      let content: string;
      try {
        content = await fetchDoc('enhanced-websockets');
      } catch {
        return mcpError(
          'Could not fetch live Enhanced WebSocket documentation. Try:\n' +
          '- `lookupHeliusDocs({ topic: \'enhanced-websockets\' })` for full documentation\n' +
          '- Visit https://www.helius.dev/docs/enhanced-websockets directly'
        );
      }

      const capabilities = extractSections(content, ['capabilities', 'features'], { includeLooseMatches: false });
      const subscriptions = extractSections(content, ['subscriptions', 'endpoints'], { includeLooseMatches: false });
      const plans = extractSections(content, ['plan requirements', 'plans'], { includeLooseMatches: false });
      const sections = [capabilities, subscriptions, plans].filter(Boolean).join('\n\n');
      const body = sections || truncateDoc(content);

      const result = [
        '# Helius Enhanced WebSockets (Official)',
        '',
        `**Endpoint:** \`${wsUrl}\``,
        '',
        body,
        '',
        '---',
        'Source: https://www.helius.dev/docs/enhanced-websockets (fetched live)',
      ].join('\n');
      return mcpText(result);
    }
  );
}
