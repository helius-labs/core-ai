import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { setApiKey, setNetwork, hasApiKey, getHeliusClient } from '../utils/helius.js';

export function registerConfigTools(server: McpServer) {
  // Check API key status tool - always works, helps users understand state
  server.tool(
    'getHeliusApiKeyStatus',
    'Check if a Helius API key is configured. Use this to see if you need to set an API key before using data tools.',
    {},
    async () => {
      const hasKey = hasApiKey();
      const fromEnv = !!process.env.HELIUS_API_KEY;

      if (hasKey) {
        return {
          content: [{
            type: 'text' as const,
            text: fromEnv
              ? 'API key is configured via environment variable. Ready to use all Helius tools.'
              : 'API key is configured for this session. Ready to use all Helius tools.'
          }]
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: [
            'No Helius API key configured.',
            '',
            'To use Helius data tools, you need to set an API key:',
            '',
            '**Option 1: Use setHeliusApiKey tool**',
            '```',
            'Tool: setHeliusApiKey',
            'Arguments: { "apiKey": "your-api-key" }',
            '```',
            '',
            '**Option 2: Set environment variable**',
            'Add to your MCP config:',
            '```',
            '"env": { "HELIUS_API_KEY": "your-api-key" }',
            '```',
            '',
            '**Get your free API key at: https://dashboard.helius.dev/api-keys**',
            '',
            'Note: Guide tools (getRateLimitInfo, getSenderInfo, etc.) work without an API key.',
          ].join('\n')
        }]
      };
    }
  );

  server.tool(
    'setHeliusApiKey',
    'Set the Helius API key for the current session. Required before using data tools (getBalance, getAsset, etc.). Get your free API key at https://dashboard.helius.dev/api-keys',
    {
      apiKey: z.string().describe('Your Helius API key from https://dashboard.helius.dev/api-keys'),
      network: z.enum(['mainnet', 'devnet']).optional().default('mainnet').describe('Network to use (default: mainnet)')
    },
    async ({ apiKey, network }) => {
      setApiKey(apiKey);
      if (network) {
        setNetwork(network);
      }

      // Validate the key by making a simple request
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
              text: [
                'Invalid API key. The key was rejected by the Helius API.',
                '',
                'Please check your key and try again.',
                '',
                'Get your free API key at: https://dashboard.helius.dev/api-keys',
              ].join('\n')
            }],
            isError: true
          };
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: [
            `Helius API key configured. (default network: ${network})`,
            '',
            'Your API key works for both mainnet and devnet. To switch networks:',
            '- mainnet: https://mainnet.helius-rpc.com/?api-key=YOUR_KEY',
            '- devnet: https://devnet.helius-rpc.com/?api-key=YOUR_KEY',
            '',
            'You can now use all Helius tools:',
            '- getBalance, getTokenBalances - Check wallet balances',
            '- getAsset, searchAssets - Query NFTs and tokens',
            '- parseTransactions - Decode transaction history',
            '- getWalletHistory, getWalletIdentity - Wallet analysis',
            '- createWebhook, getAllWebhooks - Manage webhooks',
            '- And many more! Ask me anything about Solana.',
          ].join('\n')
        }]
      };
    }
  );
}
