import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getHeliusClient, hasApiKey, getRpcUrl } from '../utils/helius.js';
import { formatAddress, formatSol } from '../utils/formatters.js';
import { noApiKeyResponse } from './shared.js';

function formatParsedAccountData(account: {
  data: unknown;
  lamports: number;
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
  // Get Account Info (single or batch) — uses direct JSON-RPC
  server.tool(
    'getAccountInfo',
    'Get detailed Solana account information for one or more accounts. For a single account: returns owner program, lamport balance, data size, executable status, and rent epoch. For batch: pass up to 100 addresses in "addresses" for fast bulk lookups. Use jsonParsed encoding (default) on token mint addresses to see Token-2022 extensions, authorities, and supply data. Use this to inspect any on-chain account.',
    {
      address: z.string().optional().describe('Single account address (base58 encoded). Use this OR addresses, not both.'),
      addresses: z.array(z.string()).optional().describe('Array of account addresses for batch lookup (up to 100). Use this OR address, not both.'),
      encoding: z.enum(['base58', 'base64', 'jsonParsed']).optional().default('jsonParsed').describe('Data encoding format')
    },
    async ({ address, addresses, encoding }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      const url = getRpcUrl();

      // Validate: must provide exactly one of address or addresses
      if (!address && (!addresses || addresses.length === 0)) {
        return {
          content: [{
            type: 'text' as const,
            text: `**Error:** Provide either \`address\` (single account) or \`addresses\` (batch of up to 100).`
          }]
        };
      }

      if (address && addresses && addresses.length > 0) {
        return {
          content: [{
            type: 'text' as const,
            text: `**Error:** Provide either \`address\` or \`addresses\`, not both.`
          }]
        };
      }

      type AccountInfo = {
        lamports: number;
        owner: string;
        data: unknown;
        executable: boolean;
        rentEpoch: number;
        space?: number;
      };

      // --- Batch mode ---
      if (addresses && addresses.length > 0) {
        if (addresses.length > 100) {
          return {
            content: [{
              type: 'text' as const,
              text: `**Error:** Maximum 100 accounts per request. You provided ${addresses.length}.`
            }]
          };
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'get-multiple-accounts',
            method: 'getMultipleAccounts',
            params: [addresses, { encoding }]
          })
        });

        type ApiResponse = {
          result?: { value: (AccountInfo | null)[] };
          error?: { message: string };
        };

        const data = await response.json() as ApiResponse;

        if (data.error) {
          return {
            content: [{
              type: 'text' as const,
              text: `**Error**\n\n${data.error.message}`
            }]
          };
        }

        const accounts = data.result?.value || [];
        const lines = [`**Multiple Accounts** (${addresses.length} requested)`, ''];

        addresses.forEach((addr, i) => {
          const account = accounts[i];
          if (!account) {
            lines.push(`**${formatAddress(addr)}:** Not found`);
          } else {
            lines.push(`**${formatAddress(addr)}**`);
            lines.push(`  Balance: ${formatSol(account.lamports)}`);
            lines.push(`  Owner: ${account.owner}`);
            lines.push(`  Executable: ${account.executable ? 'Yes' : 'No'}`);
            if (account.space !== undefined) {
              lines.push(`  Data Size: ${account.space} bytes`);
            }
            // Show parsed data (Token-2022 extensions, mint info, etc.)
            const parsedLines = formatParsedAccountData(account);
            lines.push(...parsedLines);
          }
          lines.push('');
        });

        return {
          content: [{
            type: 'text' as const,
            text: lines.join('\n')
          }]
        };
      }

      // --- Single account mode ---
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-account-info',
          method: 'getAccountInfo',
          params: [address, { encoding }]
        })
      });

      type ApiResponse = {
        result?: { value: AccountInfo | null };
        error?: { message: string };
      };

      const data = await response.json() as ApiResponse;

      if (data.error) {
        return {
          content: [{
            type: 'text' as const,
            text: `**Error**\n\n${data.error.message}`
          }]
        };
      }

      const account = data.result?.value;

      if (!account) {
        return {
          content: [{
            type: 'text' as const,
            text: `**Account ${formatAddress(address!)}**\n\nAccount not found or has no data.`
          }]
        };
      }

      const lines = [
        `**Account ${formatAddress(address!)}**`,
        '',
        `**Balance:** ${formatSol(account.lamports)} (${account.lamports.toLocaleString()} lamports)`,
        `**Owner:** ${account.owner}`,
        `**Executable:** ${account.executable ? 'Yes' : 'No'}`,
      ];

      if (account.space !== undefined) {
        lines.push(`**Data Size:** ${account.space} bytes`);
      }

      // Show parsed data details when using jsonParsed
      const parsedLines = formatParsedAccountData(account);
      if (parsedLines.length > 0) {
        lines.push('', '**Parsed Data:**');
        lines.push(...parsedLines);
      }

      return {
        content: [{
          type: 'text' as const,
          text: lines.join('\n')
        }]
      };
    }
  );

  // Get Token Accounts
  server.tool(
    'getTokenAccounts',
    'Query token accounts with advanced filters. Can filter by mint address, owner address, or both. Returns token account addresses and balances.',
    {
      owner: z.string().optional().describe('Filter by owner wallet address'),
      mint: z.string().optional().describe('Filter by token mint address'),
      page: z.number().optional().default(1).describe('Page number (starts at 1)'),
      limit: z.number().optional().default(20).describe('Results per page (max 1000)')
    },
    async ({ owner, mint, page, limit }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      const helius = getHeliusClient();

      if (!owner && !mint) {
        return {
          content: [{
            type: 'text' as const,
            text: `**Error:** You must provide at least one of: owner or mint address.`
          }]
        };
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

      const response = await helius.getTokenAccounts(params);

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
        return {
          content: [{
            type: 'text' as const,
            text: `**Token Accounts** (${filterDesc})\n\nNo token accounts found.`
          }]
        };
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

      return {
        content: [{
          type: 'text' as const,
          text: lines.join('\n')
        }]
      };
    }
  );

  // Get Program Accounts (V2 with pagination)
  server.tool(
    'getProgramAccounts',
    'Get all accounts owned by a specific program. Returns account addresses, balances, and data sizes. Use dataSize to filter by account data length (e.g. 165 for token accounts). Useful for finding all accounts created by a program like a DEX, lending protocol, or custom program.',
    {
      programId: z.string().describe('Program ID (base58 encoded) — the owner program of the accounts to find'),
      limit: z.number().optional().default(20).describe('Maximum accounts to return (default 20, max 100)'),
      encoding: z.enum(['base58', 'base64', 'jsonParsed']).optional().default('base64').describe('Data encoding format'),
      dataSize: z.number().optional().describe('Filter by exact account data size in bytes (e.g. 165 for SPL token accounts)'),
      paginationKey: z.string().optional().describe('Pagination cursor from a previous response to fetch the next page')
    },
    async ({ programId, limit, encoding, dataSize, paginationKey }) => {
      if (!hasApiKey()) return noApiKeyResponse();

      const url = getRpcUrl();

      const cappedLimit = Math.min(limit, 10_000);

      type Filter = { dataSize: number };
      const filters: Filter[] = [];
      if (dataSize !== undefined) {
        filters.push({ dataSize });
      }

      type RpcParams = {
        encoding: string;
        dataSlice: { offset: number; length: number };
        limit: number;
        filters?: Filter[];
        paginationKey?: string;
      };

      const rpcParams: RpcParams = {
        encoding,
        dataSlice: { offset: 0, length: 0 },
        limit: cappedLimit
      };
      if (filters.length > 0) rpcParams.filters = filters;
      if (paginationKey) rpcParams.paginationKey = paginationKey;

      const requestBody = {
        jsonrpc: '2.0',
        id: 'get-program-accounts-v2',
        method: 'getProgramAccountsV2',
        params: [programId, rpcParams]
      };

      type AccountResult = {
        pubkey: string;
        account: {
          lamports: number;
          owner: string;
          data: unknown;
          executable: boolean;
          rentEpoch: number;
          space: number;
        };
      };

      type ApiResponse = {
        result?: {
          accounts: AccountResult[];
          paginationKey?: string | null;
          totalResults?: number;
        };
        error?: { message: string };
      };

      let data: ApiResponse;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });
        data = await response.json() as ApiResponse;
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: `**Error fetching program accounts:** ${err instanceof Error ? err.message : String(err)}`
          }]
        };
      }

      if (data.error) {
        return {
          content: [{
            type: 'text' as const,
            text: `**Error**\n\n${data.error.message}`
          }]
        };
      }

      const accounts = data.result?.accounts || [];

      if (accounts.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: `**Program Accounts for ${formatAddress(programId)}**\n\nNo accounts found.`
          }]
        };
      }

      const totalLabel = data.result?.totalResults
        ? `${data.result.totalResults.toLocaleString()} total`
        : `${accounts.length} returned`;
      const lines = [`**Program Accounts for ${formatAddress(programId)}** (${totalLabel})`, ''];

      accounts.forEach((item) => {
        lines.push(`- **${formatAddress(item.pubkey)}**`);
        lines.push(`  Balance: ${formatSol(item.account.lamports)}`);
        if (item.account.space !== undefined) {
          lines.push(`  Data Size: ${item.account.space} bytes`);
        }
        lines.push(`  Executable: ${item.account.executable ? 'Yes' : 'No'}`);
      });

      if (data.result?.paginationKey) {
        lines.push('', `**Next Page:** Pass \`paginationKey: "${data.result.paginationKey}"\` to fetch the next page.`);
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
