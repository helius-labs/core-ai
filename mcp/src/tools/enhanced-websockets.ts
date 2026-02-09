import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getEnhancedWebSocketUrl } from '../utils/helius.js';

export function registerEnhancedWebSocketTools(server: McpServer) {

  server.tool(
    'transactionSubscribe',
    'Get Enhanced WebSocket config for real-time Solana transaction streaming. Filter by accounts, vote/failed txns, or signatures. Up to 50,000 addresses per filter. Business+ plans only. Returns connection config and code example.',
    {
      vote: z.boolean().optional().describe('Include vote transactions'),
      failed: z.boolean().optional().describe('Include failed transactions'),
      signature: z.string().optional().describe('Filter to specific signature'),
      accountInclude: z.array(z.string()).optional().describe('Accounts to include (OR logic)'),
      accountExclude: z.array(z.string()).optional().describe('Accounts to exclude'),
      accountRequired: z.array(z.string()).optional().describe('Accounts required (AND logic)'),
      commitment: z.enum(['processed', 'confirmed', 'finalized']).optional().default('confirmed'),
      encoding: z.enum(['base58', 'base64', 'jsonParsed']).optional().default('jsonParsed'),
      transactionDetails: z.enum(['full', 'signatures', 'accounts', 'none']).optional().default('full'),
      showRewards: z.boolean().optional().default(false),
      maxSupportedTransactionVersion: z.number().optional().default(0)
    },
    async (params) => {
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
        ];

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
      }
    }
  );

  server.tool(
    'accountSubscribe',
    'Get Enhanced WebSocket config for real-time Solana account monitoring. Track balance changes and data updates. Business+ plans only. Returns connection config and code example.',
    {
      account: z.string().describe('Account public key (base58)'),
      encoding: z.enum(['base58', 'base64', 'base64+zstd', 'jsonParsed']).optional().default('base58'),
      commitment: z.enum(['finalized', 'confirmed', 'processed']).optional().default('finalized')
    },
    async ({ account, encoding, commitment }) => {
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
        ];

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
      }
    }
  );

  server.tool(
    'getEnhancedWebSocketInfo',
    'Get Helius Enhanced WebSocket capabilities, endpoints, and plan requirements. 1.5-2x faster than standard WebSockets.',
    {},
    async () => {
      try {
        const wsUrl = getEnhancedWebSocketUrl();
        const lines = [
          '**Helius Enhanced WebSocket Service**',
          '',
          `**Endpoint:** \`${wsUrl}\``,
          '',
          '**Subscriptions:** transactionSubscribe, accountSubscribe',
          '**Speed:** 1.5-2x faster than standard WebSockets',
          '**Filtering:** Up to 50,000 addresses per filter',
          '**Plans:** Business or Professional tier',
          '**Timeout:** 10 min inactivity, ping every 30-60s',
          '',
          '**Docs:** https://www.helius.dev/docs/enhanced-websockets',
        ];
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
      }
    }
  );
}
