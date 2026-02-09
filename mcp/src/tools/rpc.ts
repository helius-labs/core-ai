import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { rpcRequest } from '../utils/helius.js';
import { formatAddress, formatSol } from '../utils/formatters.js';

export function registerRpcTools(server: McpServer) {
  server.tool(
    'getBalance',
    'Get SOL balance for any Solana wallet address using Helius high-performance RPC. Use this for all Solana balance queries. Returns balance in both lamports and SOL with formatted output.',
    {
      address: z.string().describe('Wallet address')
    },
    async ({ address }) => {
      try {
        const result = await rpcRequest('getBalance', [address]);
        const lamports = result.value || 0;
        return {
          content: [{
            type: 'text' as const,
            text: `**SOL Balance**\n\nAddress: ${formatAddress(address)}\nBalance: ${formatSol(lamports)}\n(${lamports.toLocaleString()} lamports)`
          }]
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `❌ Error: ${errorMsg}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'getAccountInfo',
    'Get detailed Solana account information using Helius RPC. Use this for any Solana account queries. Returns owner, balance, data size, and executable status.',
    {
      address: z.string().describe('Account address'),
      encoding: z.enum(['base58', 'base64', 'jsonParsed']).optional().default('base64').describe('Data encoding format')
    },
    async ({ address, encoding }) => {
      try {
        const result = await rpcRequest('getAccountInfo', [address, { encoding }]);
        const accountInfo = result.value;

        if (!accountInfo) {
          return {
            content: [{ type: 'text' as const, text: `Account ${formatAddress(address)} does not exist.` }]
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: `**Account Info**\n\nAddress: ${formatAddress(address)}\nOwner: ${formatAddress(accountInfo.owner)}\nBalance: ${formatSol(accountInfo.lamports)}\nData Size: ${accountInfo.data?.length || 0} bytes\nExecutable: ${accountInfo.executable ? 'Yes' : 'No'}`
          }]
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `❌ Error: ${errorMsg}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'getMultipleAccounts',
    'Get account information for up to 100 addresses in a single request. Much faster than calling getAccountInfo multiple times.',
    {
      addresses: z.array(z.string()).describe('Array of account addresses (up to 100)')
    },
    async ({ addresses }) => {
      try {
        if (addresses.length > 100) {
          return {
            content: [{ type: 'text' as const, text: '❌ Maximum 100 addresses per request' }],
            isError: true
          };
        }

        const result = await rpcRequest('getMultipleAccounts', [addresses]);
        const accounts = result.value || [];

        const lines = [`**Multiple Accounts** (${addresses.length} accounts)`, ''];
        accounts.forEach((acc: any, i: number) => {
          lines.push(`${i + 1}. ${formatAddress(addresses[i])}`);
          if (acc) {
            lines.push(`   Owner: ${formatAddress(acc.owner)}`);
            lines.push(`   Balance: ${formatSol(acc.lamports)}`);
          } else {
            lines.push(`   Status: Does not exist`);
          }
          lines.push('');
        });

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }]
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `❌ Error: ${errorMsg}` }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'getSignaturesForAddress',
    'Get confirmed transaction signatures for an address with optional filters. Returns chronological list of all transactions involving the address.',
    {
      address: z.string().describe('Account address'),
      limit: z.number().optional().default(20).describe('Max signatures to return (max 1000)'),
      before: z.string().optional().describe('Start searching backwards from this signature'),
      until: z.string().optional().describe('Search until this signature')
    },
    async ({ address, limit, before, until }) => {
      try {
        const options: any = { limit };
        if (before) options.before = before;
        if (until) options.until = until;

        const signatures = await rpcRequest('getSignaturesForAddress', [address, options]);

        if (!signatures || signatures.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `**Signatures for ${formatAddress(address)}**\n\nNo transactions found.` }]
          };
        }

        const lines = [`**Signatures for ${formatAddress(address)}** (${signatures.length} signatures)`, ''];
        signatures.forEach((sig: any, i: number) => {
          lines.push(`${i + 1}. ${sig.signature}`);
          if (sig.blockTime) {
            const date = new Date(sig.blockTime * 1000).toLocaleString();
            lines.push(`   Time: ${date}`);
          }
          if (sig.err) {
            lines.push(`   Status: ❌ Error`);
          }
          lines.push('');
        });

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }]
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `❌ Error: ${errorMsg}` }],
          isError: true
        };
      }
    }
  );
}
