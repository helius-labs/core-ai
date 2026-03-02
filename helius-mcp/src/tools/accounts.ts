import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getHeliusClient, hasApiKey } from '../utils/helius.js';
import { formatAddress, formatSol } from '../utils/formatters.js';
import { noApiKeyResponse } from './shared.js';
import { mcpText, validateEnum, handleToolError, addressError, paginationError } from '../utils/errors.js';

function formatParsedAccountData(account: {
  data: unknown;
  lamports: number | bigint;
  owner: string;
  executable: boolean;
  space?: number;
}): string[] {
  type ParsedData = {
    parsed?: { type?: string; info?: Record<string, unknown> };
    program?: string;
    space?: number;
  };

  const lines: string[] = [];
  const parsedData = account.data as ParsedData;
  if (parsedData?.program) {
    lines.push(`  Program: ${parsedData.program}`);
  }
  if (parsedData?.parsed?.type) {
    lines.push(`  Account Type: ${parsedData.parsed.type}`);
  }
  if (parsedData?.parsed?.info) {
    for (const [key, value] of Object.entries(parsedData.parsed.info)) {
      const display = typeof value === 'object' ? JSON.stringify(value) : String(value);
      lines.push(`  ${key}: ${display}`);
    }
  }
  return lines;
}

export function registerAccountTools(server: McpServer) {
  // Get Account Info (single or batch) — uses SDK standard Solana RPC (Kit, bigint)
  server.tool(
    'getAccountInfo',
    'BEST FOR: raw on-chain account inspection (owner program, data size, executable status, Token-2022 extensions). PREFER getAsset for token/NFT metadata. PREFER getBalance for SOL balance. Get detailed Solana account information for one or more accounts. For a single account: returns owner program, lamport balance, data size, executable status, and rent epoch. For batch: pass up to 100 addresses in "addresses" for fast bulk lookups. Use jsonParsed encoding (default) on token mint addresses to see Token-2022 extensions, authorities, and supply data. Use this to inspect any on-chain account. Credit cost: 1 credit (standard RPC).',
    {
      address: z.string().optional().describe('Single account address (base58 encoded). Use this OR addresses, not both.'),
      addresses: z.array(z.string()).optional().describe('Array of account addresses for batch lookup (base58 encoded, up to 100). Use this OR address, not both.'),
      encoding: z.string().optional().default('jsonParsed').describe('Data encoding format')
    },
    async ({ address, addresses, encoding }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      const err = validateEnum(encoding, ['base58', 'base64', 'jsonParsed'], 'Account Info Error', 'encoding');
      if (err) return err;

      // Validate: must provide exactly one of address or addresses
      if (!address && (!addresses || addresses.length === 0)) {
        return mcpText(`**Error:** Provide either \`address\` (single account) or \`addresses\` (batch of up to 100).`);
      }

      if (address && addresses && addresses.length > 0) {
        return mcpText(`**Error:** Provide either \`address\` or \`addresses\`, not both.`);
      }

      try {
        const helius = getHeliusClient();

        // --- Batch mode ---
        if (addresses && addresses.length > 0) {
          if (addresses.length > 100) {
            return mcpText(`**Error:** Maximum 100 accounts per request. You provided ${addresses.length}.`);
          }

          const result = await (helius as any).getMultipleAccounts(addresses, { encoding });
          const accounts = result?.value || [];
          const lines = [`**Multiple Accounts** (${addresses.length} requested)`, ''];

          addresses.forEach((addr: string, i: number) => {
            const account = accounts[i];
            if (!account) {
              lines.push(`**${formatAddress(addr)}:** Not found`);
            } else {
              lines.push(`**${formatAddress(addr)}**`);
              lines.push(`  Balance: ${formatSol(Number(account.lamports))}`);
              lines.push(`  Owner: ${account.owner}`);
              lines.push(`  Executable: ${account.executable ? 'Yes' : 'No'}`);
              if (account.space !== undefined) {
                lines.push(`  Data Size: ${Number(account.space)} bytes`);
              }
              const parsedLines = formatParsedAccountData({ ...account, lamports: Number(account.lamports) });
              lines.push(...parsedLines);
            }
            lines.push('');
          });

          return mcpText(lines.join('\n'));
        }

        // --- Single account mode ---
        const result = await (helius as any).getAccountInfo(address, { encoding });
        const account = result?.value;

        if (!account) {
          return mcpText(`**Account ${formatAddress(address!)}**\n\nAccount not found or has no data.`);
        }

        const lamports = Number(account.lamports);
        const lines = [
          `**Account ${formatAddress(address!)}**`,
          '',
          `**Balance:** ${formatSol(lamports)} (${lamports.toLocaleString()} lamports)`,
          `**Owner:** ${account.owner}`,
          `**Executable:** ${account.executable ? 'Yes' : 'No'}`,
        ];

        if (account.space !== undefined) {
          lines.push(`**Data Size:** ${Number(account.space)} bytes`);
        }

        const parsedLines = formatParsedAccountData({ ...account, lamports });
        if (parsedLines.length > 0) {
          lines.push('', '**Parsed Data:**');
          lines.push(...parsedLines);
        }

        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching account info', [
          addressError('Account Info'),
        ]);
      }
    }
  );

  // Get Token Accounts
  server.tool(
    'getTokenAccounts',
    'BEST FOR: advanced token account queries with flexible filters (by mint, owner, or both). PREFER getTokenHolders for a quick top-holders list. PREFER getTokenBalances for a wallet\'s token holdings with prices. Query token accounts with advanced filters. Can filter by mint address, owner address, or both. Returns token account addresses and balances. Credit cost: 10 credits/call (DAS API).',
    {
      owner: z.string().optional().describe('Filter by owner wallet address (base58 encoded)'),
      mint: z.string().optional().describe('Filter by token mint address (base58 encoded)'),
      page: z.number().optional().default(1).describe('Page number (starts at 1)'),
      limit: z.number().optional().default(20).describe('Results per page (max 1000)')
    },
    async ({ owner, mint, page, limit }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      const helius = getHeliusClient();

      if (!owner && !mint) {
        return mcpText(`**Error:** You must provide at least one of: owner or mint address.`);
      }

      type TokenAccountParams = {
        page: number;
        limit: number;
        owner?: string;
        mint?: string;
      };

      const params: TokenAccountParams = { page, limit };
      if (owner) params.owner = owner;
      if (mint) params.mint = mint;

      let response;
      try {
        response = await helius.getTokenAccounts(params);
      } catch (err) {
        return handleToolError(err, 'Error fetching token accounts', [
          addressError('Token Accounts', 'Invalid Solana address. Please provide valid base58-encoded addresses for owner and/or mint.'),
          paginationError('Token Accounts'),
        ]);
      }

      type TokenAccount = {
        address: string;
        mint: string;
        owner: string;
        amount: number;
        delegated_amount?: number;
        frozen?: boolean;
      };

      const items = (response.token_accounts || []) as TokenAccount[];

      if (items.length === 0) {
        const filterDesc = owner && mint
          ? `owner=${formatAddress(owner)}, mint=${formatAddress(mint)}`
          : owner
            ? `owner=${formatAddress(owner)}`
            : `mint=${formatAddress(mint!)}`;
        return mcpText(`**Token Accounts** (${filterDesc})\n\nNo token accounts found.`);
      }

      const lines = [`**Token Accounts** (${response.total || items.length} total, page ${page})`, ''];

      items.forEach((account) => {
        const flags: string[] = [];
        if (account.frozen) flags.push('Frozen');
        if (account.delegated_amount && account.delegated_amount > 0) flags.push('Delegated');
        const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';

        lines.push(`- **Account:** ${formatAddress(account.address)}${flagStr}`);
        lines.push(`  Mint: ${formatAddress(account.mint)}`);
        lines.push(`  Owner: ${formatAddress(account.owner)}`);
        lines.push(`  Amount: ${account.amount.toLocaleString()}`);
        if (account.delegated_amount && account.delegated_amount > 0) {
          lines.push(`  Delegated: ${account.delegated_amount.toLocaleString()}`);
        }
        lines.push('');
      });

      return mcpText(lines.join('\n'));
    }
  );

  // Get Program Accounts (V2 with pagination) — uses SDK RpcCaller (no bigint)
  server.tool(
    'getProgramAccounts',
    'BEST FOR: investigating protocol state — finding DEX pools, lending positions, or all accounts created by a specific program. PREFER searchAssets for NFT/token asset searches by creator or authority. Get all accounts owned by a specific program. Returns account addresses, balances, and data sizes. Use dataSize to filter by account data length (e.g. 165 for token accounts). Useful for finding all accounts created by a program like a DEX, lending protocol, or custom program. Credit cost: 10 credits/call.',
    {
      programId: z.string().describe('Program ID (base58 encoded) — the owner program of the accounts to find'),
      limit: z.number().optional().default(20).describe('Maximum accounts to return (default 20, max 100)'),
      encoding: z.string().optional().default('base64').describe('Data encoding format'),
      dataSize: z.number().optional().describe('Filter by exact account data size in bytes (e.g. 165 for SPL token accounts)'),
      paginationKey: z.string().optional().describe('Pagination cursor from a previous response to fetch the next page')
    },
    async ({ programId, limit, encoding, dataSize, paginationKey }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      const encErr = validateEnum(encoding, ['base58', 'base64', 'jsonParsed'], 'Program Accounts Error', 'encoding');
      if (encErr) return encErr;

      const helius = getHeliusClient();
      const cappedLimit = Math.min(limit, 10_000);

      type Filter = { dataSize: number };
      const filters: Filter[] = [];
      if (dataSize !== undefined) {
        filters.push({ dataSize });
      }

      const rpcParams: any = {
        encoding,
        dataSlice: { offset: 0, length: 0 },
        limit: cappedLimit
      };
      if (filters.length > 0) rpcParams.filters = filters;
      if (paginationKey) rpcParams.paginationKey = paginationKey;

      try {
        const data = await helius.getProgramAccountsV2([programId, rpcParams]);

        // SDK returns result directly (or may wrap in RpcResponse with context/value)
        const result = (data as any).value ?? data;
        const accounts = result?.accounts || [];

        if (accounts.length === 0) {
          return mcpText(`**Program Accounts for ${formatAddress(programId)}**\n\nNo accounts found.`);
        }

        const totalLabel = result?.totalResults
          ? `${result.totalResults.toLocaleString()} total`
          : `${accounts.length} returned`;
        const lines = [`**Program Accounts for ${formatAddress(programId)}** (${totalLabel})`, ''];

        accounts.forEach((item: any) => {
          lines.push(`- **${formatAddress(item.pubkey)}**`);
          lines.push(`  Balance: ${formatSol(item.account.lamports)}`);
          if (item.account.space !== undefined) {
            lines.push(`  Data Size: ${item.account.space} bytes`);
          }
          lines.push(`  Executable: ${item.account.executable ? 'Yes' : 'No'}`);
        });

        if (result?.paginationKey) {
          lines.push('', `**Next Page:** Pass \`paginationKey: "${result.paginationKey}"\` to fetch the next page.`);
        }

        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching program accounts', [
          addressError('Program Accounts'),
        ]);
      }
    }
  );
}
