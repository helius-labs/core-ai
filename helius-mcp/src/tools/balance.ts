import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getHeliusClient, hasApiKey } from '../utils/helius.js';
import { formatSol, formatAddress } from '../utils/formatters.js';
import { noApiKeyResponse } from './shared.js';
import { mcpText, getErrorMessage, handleToolError, addressError } from '../utils/errors.js';

export function registerBalanceTools(server: McpServer) {
  // Get SOL Balance
  server.tool(
    'getBalance',
    'Get native SOL balance for a Solana wallet address. Returns balance in both SOL and lamports (1 SOL = 1 billion lamports). Use this for checking how much SOL a wallet has. For token balances, use getTokenBalances instead.',
    {
      address: z.string().describe('Solana wallet address (base58 encoded, e.g. Gh4tdJhLP1s55xGfghHHvPNPPrNtaDjc6dzZJ374DGHJ)')
    },
    async ({ address }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      try {
        const helius = getHeliusClient();
        const balance = await helius.getBalance(address);
        const lamports = Number(balance.value);

        return mcpText(`**SOL Balance for ${formatAddress(address)}**\n\n${formatSol(lamports)} (${lamports.toLocaleString()} lamports)`);
      } catch (err) {
        return handleToolError(err, 'Error fetching balance', [
          addressError(`SOL Balance for ${formatAddress(address)}`, 'Invalid Solana address. Please provide a valid base58-encoded wallet address.'),
        ]);
      }
    }
  );

  // Get Token Balances
  server.tool(
    'getTokenBalances',
    'Get all SPL token balances for a Solana wallet with full token info: names, symbols, properly formatted amounts with decimals, and USD prices (when available). Includes fungible tokens like USDC, BONK, JUP, etc. Does NOT include NFTs — use getAssetsByOwner for NFTs. For native SOL balance, use getBalance instead. Automatically paginates to fetch all tokens using parallel requests for speed.',
    {
      address: z.string().describe('Solana wallet address (base58 encoded)')
    },
    async ({ address }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      const helius = getHeliusClient();

      type Asset = {
        id: string;
        interface: string;
        content?: { metadata?: { name?: string; symbol?: string } };
        token_info?: {
          symbol?: string;
          decimals?: number;
          balance?: number;
          price_info?: {
            price_per_token?: number;
            total_price?: number;
            currency?: string;
          };
        };
      };

      type PageResponse = {
        items?: Asset[];
        total?: number;
      };

      const PAGE_SIZE = 10;
      const MAX_ASSETS = 100;
      const MAX_PAGES = 10;

      // Helper to fetch a single page with retry on "too big" errors
      async function fetchPage(page: number, limit: number = PAGE_SIZE): Promise<{ items: Asset[]; hasMore: boolean }> {
        let currentLimit = limit;
        while (currentLimit >= 1) {
          try {
            const response: PageResponse = await helius.getAssetsByOwner({
              ownerAddress: address,
              page,
              limit: currentLimit,
              displayOptions: { showFungible: true }
            });
            const items = response.items || [];
            return { items, hasMore: items.length === currentLimit };
          } catch (err) {
            const errorMsg = getErrorMessage(err);
            if (errorMsg.includes('too big') || errorMsg.includes('Response is too big')) {
              if (currentLimit > 5) currentLimit = 5;
              else if (currentLimit > 2) currentLimit = 2;
              else if (currentLimit > 1) currentLimit = 1;
              else return { items: [], hasMore: false };
            } else {
              throw err;
            }
          }
        }
        return { items: [], hasMore: false };
      }

      // Step 1: Fetch first page to probe
      let firstResult;
      try {
        firstResult = await fetchPage(1);
      } catch (err) {
        return handleToolError(err, 'Error fetching token balances', [
          addressError(`Token Balances for ${formatAddress(address)}`, 'Invalid Solana address. Please provide a valid base58-encoded wallet address.'),
        ]);
      }
      const allAssets: Asset[] = [...firstResult.items];

      if (allAssets.length === 0) {
        return mcpText(`**Token Balances for ${formatAddress(address)}**\n\nNo tokens found.`);
      }

      // Step 2: If first page is full, fetch remaining pages in parallel
      if (firstResult.hasMore && allAssets.length < MAX_ASSETS) {
        let currentPage = 2;
        let hasMorePages = true;
        const BATCH_SIZE = 15;

        while (hasMorePages && allAssets.length < MAX_ASSETS && currentPage <= MAX_PAGES) {
          const batchPages = Array.from(
            { length: Math.min(BATCH_SIZE, MAX_PAGES - currentPage + 1) },
            (_, i) => currentPage + i
          );

          const results = await Promise.allSettled(batchPages.map(page => fetchPage(page)));

          let pagesWithData = 0;
          let lastPageWithData = -1;

          for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status === 'fulfilled' && result.value.items.length > 0) {
              allAssets.push(...result.value.items);
              pagesWithData++;
              lastPageWithData = i;
            }
          }

          hasMorePages = pagesWithData > 0 && lastPageWithData === batchPages.length - 1;
          currentPage += batchPages.length;
        }
      }

      const fungibleTokens = allAssets.filter((asset) =>
        asset.interface === 'FungibleToken' || asset.interface === 'FungibleAsset'
      );

      if (fungibleTokens.length === 0) {
        return mcpText(`**Token Balances for ${formatAddress(address)}**\n\nNo fungible tokens found.`);
      }

      // Enrich tokens missing name/symbol by fetching full asset data
      const unknownTokens = fungibleTokens.filter((asset) =>
        !asset.token_info?.symbol && !asset.content?.metadata?.symbol && !asset.content?.metadata?.name
      );

      if (unknownTokens.length > 0 && unknownTokens.length <= 10) {
        const enrichedData = await Promise.allSettled(
          unknownTokens.map((asset) => helius.getAsset({ id: asset.id }))
        );

        enrichedData.forEach((result, idx) => {
          if (result.status === 'fulfilled' && result.value) {
            const enriched = result.value as Asset;
            const original = unknownTokens[idx];
            if (enriched.content?.metadata) {
              original.content = original.content || {};
              original.content.metadata = enriched.content.metadata;
            }
            if (enriched.token_info?.symbol) {
              original.token_info = original.token_info || {};
              original.token_info.symbol = enriched.token_info.symbol;
            }
          }
        });
      }

      const lines: string[] = [];
      let totalUsdValue = 0;
      let tokensWithPrice = 0;

      fungibleTokens.forEach((asset) => {
        const symbol = asset.token_info?.symbol || asset.content?.metadata?.symbol;
        const name = asset.content?.metadata?.name;
        const decimals = asset.token_info?.decimals ?? 0;
        const balance = asset.token_info?.balance ?? 0;
        const totalPrice = asset.token_info?.price_info?.total_price;

        const formattedAmount = decimals > 0
          ? (balance / Math.pow(10, decimals)).toLocaleString(undefined, { maximumFractionDigits: Math.min(decimals, 6) })
          : balance.toLocaleString();

        const displayName = symbol || name || formatAddress(asset.id);
        let line = `- **${displayName}**: ${formattedAmount}`;

        if (totalPrice !== undefined && totalPrice > 0) {
          totalUsdValue += totalPrice;
          tokensWithPrice++;
          line += ` ($${totalPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
        }

        if (!symbol && !name) {
          line += ` — ${formatAddress(asset.id)}`;
        }

        lines.push(line);
      });

      let header = `**Token Balances for ${formatAddress(address)}** (${fungibleTokens.length} tokens)`;
      if (allAssets.length >= MAX_ASSETS) {
        header += ` — showing first ${MAX_ASSETS} assets`;
      }
      if (totalUsdValue > 0) {
        header += `\n**Total Value:** $${totalUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (tokensWithPrice < fungibleTokens.length) {
          header += ` (${tokensWithPrice}/${fungibleTokens.length} tokens have price data)`;
        }
      }

      return mcpText(`${header}\n\n${lines.join('\n')}`);
    }
  );
}
