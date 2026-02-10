import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { hasApiKey, restRequest } from '../utils/helius.js';
import { formatAddress, formatSol, formatTimestamp, LAMPORTS_PER_SOL } from '../utils/formatters.js';
import { noApiKeyResponse } from './shared.js';

export function registerWalletTools(server: McpServer) {
  // ─── Get Wallet Identity ───
  server.tool(
    'getWalletIdentity',
    'Identify known wallets (exchanges, protocols, institutions). Returns name, type, category, tags. Use this to check if a wallet belongs to a known entity like Binance, Coinbase, Jupiter, etc.',
    {
      address: z.string().describe('Solana wallet address (base58 encoded)')
    },
    async ({ address }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      try {
        const data = await restRequest(`/v1/wallet/${address}/identity`);

        const lines = ['**Wallet Identity**', ''];
        lines.push(`**Address:** ${formatAddress(address)}`);
        if (data.name) lines.push(`**Name:** ${data.name}`);
        if (data.type) lines.push(`**Type:** ${data.type}`);
        if (data.category) lines.push(`**Category:** ${data.category}`);
        if (data.tags && data.tags.length > 0) lines.push(`**Tags:** ${data.tags.join(', ')}`);

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (errorMsg.includes('404')) {
          return { content: [{ type: 'text' as const, text: `No identity found for ${formatAddress(address)}` }] };
        }
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
      }
    }
  );

  // ─── Batch Wallet Identity ───
  server.tool(
    'batchWalletIdentity',
    'Look up identities for up to 100 Solana addresses in one request. Returns known names, types, and categories for recognized wallets (exchanges, protocols, institutions).',
    {
      addresses: z.array(z.string()).describe('Array of Solana wallet addresses (max 100)')
    },
    async ({ addresses }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      if (addresses.length > 100) {
        return { content: [{ type: 'text' as const, text: 'Error: Maximum 100 addresses per batch request.' }], isError: true };
      }

      const data = await restRequest('/v1/wallet/batch-identity', {
        method: 'POST',
        body: JSON.stringify({ addresses })
      });

      const results = Array.isArray(data) ? data : [];
      if (results.length === 0) {
        return { content: [{ type: 'text' as const, text: `**Batch Identity Lookup** (${addresses.length} addresses)\n\nNo identities found.` }] };
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

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  // ─── Get Wallet Balances ───
  server.tool(
    'getWalletBalances',
    'Get all token and NFT balances with USD values, sorted by value. Includes SOL, SPL, Token-2022, and optionally NFTs. Different from getTokenBalances — this uses the Wallet API with USD pricing built-in.',
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

      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(Math.min(limit, 100)));
      if (showNfts) params.set('showNfts', 'true');
      if (showZeroBalance) params.set('showZeroBalance', 'true');
      if (!showNative) params.set('showNative', 'false');

      const data = await restRequest(`/v1/wallet/${address}/balances?${params.toString()}`);

      const lines = [`**Wallet Balances** (page ${page})`, ''];

      if (data.totalUsdValue !== undefined) {
        lines.push(`**Total Value:** $${Number(data.totalUsdValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, '');
      }

      // Native SOL balance
      if (data.nativeBalance !== undefined) {
        const solAmount = typeof data.nativeBalance === 'object'
          ? data.nativeBalance.lamports / LAMPORTS_PER_SOL
          : data.nativeBalance / LAMPORTS_PER_SOL;
        const usd = typeof data.nativeBalance === 'object' && data.nativeBalance.totalUsdValue
          ? ` ($${Number(data.nativeBalance.totalUsdValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
          : '';
        lines.push(`- **SOL**: ${solAmount.toLocaleString(undefined, { maximumFractionDigits: 9 })}${usd}`);
      }

      // Token balances
      const tokens = data.tokens || [];
      for (const token of tokens) {
        const symbol = token.symbol || token.name || formatAddress(token.mint || '');
        const amount = token.amount !== undefined
          ? Number(token.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })
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

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  // ─── Get Wallet History ───
  server.tool(
    'getWalletHistory',
    'Get transaction history with balance changes per transaction. Parsed, human-readable format from the Wallet API. Different from getTransactionHistory — returns balance changes per tx with simpler pagination.',
    {
      address: z.string().describe('Solana wallet address (base58 encoded)'),
      limit: z.number().optional().default(100).describe('Number of results (max 100)'),
      before: z.string().optional().describe('Pagination cursor — pass nextCursor from previous response'),
      after: z.string().optional().describe('Pagination cursor for forward pagination'),
      type: z.string().optional().describe('Filter by transaction type (e.g. SWAP, TRANSFER, NFT_SALE)'),
      tokenAccounts: z.enum(['none', 'balanceChanged', 'all']).optional().default('balanceChanged').describe('"none" = only direct transactions, "balanceChanged" = include token transfers (default), "all" = all token account activity')
    },
    async ({ address, limit, before, after, type, tokenAccounts }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      const params = new URLSearchParams();
      params.set('limit', String(Math.min(limit, 100)));
      if (before) params.set('before', before);
      if (after) params.set('after', after);
      if (type) params.set('type', type);
      if (tokenAccounts) params.set('tokenAccounts', tokenAccounts);

      const data = await restRequest(`/v1/wallet/${address}/history?${params.toString()}`);

      const transactions = data.transactions || data.history || (Array.isArray(data) ? data : []);

      if (transactions.length === 0) {
        return { content: [{ type: 'text' as const, text: `**Transaction History for ${formatAddress(address)}**\n\nNo transactions found.` }] };
      }

      const lines = [`**Transaction History** (${transactions.length} transactions)`, ''];

      transactions.forEach((tx: any, i: number) => {
        const time = tx.timestamp ? formatTimestamp(tx.timestamp) : 'N/A';
        const status = tx.transactionError ? 'Failed' : 'Success';
        const fee = tx.fee ? formatSol(tx.fee) : 'N/A';
        const txType = tx.type || 'UNKNOWN';

        lines.push(`${i + 1}. ${time} — ${status} — **${txType}** — Fee: ${fee}`);
        lines.push(`   Signature: \`${tx.signature}\``);

        if (tx.description) {
          lines.push(`   ${tx.description}`);
        }

        // Balance changes
        const changes: string[] = [];
        if (tx.nativeTransfers) {
          for (const nt of tx.nativeTransfers) {
            if (nt.amount && nt.amount !== 0) {
              const dir = nt.toUserAccount === address ? '+' : '-';
              changes.push(`${dir}${formatSol(Math.abs(nt.amount))}`);
            }
          }
        }
        if (tx.tokenTransfers) {
          for (const tt of tx.tokenTransfers) {
            const symbol = tt.symbol || tt.mint ? formatAddress(tt.mint) : 'unknown';
            const amount = tt.tokenAmount !== undefined ? tt.tokenAmount : 0;
            const dir = tt.toUserAccount === address ? '+' : '-';
            changes.push(`${dir}${Math.abs(amount).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${symbol}`);
          }
        }

        if (changes.length > 0) {
          lines.push(`   Balance Changes: ${changes.join(', ')}`);
        }

        lines.push('');
      });

      // Pagination
      const cursor = data.pagination?.nextCursor || data.nextCursor;
      if (cursor) {
        lines.push(`**Next Cursor:** \`${cursor}\``);
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  // ─── Get Wallet Transfers ───
  server.tool(
    'getWalletTransfers',
    'Get all token transfers with sender/recipient info, direction (in/out), and amounts. Focused on transfers only (not all tx types). Shows counterparty addresses and transfer direction.',
    {
      address: z.string().describe('Solana wallet address (base58 encoded)'),
      limit: z.number().optional().default(50).describe('Number of results (max 100)'),
      cursor: z.string().optional().describe('Pagination cursor from previous response')
    },
    async ({ address, limit, cursor }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      const params = new URLSearchParams();
      params.set('limit', String(Math.min(limit, 100)));
      if (cursor) params.set('cursor', cursor);

      const data = await restRequest(`/v1/wallet/${address}/transfers?${params.toString()}`);

      const transfers = data.transfers || (Array.isArray(data) ? data : []);

      if (transfers.length === 0) {
        return { content: [{ type: 'text' as const, text: `**Wallet Transfers for ${formatAddress(address)}**\n\nNo transfers found.` }] };
      }

      const lines = [`**Wallet Transfers** (${transfers.length} transfers)`, ''];

      transfers.forEach((t: any, i: number) => {
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
      const nextCursor = data.pagination?.cursor || data.cursor || data.nextCursor;
      if (nextCursor) {
        lines.push(`**Next Cursor:** \`${nextCursor}\``);
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  // ─── Get Wallet Funded By ───
  server.tool(
    'getWalletFundedBy',
    'Find the original funding source of a wallet (first SOL transfer). Shows funder identity if known (e.g. which exchange funded this wallet). Useful for wallet provenance and tracing.',
    {
      address: z.string().describe('Solana wallet address (base58 encoded)')
    },
    async ({ address }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      try {
        const data = await restRequest(`/v1/wallet/${address}/funded-by`);

        const lines = ['**Wallet Funding Source**', ''];

        const funderAddr = data.funder ? formatAddress(data.funder) : 'Unknown';
        const funderName = data.funderName ? ` (${data.funderName})` : '';
        lines.push(`**Funder:** ${funderAddr}${funderName}`);

        if (data.funderType) lines.push(`**Type:** ${data.funderType}`);
        if (data.amount !== undefined) {
          lines.push(`**Amount:** ${formatSol(data.amount)}`);
        }
        if (data.timestamp) lines.push(`**Date:** ${data.timestamp}`);
        if (data.explorerUrl) lines.push(`**Explorer:** ${data.explorerUrl}`);

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (errorMsg.includes('404')) {
          return { content: [{ type: 'text' as const, text: `No funding source found for ${formatAddress(address)}` }] };
        }
        return { content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }], isError: true };
      }
    }
  );
}
