import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getLaserstreamUrl, getNetwork } from '../utils/helius.js';
import { mcpText, mcpError, validateEnum, handleToolError, warnInvalidAddresses, warnAddressConflicts } from '../utils/errors.js';
import { fetchDoc } from '../utils/docs.js';

export function registerLaserstreamTools(server: McpServer) {

  server.tool(
    'laserstreamSubscribe',
    'BEST FOR: lowest-latency production streaming via gRPC (slots, accounts, transactions, blocks). PREFER transactionSubscribe for simpler WebSocket-based streaming. PREFER createWebhook for fire-and-forget notifications. Get Laserstream gRPC config for high-performance Solana streaming. Subscribe to slots, accounts, transactions, blocks, or entries. 24h historical replay. Professional plan for mainnet. Returns connection config and code example.',
    {
      region: z.string().optional().default('ewr'),
      commitment: z.string().optional(),
      subscribeSlots: z.boolean().optional(),
      filterByCommitment: z.boolean().optional(),
      subscribeAccounts: z.array(z.string()).optional().describe('Account public keys to watch (base58 encoded)'),
      accountOwners: z.array(z.string()).optional().describe('Filter by owner addresses (base58 encoded)'),
      subscribeTransactions: z.boolean().optional(),
      transactionAccountInclude: z.array(z.string()).optional().describe('Accounts to include (base58 encoded, OR logic)'),
      transactionAccountExclude: z.array(z.string()).optional().describe('Accounts to exclude (base58 encoded)'),
      transactionAccountRequired: z.array(z.string()).optional().describe('Accounts required (base58 encoded, AND logic)'),
      subscribeBlocks: z.boolean().optional(),
      subscribeBlocksMeta: z.boolean().optional(),
      subscribeEntries: z.boolean().optional(),
      fromSlot: z.string().optional().describe('Starting slot for 24h historical replay'),
      keepalive: z.boolean().optional().default(true)
    },
    async (params) => {
      let err;
      err = validateEnum(params.region, ['ewr', 'pitt', 'slc', 'lax', 'lon', 'ams', 'fra', 'tyo', 'sgp'], 'Laserstream Error', 'region');
      if (err) return err;
      if (params.commitment) {
        err = validateEnum(params.commitment, ['processed', 'confirmed', 'finalized'], 'Laserstream Error', 'commitment');
        if (err) return err;
      }

      // Validate fromSlot is a non-negative integer string
      if (params.fromSlot !== undefined) {
        const slotNum = Number(params.fromSlot);
        if (!Number.isInteger(slotNum) || slotNum < 0) {
          return mcpText(`**Laserstream Error**\n\nInvalid fromSlot "${params.fromSlot}". Must be a non-negative integer slot number.`);
        }
      }

      // Check that at least one subscription type is selected
      const hasSubscription = params.subscribeSlots || params.subscribeAccounts || params.accountOwners
        || params.subscribeTransactions || params.transactionAccountInclude || params.transactionAccountExclude || params.transactionAccountRequired
        || params.subscribeBlocks || params.subscribeBlocksMeta || params.subscribeEntries;

      // Collect warnings for config issues that would fail at runtime
      const warnings: string[] = [];

      if (!hasSubscription) {
        warnings.push('No subscription type selected. You must subscribe to at least one of: slots, accounts, transactions, blocks, blocksMeta, or entries.');
      }

      if (params.filterByCommitment && !params.commitment) {
        warnings.push('filterByCommitment is set but no commitment level was provided. Add commitment ("processed", "confirmed", or "finalized") for filtering to take effect.');
      }

      if (params.keepalive === false) {
        warnings.push('keepalive=false: The gRPC connection will not send keepalive pings. This may cause disconnects on idle streams. The default (true) is recommended.');
      }

      // Validate address arrays for empty/blank and invalid format
      const addressArrays: [string, string[] | undefined][] = [
        ['subscribeAccounts', params.subscribeAccounts],
        ['accountOwners', params.accountOwners],
        ['transactionAccountInclude', params.transactionAccountInclude],
        ['transactionAccountExclude', params.transactionAccountExclude],
        ['transactionAccountRequired', params.transactionAccountRequired],
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

      const conflict = warnAddressConflicts('transactionAccountInclude', params.transactionAccountInclude, 'transactionAccountExclude', params.transactionAccountExclude);
      if (conflict) warnings.push(conflict);

      if (params.subscribeTransactions && !params.transactionAccountInclude && !params.transactionAccountExclude && !params.transactionAccountRequired) {
        warnings.push('subscribeTransactions is enabled with no account filters. This will stream ALL transactions on the network, which produces extremely high volume. Consider adding transactionAccountInclude or transactionAccountRequired filters.');
      }

      if (params.fromSlot !== undefined && Number(params.fromSlot) === 0) {
        warnings.push('fromSlot is 0 (genesis). Laserstream only supports 24h historical replay (~216,000 slots). Use a recent slot number for replay.');
      }

      try {
        const network = getNetwork();
        const endpoint = getLaserstreamUrl(params.region as 'ewr' | 'pitt' | 'slc' | 'lax' | 'lon' | 'ams' | 'fra' | 'tyo' | 'sgp');
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
        if (params.keepalive === false) sub.keepalive = false;

        const lines = [
          '**Laserstream gRPC Subscription**',
          '',
          `**Network:** ${network}`,
          `**Endpoint:** \`${endpoint}\``,
          '',
        ];

        if (warnings.length > 0) {
          lines.push('**Warnings:**');
          warnings.forEach(w => lines.push(`- ${w}`));
          lines.push('');
        }

        lines.push(
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
        );

        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error');
      }
    }
  );

  server.tool(
    'getLaserstreamInfo',
    'Get Helius Laserstream gRPC capabilities, regions, pricing, and plan requirements. Lowest latency Solana streaming with 24h replay. Fetches live from official documentation.',
    {},
    async () => {
      let endpoint: string;
      try {
        endpoint = getLaserstreamUrl();
      } catch (err) {
        return handleToolError(err, 'Laserstream Error');
      }

      let content: string;
      try {
        content = await fetchDoc('laserstream');
      } catch {
        return mcpError(
          'Could not fetch live Laserstream documentation. Try:\n' +
          '- `lookupHeliusDocs({ topic: \'laserstream\' })` for full documentation\n' +
          '- Visit https://www.helius.dev/docs/laserstream/grpc directly'
        );
      }

      const result = [
        '# Helius Laserstream (Official)',
        '',
        `**Endpoint:** \`${endpoint}\``,
        '',
        content,
        '',
        '---',
        'Source: https://www.helius.dev/docs/laserstream/grpc (fetched live)',
      ].join('\n');
      return mcpText(result);
    }
  );
}
