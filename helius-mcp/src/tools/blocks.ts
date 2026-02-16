import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getHeliusClient, hasApiKey } from '../utils/helius.js';
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

      try {
        const helius = getHeliusClient();

        // Kit requires BigInt for slot parameter
        const block = await (helius as any).getBlock(BigInt(slot), {
          encoding: 'jsonParsed',
          transactionDetails,
          maxSupportedTransactionVersion: 0,
          rewards: true
        }).send();

        if (!block) {
          return mcpText(`**Block at Slot ${slot.toLocaleString()}**\n\nBlock not found. It may have been skipped or not yet confirmed.`);
        }

        const parentSlot = Number(block.parentSlot);
        const blockHeight = block.blockHeight != null ? Number(block.blockHeight) : null;
        const blockTime = block.blockTime != null ? Number(block.blockTime) : null;

        const lines = [
          `**Block at Slot ${slot.toLocaleString()}**`,
          '',
          `**Blockhash:** ${block.blockhash}`,
          `**Parent Slot:** ${parentSlot.toLocaleString()}`,
          `**Previous Blockhash:** ${block.previousBlockhash}`,
        ];

        if (blockHeight !== null) {
          lines.push(`**Block Height:** ${blockHeight.toLocaleString()}`);
        }
        if (blockTime) {
          lines.push(`**Block Time:** ${formatTimestamp(blockTime)}`);
        }

        // Transaction count
        if (transactionDetails === 'signatures' && block.signatures) {
          lines.push(`**Transactions:** ${block.signatures.length}`);
        } else if (transactionDetails === 'full' && block.transactions) {
          lines.push(`**Transactions:** ${block.transactions.length}`);
        }

        // Rewards summary
        if (block.rewards && block.rewards.length > 0) {
          const totalRewards = block.rewards.reduce((sum: number, r: any) => sum + Number(r.lamports), 0);
          const rewardTypes = new Map<string, number>();
          block.rewards.forEach((r: any) => {
            const lamports = Number(r.lamports);
            rewardTypes.set(r.rewardType, (rewardTypes.get(r.rewardType) || 0) + lamports);
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
          block.signatures.slice(0, maxShow).forEach((sig: string) => {
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
