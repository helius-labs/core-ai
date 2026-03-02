import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getHeliusClient, hasApiKey } from '../utils/helius.js';
import { formatSolCompact } from '../utils/formatters.js';
import { noApiKeyResponse } from './shared.js';
import { mcpText, handleToolError } from '../utils/errors.js';

export function registerNetworkTools(server: McpServer) {
  server.tool(
    'getNetworkStatus',
    'BEST FOR: quick Solana network health check — epoch, slot, supply, version. Get current Solana network status including epoch info (current epoch, slot, progress), total SOL supply, cluster version, and current block height. No parameters needed — gives a quick overview of blockchain health and state. Credit cost: 3 credits (3 standard RPC calls).',
    {},
    async () => {
      if (!hasApiKey()) return noApiKeyResponse();

      try {
        const helius = getHeliusClient();

        // Fire all requests in parallel — Kit returns bigint for numeric fields
        // wrapAutoSend in the SDK already calls .send() on pending RPC requests
        const [epochInfo, supplyResult, version] = await Promise.all([
          (helius as any).getEpochInfo(),
          (helius as any).getSupply(),
          (helius as any).getVersion(),
        ]);

        const lines = ['**Solana Network Status**', ''];

        // Epoch info — all fields are bigint from Kit
        if (epochInfo) {
          const epoch = Number(epochInfo.epoch);
          const slotIndex = Number(epochInfo.slotIndex);
          const slotsInEpoch = Number(epochInfo.slotsInEpoch);
          const absoluteSlot = Number(epochInfo.absoluteSlot);
          const blockHeight = Number(epochInfo.blockHeight);
          const transactionCount = epochInfo.transactionCount != null ? Number(epochInfo.transactionCount) : null;

          const epochProgress = ((slotIndex / slotsInEpoch) * 100).toFixed(1);
          lines.push('**Epoch:**');
          lines.push(`- Current Epoch: ${epoch}`);
          lines.push(`- Progress: ${epochProgress}% (slot ${slotIndex.toLocaleString()} / ${slotsInEpoch.toLocaleString()})`);
          lines.push(`- Absolute Slot: ${absoluteSlot.toLocaleString()}`);
          lines.push(`- Block Height: ${blockHeight.toLocaleString()}`);
          if (transactionCount !== null) {
            lines.push(`- Transaction Count: ${transactionCount.toLocaleString()}`);
          }
          lines.push('');
        }

        // Supply — value fields are bigint from Kit
        if (supplyResult?.value) {
          const supply = supplyResult.value;
          lines.push('**SOL Supply:**');
          lines.push(`- Total: ${formatSolCompact(Number(supply.total))}`);
          lines.push(`- Circulating: ${formatSolCompact(Number(supply.circulating))}`);
          lines.push(`- Non-Circulating: ${formatSolCompact(Number(supply.nonCirculating))}`);
          lines.push('');
        }

        // Version — no bigint issues
        if (version) {
          lines.push(`**Cluster Version:** ${version['solana-core']}`);
        }

        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching network status');
      }
    }
  );
}
