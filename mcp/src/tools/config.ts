import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { setApiKey, setNetwork, rpcRequest } from '../utils/helius.js';

export function registerConfigTools(server: McpServer) {
  server.tool(
    'setHeliusApiKey',
    'Configure the Helius API key for this session. Required before using any blockchain data tools. Get your API key from https://dashboard.helius.dev/api-keys. The key is validated by making a test request.',
    {
      apiKey: z.string().describe('Your Helius API key'),
      network: z.enum(['mainnet-beta', 'devnet']).optional().default('mainnet-beta').describe('Network to use (default: mainnet-beta)')
    },
    async ({ apiKey, network }) => {
      try {
        setApiKey(apiKey);
        if (network) {
          setNetwork(network);
        }

        // Validate with test request
        await rpcRequest('getBlockHeight');

        return {
          content: [{
            type: 'text' as const,
            text: `✅ Helius API key configured for ${network}!\n\nYou can now query the Solana blockchain.`
          }]
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: 'text' as const,
            text: `❌ Failed to configure API key: ${errorMsg}\n\nPlease check your key at https://dashboard.helius.dev/api-keys`
          }],
          isError: true
        };
      }
    }
  );
}
