import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { setApiKey, setNetwork, hasApiKey, getHeliusClient } from '../utils/helius.js';

export function registerConfigTools(server: McpServer) {
  const keyFromEnv = hasApiKey();

  server.tool(
    'setHeliusApiKey',
    keyFromEnv
      ? 'API key is already configured via environment. You do NOT need to call this tool - just use the other Helius tools directly.'
      : 'Set the Helius API key for the current session. Required before using any other Helius tools. The key is stored in memory only and not persisted to disk. Get your key at https://dashboard.helius.dev/api-keys',
    {
      apiKey: z.string().describe('Your Helius API key from https://dashboard.helius.dev/api-keys'),
      network: z.enum(['mainnet-beta', 'devnet']).optional().default('mainnet-beta').describe('Network to use (default: mainnet-beta)')
    },
    async ({ apiKey, network }) => {
      if (hasApiKey() && process.env.HELIUS_API_KEY) {
        return {
          content: [{
            type: 'text' as const,
            text: `✅ API key is already configured via environment. You don't need to set it - just use the other Helius tools directly (getBalance, parseTransactions, getAsset, etc.)`
          }]
        };
      }

      setApiKey(apiKey);
      if (network) {
        setNetwork(network);
      }

      try {
        const helius = getHeliusClient();
        await helius.getBlockHeight();
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (errorMsg.includes('invalid api key') || errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
          setApiKey('');
          return {
            content: [{
              type: 'text' as const,
              text: `❌ Invalid API key. Please check your key and try again.\n\nGet your key at https://dashboard.helius.dev/api-keys`
            }]
          };
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Helius API key configured for ${network}! You can now query the Solana blockchain.`
        }]
      };
    }
  );
}
