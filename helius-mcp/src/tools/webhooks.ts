import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getHeliusClient, hasApiKey } from '../utils/helius.js';
import { formatAddress } from '../utils/formatters.js';
import { noApiKeyResponse } from './shared.js';
import { TRANSACTION_TYPES } from '../types/transaction-types.js';
import { mcpText, mcpError, validateEnum, handleToolError, http404Error, http400Error } from '../utils/errors.js';

export function registerWebhookTools(server: McpServer) {
  server.tool(
    'getAllWebhooks',
    'List all active webhooks for your Helius account. Shows webhook IDs, URLs, and monitored addresses.',
    {},
    async () => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const webhooks = await helius.webhooks.getAll();

        if (!webhooks || webhooks.length === 0) {
          return mcpText('**Webhooks**\n\nNo webhooks configured.');
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

        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error');
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
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const webhook = await helius.webhooks.get(webhookID);

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

        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching webhook', [
          http404Error('Webhook Details', `Webhook not found. The ID "${webhookID}" does not exist. Use getAllWebhooks to list your webhooks.`),
          http400Error('Webhook Details'),
        ]);
      }
    }
  );

  server.tool(
    'createWebhook',
    'Create a webhook to monitor Solana events in real-time with powerful filtering. Use this to track NFT sales, token swaps, staking, and 150+ transaction types. Webhooks send HTTP POST with parsed transaction data to your URL. Enhanced webhooks include human-readable descriptions. Credit cost: 100 credits to create (management operation). Each event delivered subsequently costs 1 credit.',
    {
      webhookURL: z.string().describe('Your webhook URL endpoint'),
      webhookType: z.string().describe('Webhook type - use "enhanced" for parsed transaction data with descriptions'),
      accountAddresses: z.array(z.string()).describe('Array of Solana addresses to monitor (up to 100,000 per webhook)'),
      transactionTypes: z.array(z.string()).optional().describe('Transaction types to monitor - e.g. ["SWAP", "NFT_SALE"]. Use ["ANY"] to receive all types. Common types: NFT_SALE, NFT_MINT, SWAP, TRANSFER, STAKE_TOKEN, UNSTAKE_TOKEN, BUY, SELL, TOKEN_MINT')
    },
    async ({ webhookURL, webhookType, accountAddresses, transactionTypes }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      const err = validateEnum(webhookType, ['enhanced', 'raw', 'discord'], 'Create Webhook Error', 'webhook type');
      if (err) return err;
      if (transactionTypes) {
        const invalid = transactionTypes.filter(t => !(TRANSACTION_TYPES as readonly string[]).includes(t));
        if (invalid.length > 0) {
          return mcpText(`**Create Webhook Error**\n\nInvalid transaction type(s): ${invalid.join(', ')}. See valid types: https://docs.helius.dev/webhooks/transaction-types`);
        }
      }
      try {
        const helius = getHeliusClient();
        const webhook = await helius.webhooks.create({
          webhookURL,
          webhookType,
          accountAddresses,
          transactionTypes
        });

        return mcpText(`✅ **Webhook Created**\n\n**ID:** ${webhook.webhookID}\n**URL:** ${webhook.webhookURL}\n**Monitoring:** ${accountAddresses.length} address(es)`);
      } catch (err) {
        return handleToolError(err, 'Error creating webhook', [
          http400Error('Create Webhook Error'),
        ]);
      }
    }
  );

  server.tool(
    'updateWebhook',
    'Update webhook configuration including URL, monitored addresses, or transaction type filters. Use this to add/remove addresses or change which transaction types trigger notifications. Credit cost: 100 credits/call (management operation).',
    {
      webhookID: z.string().describe('Webhook ID to update'),
      webhookURL: z.string().optional().describe('New webhook URL'),
      webhookType: z.string().optional().describe('Webhook type (required by the Helius API for updates)'),
      accountAddresses: z.array(z.string()).optional().describe('New list of addresses to monitor (replaces existing list)'),
      transactionTypes: z.array(z.string()).optional().describe('New transaction type filters - e.g. ["SWAP", "NFT_SALE"]. Replaces existing filters.')
    },
    async ({ webhookID, webhookURL, webhookType, accountAddresses, transactionTypes }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      if (webhookType) {
        const err = validateEnum(webhookType, ['enhanced', 'raw', 'discord'], 'Update Webhook Error', 'webhook type');
        if (err) return err;
      }
      if (transactionTypes) {
        const invalid = transactionTypes.filter(t => !(TRANSACTION_TYPES as readonly string[]).includes(t));
        if (invalid.length > 0) {
          return mcpText(`**Update Webhook Error**\n\nInvalid transaction type(s): ${invalid.join(', ')}. See valid types: https://docs.helius.dev/webhooks/transaction-types`);
        }
      }
      try {
        const helius = getHeliusClient();
        // Helius PUT /v0/webhooks requires the full webhook object.
        // Fetch the existing webhook first so callers only need to supply changed fields.
        const existing = await helius.webhooks.get(webhookID);
        const mergedParams: any = {
          webhookURL: webhookURL ?? existing.webhookURL,
          webhookType: webhookType ?? existing.webhookType,
          accountAddresses: accountAddresses ?? existing.accountAddresses,
        };
        if (transactionTypes) {
          mergedParams.transactionTypes = transactionTypes;
        } else if (existing.transactionTypes) {
          mergedParams.transactionTypes = existing.transactionTypes;
        }

        const webhook = await helius.webhooks.update(webhookID, mergedParams);

        return mcpText(`✅ **Webhook Updated**\n\n**ID:** ${webhook.webhookID}\n**URL:** ${webhook.webhookURL}`);
      } catch (err) {
        return handleToolError(err, 'Error updating webhook', [
          http404Error('Webhook Update', `Webhook not found. The ID "${webhookID}" does not exist. Use getAllWebhooks to list your webhooks.`),
          http400Error('Update Webhook Error'),
        ]);
      }
    }
  );

  server.tool(
    'deleteWebhook',
    'Delete a webhook by its ID. This permanently removes the webhook and stops all notifications. Credit cost: 100 credits/call (management operation).',
    {
      webhookID: z.string().describe('Webhook ID to delete')
    },
    async ({ webhookID }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        await helius.webhooks.delete(webhookID);

        return mcpText(`✅ Webhook ${webhookID} deleted successfully.`);
      } catch (err) {
        return handleToolError(err, 'Error deleting webhook', [
          http404Error('Webhook Delete', `Webhook not found. The ID "${webhookID}" does not exist. Use getAllWebhooks to list your webhooks.`),
          http400Error('Webhook Delete'),
        ]);
      }
    }
  );
}
