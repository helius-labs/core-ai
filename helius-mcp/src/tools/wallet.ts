import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { HistoryTransaction, Transfer } from 'helius-sdk/wallet/types';
import { getHeliusClient, hasApiKey } from '../utils/helius.js';
import { formatAddress, formatSol, formatTimestamp } from '../utils/formatters.js';
import { noApiKeyResponse } from './shared.js';
import { mcpText, mcpError, validateEnum, handleToolError, http404Error, addressError } from '../utils/errors.js';

export function registerWalletTools(server: McpServer) {
  // ─── Get Wallet Identity ───
  server.tool(
    'getWalletIdentity',
    'BEST FOR: identifying a single known wallet. PREFER batchWalletIdentity for multiple addresses. Identify known wallets (exchanges, protocols, institutions). Returns name, type, category, tags. Credit cost: 100 credits.',
    {
      address: z.string().describe('Solana wallet address (base58 encoded)')
    },
    async ({ address }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      try {
        const client = getHeliusClient();
        const data = await client.wallet.getIdentity({ wallet: address });

        const lines = ['**Wallet Identity**', ''];
        lines.push(`**Address:** ${formatAddress(address)}`);
        if (data.name) lines.push(`**Name:** ${data.name}`);
        if (data.type) lines.push(`**Type:** ${data.type}`);
        if (data.category) lines.push(`**Category:** ${data.category}`);
        if (data.tags && data.tags.length > 0) lines.push(`**Tags:** ${data.tags.join(', ')}`);

        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error', [
          http404Error('', `No identity found for ${formatAddress(address)}`),
        ]);
      }
    }
  );

  // ─── Batch Wallet Identity ───
  server.tool(
    'batchWalletIdentity',
    'BEST FOR: identifying multiple wallets at once (up to 100). PREFER getWalletIdentity for a single address. Look up identities for up to 100 Solana addresses. Returns names, types, and categories. Credit cost: 100 credits.',
    {
      addresses: z.array(z.string()).describe('Array of Solana wallet addresses (base58 encoded, max 100)')
    },
    async ({ addresses }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      if (addresses.length > 100) {
        return mcpError(
          'Maximum 100 addresses per batch request.',
          { type: 'VALIDATION', code: 'TOO_MANY_ITEMS', retryable: false, recovery: 'Reduce batch to 100 or fewer addresses.' }
        );
      }

      try {
        const client = getHeliusClient();
        const results = await client.wallet.getBatchIdentity({ addresses });

        if (results.length === 0) {
          return mcpText(`**Batch Identity Lookup** (${addresses.length} addresses)\n\nNo identities found.`);
        }

        const lines = [`**Batch Identity Lookup** (${results.length} results)`, ''];

        for (const entry of results) {
          const addr = formatAddress(entry.address || '');
          if (entry.name) {
            lines.push(`- **${entry.name}** — ${addr}`);
            const details: string[] = [];
            if (entry.type) details.push(entry.type);
            if (entry.category) details.push(entry.category);
            if (details.length > 0) lines.push(`  ${details.join(' | ')}`);
          } else {
            lines.push(`- ${addr} — Unknown`);
          }
        }

        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching batch identities', [
          addressError('Batch Identity'),
        ]);
      }
    }
  );

  // ─── Get Wallet Balances ───
  server.tool(
    'getWalletBalances',
    'BEST FOR: complete portfolio view with USD values. PREFER getBalance for SOL-only, getTokenBalances for cheaper per-token lookups. Get all token and NFT balances with USD values, sorted by value. Includes SOL, SPL, Token-2022, and optionally NFTs. Credit cost: 100 credits.',
    {
      address: z.string().describe('Solana wallet address (base58 encoded)'),
      page: z.number().optional().default(1).describe('Page number (starts at 1)'),
      limit: z.number().optional().default(100).describe('Results per page (max 100)'),
      showNfts: z.boolean().optional().default(false).describe('Include NFT balances'),
      showZeroBalance: z.boolean().optional().default(false).describe('Include tokens with zero balance'),
      showNative: z.boolean().optional().default(true).describe('Include native SOL balance')
    },
    async ({ address, page, limit, showNfts, showZeroBalance, showNative }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      try {
        const client = getHeliusClient();
        const data = await client.wallet.getBalances({
          wallet: address,
          page,
          limit: Math.min(limit, 100),
          showNfts,
          showZeroBalance,
          showNative,
        });

        const lines = [`**Wallet Balances** (page ${page})`, ''];

        if (data.totalUsdValue !== undefined) {
          lines.push(`**Total Value:** $${Number(data.totalUsdValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, '');
        }

        // Token balances (includes native SOL when showNative=true)
        for (const token of data.balances) {
          const symbol = token.symbol || token.name || formatAddress(token.mint || '');
          const amount = token.balance !== undefined
            ? Number(token.balance).toLocaleString(undefined, { maximumFractionDigits: 9 })
            : '0';
          const usd = token.usdValue
            ? ` ($${Number(token.usdValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
            : '';
          lines.push(`- **${symbol}**: ${amount}${usd}`);
        }

        // NFTs summary
        if (data.nfts && data.nfts.length > 0) {
          lines.push('', `**NFTs:** ${data.nfts.length} found`);
          if (showNfts) {
            for (const nft of data.nfts.slice(0, 20)) {
              const name = nft.name || formatAddress(nft.mint || '');
              lines.push(`- ${name}`);
            }
            if (data.nfts.length > 20) {
              lines.push(`  ... +${data.nfts.length - 20} more`);
            }
          }
        }

        // Pagination
        if (data.pagination?.hasMore) {
          lines.push('', `*More results available — use page=${page + 1}*`);
        }

        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching wallet balances', [
          addressError('Wallet Balances'),
        ]);
      }
    }
  );

  // ─── Get Wallet History ───
  server.tool(
    'getWalletHistory',
    'BEST FOR: balance change deltas per transaction. PREFER getTransactionHistory for general history, getWalletTransfers for sends/receives. Get transaction history with balance changes per transaction. Credit cost: 100 credits. Requires Developer+ plan.',
    {
      address: z.string().describe('Solana wallet address (base58 encoded)'),
      limit: z.number().optional().default(100).describe('Number of results (max 100)'),
      before: z.string().optional().describe('Pagination cursor — pass nextCursor from previous response'),
      after: z.string().optional().describe('Pagination cursor for forward pagination'),
      type: z.string().optional().describe('Filter by transaction type (e.g. SWAP, TRANSFER, NFT_SALE)'),
      tokenAccounts: z.string().optional().default('balanceChanged').describe('"none" = only direct transactions, "balanceChanged" = include token transfers (default), "all" = all token account activity')
    },
    async ({ address, limit, before, after, type, tokenAccounts }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      const err = validateEnum(tokenAccounts, ['none', 'balanceChanged', 'all'], 'Wallet History Error', 'tokenAccounts');
      if (err) return err;

      try {
        const client = getHeliusClient();
        const data = await client.wallet.getHistory({
          wallet: address,
          limit: Math.min(limit, 100),
          before,
          after,
          type,
          tokenAccounts,
        });

        const transactions = data.data;

        if (transactions.length === 0) {
          return mcpText(`**Transaction History for ${formatAddress(address)}**\n\nNo transactions found.`);
        }

        const lines = [`**Transaction History** (${transactions.length} transactions)`, ''];

        transactions.forEach((tx: HistoryTransaction, i: number) => {
          const time = tx.timestamp ? formatTimestamp(tx.timestamp) : 'N/A';
          const status = tx.error ? 'Failed' : 'Success';
          const fee = tx.fee ? formatSol(tx.fee) : 'N/A';

          lines.push(`${i + 1}. ${time} — ${status} — Fee: ${fee}`);
          lines.push(`   Signature: \`${tx.signature}\``);

          // Balance changes
          if (tx.balanceChanges && tx.balanceChanges.length > 0) {
            const changes = tx.balanceChanges.map((bc: { mint: string; amount: number; decimals: number }) => {
              const sign = bc.amount >= 0 ? '+' : '';
              const symbol = bc.mint === 'SOL' ? 'SOL' : formatAddress(bc.mint);
              return `${sign}${Number(bc.amount).toLocaleString(undefined, { maximumFractionDigits: 9 })} ${symbol}`;
            });
            lines.push(`   Balance Changes: ${changes.join(', ')}`);
          }

          lines.push('');
        });

        // Pagination
        const cursor = data.pagination?.nextCursor;
        if (cursor) {
          lines.push(`**Next Cursor:** \`${cursor}\``);
        }

        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching wallet history', [
          addressError('Wallet History'),
        ]);
      }
    }
  );

  // ─── Get Wallet Transfers ───
  server.tool(
    'getWalletTransfers',
    'BEST FOR: tracking sends/receives with direction and counterparty. PREFER getTransactionHistory for general history, getWalletHistory for balance deltas. Get all token transfers with sender/recipient info, direction (in/out), and amounts. Credit cost: 100 credits.',
    {
      address: z.string().describe('Solana wallet address (base58 encoded)'),
      limit: z.number().optional().default(50).describe('Number of results (max 100)'),
      cursor: z.string().optional().describe('Pagination cursor from previous response')
    },
    async ({ address, limit, cursor }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      try {
        const client = getHeliusClient();
        const data = await client.wallet.getTransfers({
          wallet: address,
          limit: Math.min(limit, 100),
          cursor,
        });

        const transfers = data.data;

        if (transfers.length === 0) {
          return mcpText(`**Wallet Transfers for ${formatAddress(address)}**\n\nNo transfers found.`);
        }

        const lines = [`**Wallet Transfers** (${transfers.length} transfers)`, ''];

        transfers.forEach((t: Transfer, i: number) => {
          const direction = t.direction === 'in' ? 'Received' : 'Sent';
          const time = t.timestamp ? formatTimestamp(t.timestamp) : 'N/A';
          const symbol = t.symbol || (t.mint ? formatAddress(t.mint) : 'SOL');
          const amount = t.amount !== undefined ? Number(t.amount).toLocaleString(undefined, { maximumFractionDigits: 6 }) : '?';
          const counterparty = t.counterparty ? formatAddress(t.counterparty) : 'unknown';

          lines.push(`${i + 1}. **${direction}** — ${time}`);
          lines.push(`   ${amount} ${symbol} ${t.direction === 'in' ? 'from' : 'to'} ${counterparty}`);
          if (t.signature) lines.push(`   Signature: \`${t.signature}\``);
          lines.push('');
        });

        // Pagination
        const nextCursor = data.pagination?.nextCursor;
        if (nextCursor) {
          lines.push(`**Next Cursor:** \`${nextCursor}\``);
        }

        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching wallet transfers', [
          addressError('Wallet Transfers'),
        ]);
      }
    }
  );

  // ─── Get Wallet Funded By ───
  server.tool(
    'getWalletFundedBy',
    'BEST FOR: wallet provenance — who funded this wallet. PREFER getWalletIdentity for identifying a wallet entity. Find the original funding source of a wallet. Shows funder identity if known. Credit cost: 100 credits.',
    {
      address: z.string().describe('Solana wallet address (base58 encoded)')
    },
    async ({ address }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      try {
        const client = getHeliusClient();
        const data = await client.wallet.getFundedBy({ wallet: address });

        const lines = ['**Wallet Funding Source**', ''];

        const funderAddr = data.funder ? formatAddress(data.funder) : 'Unknown';
        const funderName = data.funderName ? ` (${data.funderName})` : '';
        lines.push(`**Funder:** ${funderAddr}${funderName}`);

        if (data.funderType) lines.push(`**Type:** ${data.funderType}`);
        if (data.amount !== undefined) {
          lines.push(`**Amount:** ${formatSol(data.amount)}`);
        }
        if (data.date) lines.push(`**Date:** ${data.date}`);
        if (data.explorerUrl) lines.push(`**Explorer:** ${data.explorerUrl}`);

        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error', [
          http404Error('', `No funding source found for ${formatAddress(address)}`),
        ]);
      }
    }
  );
}
