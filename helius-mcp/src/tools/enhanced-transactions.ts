import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { restRequest } from '../utils/helius.js';
import { formatAddress } from '../utils/formatters.js';

export function registerEnhancedTransactionTools(server: McpServer) {
  server.tool(
    'parseTransactions',
    'Parse Solana transactions into human-readable format with automatic labeling and descriptions. Supports all transaction types including swaps, NFT trades, transfers, staking, and DeFi operations. Returns rich parsed data with token amounts, prices, and action descriptions.',
    {
      transactions: z.array(z.string()).describe('Array of transaction signatures (up to 100)')
    },
    async ({ transactions }) => {
      try {
        if (transactions.length > 100) {
          return {
            content: [{ type: 'text' as const, text: '❌ Maximum 100 transactions per request' }],
            isError: true
          };
        }

        const parsed = await restRequest('/v0/transactions', {
          method: 'POST',
          body: JSON.stringify({ transactions })
        });

        if (!parsed || parsed.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No transaction data returned.' }]
          };
        }

        const lines = [`**Parsed Transactions** (${parsed.length} transactions)`, ''];
        parsed.forEach((tx: any, i: number) => {
          lines.push(`${i + 1}. **${tx.type || 'Transaction'}**`);
          lines.push(`   Signature: ${tx.signature}`);
          if (tx.description) {
            lines.push(`   Description: ${tx.description}`);
          }
          if (tx.timestamp) {
            const date = new Date(tx.timestamp * 1000).toLocaleString();
            lines.push(`   Time: ${date}`);
          }
          if (tx.fee) {
            lines.push(`   Fee: ${(tx.fee / 1_000_000_000).toFixed(6)} SOL`);
          }
          lines.push('');
        });

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }]
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `❌ Error: ${errorMsg}` }],
          isError: true
        };
      }
    }
  );
}
