import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { restRequest } from '../utils/helius.js';
import { formatAddress } from '../utils/formatters.js';
import { TRANSACTION_TYPES } from '../types/transaction-types.js';

export function registerWebhookTools(server: McpServer) {
  server.tool(
    'getAllWebhooks',
    'List all active webhooks for your Helius account. Shows webhook IDs, URLs, and monitored addresses.',
    {},
    async () => {
      try {
        const webhooks = await restRequest('/v0/webhooks');

        if (!webhooks || webhooks.length === 0) {
          return {
            content: [{ type: 'text' as const, text: '**Webhooks**\n\nNo webhooks configured.' }]
          };
        }

        const lines = [`**Webhooks** (${webhooks.length} total)`, ''];
        webhooks.forEach((webhook: any, i: number) => {
          lines.push(`${i + 1}. **${webhook.webhookType || 'Webhook'}**`);
          lines.push(`   ID: ${webhook.webhookID}`);
          lines.push(`   URL: ${webhook.webhookURL}`);
          if (webhook.accountAddresses && webhook.accountAddresses.length > 0) {
            lines.push(`   Monitoring: ${webhook.accountAddresses.length} address(es)`);
          }
          lines.push('');
        });

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }]
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'getWebhookByID',
    'Get detailed information about a specific webhook by its ID.',
    {
      webhookID: z.string().describe('Webhook ID')
    },
    async ({ webhookID }) => {
      try {
        const webhook = await restRequest(`/v0/webhooks/${webhookID}`);

        const lines = [
          `**Webhook Details**`,
          '',
          `**ID:** ${webhook.webhookID}`,
          `**Type:** ${webhook.webhookType}`,
          `**URL:** ${webhook.webhookURL}`,
        ];

        if (webhook.accountAddresses && webhook.accountAddresses.length > 0) {
          lines.push('', '**Monitored Addresses:**');
          webhook.accountAddresses.slice(0, 20).forEach((addr: string) => {
            lines.push(`- ${formatAddress(addr)}`);
          });
          if (webhook.accountAddresses.length > 20) {
            lines.push(`... and ${webhook.accountAddresses.length - 20} more`);
          }
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }]
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'createWebhook',
    'Create a webhook to monitor Solana events in real-time with powerful filtering. Use this to track NFT sales, token swaps, staking, and 150+ transaction types. Webhooks send HTTP POST with parsed transaction data to your URL. Enhanced webhooks include human-readable descriptions.',
    {
      webhookURL: z.string().describe('Your webhook URL endpoint'),
      webhookType: z.enum(['enhanced', 'raw', 'discord']).describe('Webhook type - use "enhanced" for parsed transaction data with descriptions'),
      accountAddresses: z.array(z.string()).describe('Array of Solana addresses to monitor (up to 100,000 per webhook)'),
      transactionTypes: z.array(z.enum(TRANSACTION_TYPES as unknown as [string, ...string[]])).describe('Transaction types to monitor - e.g. ["SWAP", "NFT_SALE"]. Use ["ANY"] to receive all types. Common types: NFT_SALE, NFT_MINT, SWAP, TRANSFER, STAKE_TOKEN, UNSTAKE_TOKEN, BUY, SELL, TOKEN_MINT')
    },
    async ({ webhookURL, webhookType, accountAddresses, transactionTypes }) => {
      try {
        const body: any = {
          webhookURL,
          webhookType,
          accountAddresses,
          transactionTypes
        };

        const webhook = await restRequest('/v0/webhooks', {
          method: 'POST',
          body: JSON.stringify(body)
        });

        return {
          content: [{
            type: 'text' as const,
            text: `**Webhook Created**\n\n**ID:** ${webhook.webhookID}\n**URL:** ${webhook.webhookURL}\n**Monitoring:** ${accountAddresses.length} address(es)`
          }]
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'updateWebhook',
    'Update webhook configuration including URL, monitored addresses, or transaction type filters. Use this to add/remove addresses or change which transaction types trigger notifications.',
    {
      webhookID: z.string().describe('Webhook ID to update'),
      webhookURL: z.string().optional().describe('New webhook URL'),
      webhookType: z.enum(['enhanced', 'raw', 'discord']).optional().describe('Webhook type (required by the Helius API for updates)'),
      accountAddresses: z.array(z.string()).optional().describe('New list of addresses to monitor (replaces existing list)'),
      transactionTypes: z.array(z.enum(TRANSACTION_TYPES as unknown as [string, ...string[]])).optional().describe('New transaction type filters - e.g. ["SWAP", "NFT_SALE"]. Replaces existing filters.')
    },
    async ({ webhookID, webhookURL, webhookType, accountAddresses, transactionTypes }) => {
      try {
        // Helius PUT /v0/webhooks requires the full webhook object.
        // Fetch the existing webhook first so callers only need to supply changed fields.
        const existing = await restRequest(`/v0/webhooks/${webhookID}`);
        const body: any = {
          webhookURL: webhookURL ?? existing.webhookURL,
          webhookType: webhookType ?? existing.webhookType,
          accountAddresses: accountAddresses ?? existing.accountAddresses,
        };
        if (transactionTypes) {
          body.transactionTypes = transactionTypes;
        } else if (existing.transactionTypes) {
          body.transactionTypes = existing.transactionTypes;
        }

        const webhook = await restRequest(`/v0/webhooks/${webhookID}`, {
          method: 'PUT',
          body: JSON.stringify(body)
        });

        return {
          content: [{
            type: 'text' as const,
            text: `**Webhook Updated**\n\n**ID:** ${webhook.webhookID}\n**URL:** ${webhook.webhookURL}`
          }]
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'deleteWebhook',
    'Delete a webhook by its ID. This permanently removes the webhook and stops all notifications.',
    {
      webhookID: z.string().describe('Webhook ID to delete')
    },
    async ({ webhookID }) => {
      try {
        await restRequest(`/v0/webhooks/${webhookID}`, {
          method: 'DELETE',
        });

        return {
          content: [{
            type: 'text' as const,
            text: `Webhook ${webhookID} deleted successfully.`
          }]
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }],
          isError: true
        };
      }
    }
  );
}
