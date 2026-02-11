import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { hasApiKey, getRpcUrl } from '../utils/helius.js';
import { formatSol, formatTimestamp } from '../utils/formatters.js';
import { noApiKeyResponse } from './shared.js';
import { mcpText, validateEnum, handleToolError } from '../utils/errors.js';

export function registerBlockTools(server: McpServer) {
  server.tool(
    'getBlock',
    'Get detailed information about a specific Solana block by slot number. Returns block time, blockhash, parent slot, transaction count, and reward summary. Use transactionDetails to control how much transaction data is included: "none" for just block metadata, "signatures" for a list of transaction signatures, or "full" for complete transaction data.',
    {
      slot: z.number().describe('Slot number of the block to fetch'),
      transactionDetails: z.string().optional().default('signatures').describe('"none" = block metadata only, "signatures" = list of tx signatures (default), "full" = complete transaction data')
    },
    async ({ slot, transactionDetails }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      const err = validateEnum(transactionDetails, ['none', 'signatures', 'full'], 'Block Error', 'transactionDetails');
      if (err) return err;

      const url = getRpcUrl();

      try {
        const requestBody = {
          jsonrpc: '2.0',
          id: 'get-block',
          method: 'getBlock',
          params: [
            slot,
            {
              encoding: 'jsonParsed',
              transactionDetails,
              maxSupportedTransactionVersion: 0,
              rewards: true
            }
          ]
        };

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        type Reward = {
          pubkey: string;
          lamports: number;
          postBalance: number;
          rewardType: string;
          commission?: number;
        };

        type BlockResult = {
          blockhash: string;
          previousBlockhash: string;
          parentSlot: number;
          blockTime: number | null;
          blockHeight: number | null;
          transactions?: unknown[];
          signatures?: string[];
          rewards?: Reward[];
        };

        type ApiResponse = {
          result?: BlockResult;
          error?: { message: string };
        };

        const data = await response.json() as ApiResponse;

        if (data.error) {
          return mcpText(`**Error**\n\n${data.error.message}`);
        }

        const block = data.result;
        if (!block) {
          return mcpText(`**Block at Slot ${slot.toLocaleString()}**\n\nBlock not found. It may have been skipped or not yet confirmed.`);
        }

        const lines = [
          `**Block at Slot ${slot.toLocaleString()}**`,
          '',
          `**Blockhash:** ${block.blockhash}`,
          `**Parent Slot:** ${block.parentSlot.toLocaleString()}`,
          `**Previous Blockhash:** ${block.previousBlockhash}`,
        ];

        if (block.blockHeight !== null) {
          lines.push(`**Block Height:** ${block.blockHeight.toLocaleString()}`);
        }
        if (block.blockTime) {
          lines.push(`**Block Time:** ${formatTimestamp(block.blockTime)}`);
        }

        // Transaction count
        if (transactionDetails === 'signatures' && block.signatures) {
          lines.push(`**Transactions:** ${block.signatures.length}`);
        } else if (transactionDetails === 'full' && block.transactions) {
          lines.push(`**Transactions:** ${block.transactions.length}`);
        }

        // Rewards summary
        if (block.rewards && block.rewards.length > 0) {
          const totalRewards = block.rewards.reduce((sum, r) => sum + r.lamports, 0);
          const rewardTypes = new Map<string, number>();
          block.rewards.forEach((r) => {
            rewardTypes.set(r.rewardType, (rewardTypes.get(r.rewardType) || 0) + r.lamports);
          });

          lines.push('', `**Rewards:** ${formatSol(totalRewards)} total (${block.rewards.length} recipients)`);
          rewardTypes.forEach((lamports, type) => {
            lines.push(`- ${type}: ${formatSol(lamports)}`);
          });
        }

        // Show signatures if in signatures mode
        if (transactionDetails === 'signatures' && block.signatures && block.signatures.length > 0) {
          const maxShow = 20;
          lines.push('', `**Transaction Signatures** (${block.signatures.length} total):`);
          block.signatures.slice(0, maxShow).forEach((sig) => {
            lines.push(`- ${sig}`);
          });
          if (block.signatures.length > maxShow) {
            lines.push(`... +${block.signatures.length - maxShow} more`);
          }
        }

        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching block');
      }
    }
  );
}
