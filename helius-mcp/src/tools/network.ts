import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hasApiKey, getRpcUrl } from '../utils/helius.js';
import { formatSolCompact } from '../utils/formatters.js';
import { noApiKeyResponse } from './shared.js';

export function registerNetworkTools(server: McpServer) {
  server.tool(
    'getNetworkStatus',
    'Get current Solana network status including epoch info (current epoch, slot, progress), total SOL supply, cluster version, and current block height. No parameters needed — gives a quick overview of blockchain health and state.',
    {},
    async () => {
      if (!hasApiKey()) return noApiKeyResponse();

      const url = getRpcUrl();

      const makeRequest = async (method: string, params: unknown[] = []) => {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: method,
            method,
            params
          })
        });
        return response.json();
      };

      type EpochInfo = {
        epoch: number;
        slotIndex: number;
        slotsInEpoch: number;
        absoluteSlot: number;
        blockHeight: number;
        transactionCount: number | null;
      };

      type SupplyResult = {
        value: {
          total: number;
          circulating: number;
          nonCirculating: number;
        };
      };

      type VersionResult = {
        'solana-core': string;
        'feature-set': number;
      };

      // Fire all requests in parallel
      const [epochRes, supplyRes, versionRes] = await Promise.all([
        makeRequest('getEpochInfo'),
        makeRequest('getSupply'),
        makeRequest('getVersion')
      ]) as [
        { result: EpochInfo; error?: { message: string } },
        { result: SupplyResult; error?: { message: string } },
        { result: VersionResult; error?: { message: string } }
      ];

      // Check for errors
      const errors: string[] = [];
      if (epochRes.error) errors.push(`Epoch info: ${epochRes.error.message}`);
      if (supplyRes.error) errors.push(`Supply: ${supplyRes.error.message}`);
      if (versionRes.error) errors.push(`Version: ${versionRes.error.message}`);

      if (errors.length === 3) {
        return {
          content: [{
            type: 'text' as const,
            text: `**Network Status Error**\n\n${errors.join('\n')}`
          }]
        };
      }

      const lines = ['**Solana Network Status**', ''];

      // Epoch info
      if (epochRes.result) {
        const epoch = epochRes.result;
        const epochProgress = ((epoch.slotIndex / epoch.slotsInEpoch) * 100).toFixed(1);
        lines.push('**Epoch:**');
        lines.push(`- Current Epoch: ${epoch.epoch}`);
        lines.push(`- Progress: ${epochProgress}% (slot ${epoch.slotIndex.toLocaleString()} / ${epoch.slotsInEpoch.toLocaleString()})`);
        lines.push(`- Absolute Slot: ${epoch.absoluteSlot.toLocaleString()}`);
        lines.push(`- Block Height: ${epoch.blockHeight.toLocaleString()}`);
        if (epoch.transactionCount !== null) {
          lines.push(`- Transaction Count: ${epoch.transactionCount.toLocaleString()}`);
        }
        lines.push('');
      }

      // Supply
      if (supplyRes.result) {
        const supply = supplyRes.result.value;
        lines.push('**SOL Supply:**');
        lines.push(`- Total: ${formatSolCompact(supply.total)}`);
        lines.push(`- Circulating: ${formatSolCompact(supply.circulating)}`);
        lines.push(`- Non-Circulating: ${formatSolCompact(supply.nonCirculating)}`);
        lines.push('');
      }

      // Version
      if (versionRes.result) {
        lines.push(`**Cluster Version:** ${versionRes.result['solana-core']}`);
      }

      return {
        content: [{
          type: 'text' as const,
          text: lines.join('\n')
        }]
      };
    }
  );
}
