import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { setApiKey, setNetwork, hasApiKey, getHeliusClient } from '../utils/helius.js';
import { mcpText, validateEnum, getErrorMessage } from '../utils/errors.js';
import { setSharedApiKey, SHARED_CONFIG_PATH } from '../utils/config.js';

export function registerConfigTools(server: McpServer) {
  const keyFromEnv = hasApiKey();

  server.tool(
    'setHeliusApiKey',
    keyFromEnv
      ? 'API key is already configured via environment. You do NOT need to call this tool - just use the other Helius tools directly.'
      : 'Set an existing Helius API key for the current session. If the user does not have a key, use the agentic signup flow instead: generateKeypair → fund wallet → agenticSignup. Get a key at https://dashboard.helius.dev/api-keys',
    {
      apiKey: z.string().describe('Your Helius API key from https://dashboard.helius.dev/api-keys'),
      network: z.string().optional().default('mainnet-beta').describe('Network to use (default: mainnet-beta)')
    },
    async ({ apiKey, network }) => {
      const err = validateEnum(network, ['mainnet-beta', 'devnet'], 'API Key Error', 'network');
      if (err) return err;

      if (hasApiKey() && process.env.HELIUS_API_KEY) {
        return mcpText(`✅ API key is already configured via environment. You don't need to set it - just use the other Helius tools directly (getBalance, parseTransactions, getAsset, etc.)`);
      }

      setApiKey(apiKey);
      if (network) {
        setNetwork(network as 'mainnet-beta' | 'devnet');
      }

      try {
        const helius = getHeliusClient();
        await helius.getBlockHeight();
      } catch (e: unknown) {
        const errorMsg = getErrorMessage(e);
        if (errorMsg.includes('invalid api key') || errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
          setApiKey('');
          return mcpText(`❌ Invalid API key. Please check your key and try again.\n\nGet your key at https://dashboard.helius.dev/api-keys`);
        }
      }

      setSharedApiKey(apiKey);
      return mcpText(`✅ Helius API key configured for ${network} and saved to \`${SHARED_CONFIG_PATH}\`. You can now query the Solana blockchain.`);
    }
  );
}
