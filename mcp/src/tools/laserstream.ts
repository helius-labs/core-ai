import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getLaserstreamUrl, getNetwork } from '../utils/helius.js';

export function registerLaserstreamTools(server: McpServer) {

  server.tool(
    'laserstreamSubscribe',
    'Get Laserstream gRPC config for high-performance Solana streaming. Subscribe to slots, accounts, transactions, blocks, or entries. 24h historical replay. Professional plan for mainnet. Returns connection config and code example.',
    {
      region: z.enum(['ewr', 'pitt', 'slc', 'lax', 'lon', 'ams', 'fra', 'tyo', 'sgp']).optional().default('ewr'),
      commitment: z.enum(['processed', 'confirmed', 'finalized']).optional(),
      subscribeSlots: z.boolean().optional(),
      filterByCommitment: z.boolean().optional(),
      subscribeAccounts: z.array(z.string()).optional().describe('Account public keys to watch'),
      accountOwners: z.array(z.string()).optional().describe('Filter by owner addresses'),
      subscribeTransactions: z.boolean().optional(),
      transactionAccountInclude: z.array(z.string()).optional().describe('Accounts to include (OR logic)'),
      transactionAccountExclude: z.array(z.string()).optional(),
      transactionAccountRequired: z.array(z.string()).optional().describe('Accounts required (AND logic)'),
      subscribeBlocks: z.boolean().optional(),
      subscribeBlocksMeta: z.boolean().optional(),
      subscribeEntries: z.boolean().optional(),
      fromSlot: z.string().optional().describe('Starting slot for 24h historical replay'),
      keepalive: z.boolean().optional().default(true)
    },
    async (params) => {
      try {
        const network = getNetwork();
        const endpoint = getLaserstreamUrl(params.region);
        const sub: any = {};

        if (params.subscribeSlots) sub.slots = { filterByCommitment: params.filterByCommitment };
        if (params.subscribeAccounts || params.accountOwners) {
          sub.accounts = {};
          if (params.subscribeAccounts) sub.accounts.account = params.subscribeAccounts;
          if (params.accountOwners) sub.accounts.owner = params.accountOwners;
        }
        if (params.subscribeTransactions || params.transactionAccountInclude || params.transactionAccountExclude || params.transactionAccountRequired) {
          sub.transactions = {};
          if (params.transactionAccountInclude) sub.transactions.accountInclude = params.transactionAccountInclude;
          if (params.transactionAccountExclude) sub.transactions.accountExclude = params.transactionAccountExclude;
          if (params.transactionAccountRequired) sub.transactions.accountRequired = params.transactionAccountRequired;
        }
        if (params.subscribeBlocks) sub.blocks = {};
        if (params.subscribeBlocksMeta) sub.blocksMeta = {};
        if (params.subscribeEntries) sub.entries = {};
        if (params.commitment) sub.commitment = params.commitment.toUpperCase();
        if (params.fromSlot) sub.fromSlot = params.fromSlot;

        const lines = [
          '**Laserstream gRPC Subscription**',
          '',
          `**Network:** ${network}`,
          `**Endpoint:** \`${endpoint}\``,
          '',
          '**Config:**',
          '```json',
          JSON.stringify(sub, null, 2),
          '```',
          '',
          '**Example Code:**',
          '```typescript',
          'import { subscribe } from "@helius/laserstream";',
          '',
          'await subscribe(', 
          `  { apiKey: process.env.HELIUS_API_KEY, endpoint: "${endpoint}" },`,
          '  ' + JSON.stringify(sub) + ',',
          '  (data) => console.log("Update:", data),',
          '  (error) => console.error("Error:", error)',
          ');',
          '```',
          '',
          '**SDK:** npm install @helius/laserstream',
          '**Docs:** https://www.helius.dev/docs/laserstream/grpc',
        ];

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
      }
    }
  );

  server.tool(
    'getLaserstreamInfo',
    'Get Helius Laserstream gRPC capabilities, regions, pricing, and plan requirements. Lowest latency Solana streaming with 24h replay.',
    {},
    async () => {
      try {
        const network = getNetwork();
        const endpoint = getLaserstreamUrl();
        const lines = [
          '**Helius Laserstream gRPC**',
          '',
          `**Network:** ${network}`,
          `**Endpoint:** \`${endpoint}\``,
          '',
          '**Subscriptions:** slots, accounts, transactions, blocks, block metadata, entries',
          '**Replay:** 24h historical (up to 216,000 slots)',
          '**Cost:** 3 credits per 0.1 MB',
          '',
          '**Plans:** Professional (mainnet + devnet), Developer/Business (devnet only)',
          '',
          '**Regions:** ewr (Newark), pitt (Pittsburgh), slc (Salt Lake City), lax (Los Angeles), lon (London), ams (Amsterdam), fra (Frankfurt), tyo (Tokyo), sgp (Singapore)',
          '',
          '**SDKs:** TypeScript (@helius/laserstream), Rust (helius-laserstream), Go (laserstream-go)',
          '**Docs:** https://www.helius.dev/docs/laserstream/grpc',
        ];
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
      }
    }
  );
}
