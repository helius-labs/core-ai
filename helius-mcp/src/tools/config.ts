import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { setApiKey, setNetwork, hasApiKey, getHeliusClient } from '../utils/helius.js';
import { isSharedCredentialMode } from '../utils/runtime.js';
import { mcpText, mcpError, validateEnum, getErrorMessage } from '../utils/errors.js';
import { setSharedApiKey, SHARED_CONFIG_PATH } from '../utils/config.js';

export function registerConfigTools(server: McpServer) {
  const keyFromEnv = hasApiKey();

  server.tool(
    'setHeliusApiKey',
    keyFromEnv
      ? 'API key is already configured via environment. You do NOT need to call this tool - just use the other Helius tools directly.'
      : 'Set an existing Helius API key for the current session. If the user does not have a key, use the signup flow instead: generateKeypair → signup (link mode prints a payment URL). Get a key at https://dashboard.helius.dev/api-keys',
    {
      apiKey: z.string().describe('Your Helius API key from https://dashboard.helius.dev/api-keys'),
      network: z.string().optional().default('mainnet-beta').describe('Network to use (default: mainnet-beta)')
    },
    async ({ apiKey, network }) => {
      // Refuse before validating input: under a shared credential this tool has
      // no per-caller meaning, and honoring it would repoint the key and network
      // for every concurrent caller and write the value to disk. The existing
      // env-var branch below happens to cover the common hosted case, but only
      // because the key arrives via HELIUS_API_KEY — it fails open if the
      // credential is mounted as a config file instead.
      if (isSharedCredentialMode()) {
        return mcpError(
          'This server runs with a fixed, deployment-managed Helius API key, so it cannot be set per session. '
          + 'Queries work without any key configuration. To use your own key, run the Helius MCP locally: `npx helius-mcp@latest`.',
          { type: 'UNSUPPORTED', code: 'SHARED_CREDENTIAL', retryable: false, recovery: 'Call the query tools directly — no API key setup is needed on this server.' },
        );
      }

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
          return mcpError(
            `❌ Invalid API key. Please check your key and try again.\n\nGet your key at https://dashboard.helius.dev/api-keys`,
            { type: 'AUTH', code: 'INVALID_API_KEY', retryable: false, recovery: 'Check your API key at https://dashboard.helius.dev/api-keys and call setHeliusApiKey with a valid key.' }
          );
        }
      }

      setSharedApiKey(apiKey);
      return mcpText(`✅ Helius API key configured for ${network} and saved to \`${SHARED_CONFIG_PATH}\`. You can now query the Solana blockchain.`);
    }
  );
}
