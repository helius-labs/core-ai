import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getHeliusClient, hasApiKey } from '../utils/helius.js';
import { formatAddress, formatTokenAmount } from '../utils/formatters.js';
import { noApiKeyResponse } from './shared.js';
import { mcpText, handleToolError, addressError } from '../utils/errors.js';

export function registerTokenTools(server: McpServer) {
  server.tool(
    'getTokenHolders',
    'Get the top 20 holders of a specific SPL token by mint address. Returns holder wallet addresses and their token balances (raw amounts). Useful for checking token distribution, finding whale wallets, or verifying token decentralization. Credit cost: ~20 credits/call (10 for token accounts + 10 for token metadata via DAS API).',
    {
      mint: z.string().describe('Token mint address (base58 encoded)')
    },
    async ({ mint }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      const helius = getHeliusClient();

      // Use getTokenAccounts to find top holders
      let response;
      try {
        response = await helius.getTokenAccounts({
          mint,
          page: 1,
          limit: 20
        });
      } catch (err) {
        return handleToolError(err, 'Error fetching token holders', [
          addressError(`Token Holders for ${formatAddress(mint || '(empty)')}`, 'Invalid Solana address. Please provide a valid base58-encoded mint address.'),
        ]);
      }

      type TokenAccount = {
        address: string;
        owner: string;
        amount: number;
        frozen?: boolean;
        delegated_amount?: number;
      };

      const items = (response.token_accounts || []) as TokenAccount[];

      if (items.length === 0) {
        return mcpText(`**Token Holders for ${formatAddress(mint)}**\n\nNo holders found.`);
      }

      // Sort by amount descending (largest holders first)
      items.sort((a, b) => b.amount - a.amount);

      // Enrich with token metadata for display
      type AssetInfo = {
        content?: { metadata?: { name?: string; symbol?: string } };
        token_info?: { symbol?: string; decimals?: number };
      };

      let symbol: string | undefined;
      let decimals = 0;

      try {
        const asset = await helius.getAsset({ id: mint }) as AssetInfo;
        symbol = asset?.token_info?.symbol || asset?.content?.metadata?.symbol || asset?.content?.metadata?.name;
        decimals = asset?.token_info?.decimals ?? 0;
      } catch {
        // Continue without metadata
      }

      const tokenLabel = symbol || formatAddress(mint);
      const lines = [`**Top Holders of ${tokenLabel}** (${response.total || items.length} total holders)`, ''];

      items.forEach((account, idx) => {
        const formattedAmount = decimals > 0
          ? formatTokenAmount(account.amount, decimals)
          : account.amount.toLocaleString();

        const flags: string[] = [];
        if (account.frozen) flags.push('Frozen');
        if (account.delegated_amount && account.delegated_amount > 0) flags.push('Delegated');
        const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';

        lines.push(`${idx + 1}. **${formatAddress(account.owner)}** — ${formattedAmount} ${symbol || ''}${flagStr}`);
      });

      return mcpText(lines.join('\n'));
    }
  );
}
