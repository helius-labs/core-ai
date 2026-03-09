import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getHeliusClient, hasApiKey } from '../utils/helius.js';
import { formatSolCompact } from '../utils/formatters.js';
import { noApiKeyResponse } from './shared.js';
import { mcpText, handleToolError } from '../utils/errors.js';

export function registerNetworkTools(server: McpServer) {
  server.tool(
    'getNetworkStatus',
    'BEST FOR: quick Solana network health check — epoch, slot, TPS, supply, version. Get current Solana network status including epoch info (current epoch, slot, progress), current TPS (transactions per second), total SOL supply, cluster version, and current block height. No parameters needed — gives a quick overview of blockchain health and state. Credit cost: 4 credits (4 standard RPC calls).',
    {},
    async () => {
      if (!hasApiKey()) return noApiKeyResponse();

      try {
        const helius = getHeliusClient();

        // Fire all requests in parallel — Kit returns bigint for numeric fields
        // wrapAutoSend in the SDK already calls .send() on pending RPC requests
        const [epochInfo, supplyResult, version, perfSamples] = await Promise.all([
          (helius as any).getEpochInfo(),
          (helius as any).getSupply(),
          (helius as any).getVersion(),
          (helius as any).getRecentPerformanceSamples(4),
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

        // TPS — averaged from 4 recent performance samples (~60s each, ~4 min window)
        // numTransactions includes vote + non-vote; numNonVoteTransactions is real user TPS
        if (Array.isArray(perfSamples) && perfSamples.length > 0) {
          let totalTx = 0;
          let totalNonVoteTx = 0;
          let totalSeconds = 0;
          let hasNonVoteData = false;
          for (const sample of perfSamples) {
            const samplePeriod = Number(sample.samplePeriodSecs);
            if (samplePeriod > 0) {
              totalTx += Number(sample.numTransactions);
              totalSeconds += samplePeriod;
              if (sample.numNonVoteTransactions != null) {
                totalNonVoteTx += Number(sample.numNonVoteTransactions);
                hasNonVoteData = true;
              }
            }
          }
          if (totalSeconds > 0) {
            const totalTps = Math.round(totalTx / totalSeconds);
            lines.push('**TPS (avg. last ~4 min):**');
            if (hasNonVoteData) {
              const nonVoteTps = Math.round(totalNonVoteTx / totalSeconds);
              lines.push(`- Real (non-vote): ~${nonVoteTps.toLocaleString()} tx/sec`);
              lines.push(`- Total (incl. vote): ~${totalTps.toLocaleString()} tx/sec`);
            } else {
              lines.push(`- Total: ~${totalTps.toLocaleString()} tx/sec (includes vote transactions)`);
            }
            lines.push('');
          }
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
