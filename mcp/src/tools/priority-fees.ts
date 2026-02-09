import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { rpcRequest } from '../utils/helius.js';

export function registerPriorityFeeTools(server: McpServer) {
  server.tool(
    'getPriorityFeeEstimate',
    'Get optimal priority fee estimates for Solana transactions. Returns recommended fees in microlamports for different priority levels (min, low, medium, high, very high). Essential for ensuring transaction confirmation during network congestion.',
    {
      accountKeys: z.array(z.string()).optional().describe('Account addresses involved in transaction for more accurate estimates'),
      options: z.object({
        priority_level: z.enum(['Min', 'Low', 'Medium', 'High', 'VeryHigh', 'UnsafeMax']).optional().describe('Desired priority level'),
        includeAllPriorityFeeLevels: z.boolean().optional().describe('Return fees for all priority levels')
      }).optional().describe('Priority fee options')
    },
    async ({ accountKeys, options }) => {
      try {
        const params: any = {};
        if (accountKeys) params.accountKeys = accountKeys;
        if (options) params.options = options;

        const result = await rpcRequest('getPriorityFeeEstimate', [params]);

        const lines = ['**Priority Fee Estimate**', ''];

        if (result.priorityFeeLevels) {
          lines.push('**Fee Levels (microlamports):**');
          if (result.priorityFeeLevels.min !== undefined) {
            lines.push(`- Min: ${result.priorityFeeLevels.min.toLocaleString()}`);
          }
          if (result.priorityFeeLevels.low !== undefined) {
            lines.push(`- Low: ${result.priorityFeeLevels.low.toLocaleString()}`);
          }
          if (result.priorityFeeLevels.medium !== undefined) {
            lines.push(`- Medium: ${result.priorityFeeLevels.medium.toLocaleString()}`);
          }
          if (result.priorityFeeLevels.high !== undefined) {
            lines.push(`- High: ${result.priorityFeeLevels.high.toLocaleString()}`);
          }
          if (result.priorityFeeLevels.veryHigh !== undefined) {
            lines.push(`- Very High: ${result.priorityFeeLevels.veryHigh.toLocaleString()}`);
          }
          if (result.priorityFeeLevels.unsafeMax !== undefined) {
            lines.push(`- Unsafe Max: ${result.priorityFeeLevels.unsafeMax.toLocaleString()}`);
          }
        } else if (result.priorityFeeEstimate !== undefined) {
          lines.push(`**Recommended Fee:** ${result.priorityFeeEstimate.toLocaleString()} microlamports`);
        }

        if (accountKeys && accountKeys.length > 0) {
          lines.push('', `Calculated for ${accountKeys.length} account(s)`);
        }

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
