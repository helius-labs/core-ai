import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { hasApiKey, getRpcUrl } from '../utils/helius.js';
import { noApiKeyResponse } from './shared.js';
import { mcpText, validateEnum, handleToolError } from '../utils/errors.js';

export function registerFeeTools(server: McpServer) {
  // Get Priority Fee Estimate
  server.tool(
    'getPriorityFeeEstimate',
    'Get optimal priority fee estimates for Solana transactions. Returns recommended fees in microlamports for different priority levels (Min, Low, Medium, High, VeryHigh, UnsafeMax). Essential for ensuring transaction confirmation during network congestion.',
    {
      accountKeys: z.array(z.string()).optional().describe('Account addresses involved in transaction for more accurate estimates'),
      priorityLevel: z.string().optional().describe('Desired priority level'),
      includeAllLevels: z.boolean().optional().default(true).describe('Return fees for all priority levels')
    },
    async ({ accountKeys, priorityLevel, includeAllLevels }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      if (priorityLevel) {
        const err = validateEnum(priorityLevel, ['Min', 'Low', 'Medium', 'High', 'VeryHigh', 'UnsafeMax'], 'Priority Fee Estimate', 'priority level');
        if (err) return err;
      }

      const url = getRpcUrl();

      type PriorityFeeRequest = {
        jsonrpc: '2.0';
        id: string;
        method: 'getPriorityFeeEstimate';
        params: [{
          accountKeys?: string[];
          options?: {
            priorityLevel?: string;
            includeAllPriorityFeeLevels?: boolean;
          };
        }];
      };

      type PriorityFeeResponse = {
        result?: {
          priorityFeeEstimate?: number;
          priorityFeeLevels?: {
            min: number;
            low: number;
            medium: number;
            high: number;
            veryHigh: number;
            unsafeMax: number;
          };
        };
        error?: { message: string };
      };

      const requestBody: PriorityFeeRequest = {
        jsonrpc: '2.0',
        id: 'priority-fee-estimate',
        method: 'getPriorityFeeEstimate',
        params: [{
          ...(accountKeys && { accountKeys }),
          options: {
            ...(priorityLevel && { priorityLevel }),
            includeAllPriorityFeeLevels: includeAllLevels
          }
        }]
      };

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        const data = await response.json() as PriorityFeeResponse;

        if (data.error) {
          return mcpText(`**Priority Fee Estimate Error**\n\n${data.error.message}`);
        }

        const result = data.result;
        if (!result) {
          return mcpText(`**Priority Fee Estimate**\n\nNo fee data available.`);
        }

        const lines = ['**Priority Fee Estimate**', ''];

        if (result.priorityFeeLevels) {
          const levels = result.priorityFeeLevels;
          lines.push('| Level | Fee (microlamports) |');
          lines.push('|-------|-------------------|');
          lines.push(`| Min | ${levels.min.toLocaleString()} |`);
          lines.push(`| Low | ${levels.low.toLocaleString()} |`);
          lines.push(`| Medium | ${levels.medium.toLocaleString()} |`);
          lines.push(`| High | ${levels.high.toLocaleString()} |`);
          lines.push(`| Very High | ${levels.veryHigh.toLocaleString()} |`);
          lines.push(`| Unsafe Max | ${levels.unsafeMax.toLocaleString()} |`);
        } else if (result.priorityFeeEstimate !== undefined) {
          lines.push(`**Estimated Fee:** ${result.priorityFeeEstimate.toLocaleString()} microlamports`);
        }

        if (accountKeys && accountKeys.length > 0) {
          lines.push('', `*Estimate based on ${accountKeys.length} account(s)*`);
        }

        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching priority fee estimate');
      }
    }
  );
}
