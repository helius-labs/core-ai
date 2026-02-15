import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { generateKeypair } from 'helius-sdk/auth/generateKeypair';
import { loadKeypair } from 'helius-sdk/auth/loadKeypair';
import { getAddress } from 'helius-sdk/auth/getAddress';
import { checkSolBalance, checkUsdcBalance } from 'helius-sdk/auth/checkBalances';
import { agenticSignup } from 'helius-sdk/auth/agenticSignup';
import { MCP_USER_AGENT } from '../http.js';
import {
  setApiKey,
  setSessionSecretKey,
  getSessionSecretKey,
  setSessionWalletAddress,
  getSessionWalletAddress,
} from '../utils/helius.js';
import { mcpText, mcpError, handleToolError } from '../utils/errors.js';

export function registerAuthTools(server: McpServer) {
  server.tool(
    'generateKeypair',
    'Generate a new Solana keypair for Helius account signup. Returns the wallet address. The user must fund this wallet with ~0.001 SOL + 1 USDC before calling agenticSignup.',
    {},
    async () => {
      try {
        const keypair = generateKeypair();
        const walletKeypair = loadKeypair(keypair.secretKey);
        const address = await getAddress(walletKeypair);

        // Store in session
        setSessionSecretKey(keypair.secretKey);
        setSessionWalletAddress(address);

        return mcpText(
          `**Keypair Generated**\n\n` +
          `**Wallet Address:** \`${address}\`\n\n` +
          `To create a Helius account, fund this wallet with:\n` +
          `- **~0.001 SOL** for transaction fees\n` +
          `- **1 USDC** for Helius signup\n\n` +
          `Then call \`agenticSignup\` to complete account creation.`
        );
      } catch (err) {
        return handleToolError(err, 'Error generating keypair');
      }
    }
  );

  server.tool(
    'checkSignupBalance',
    'Check if the signup wallet has sufficient SOL and USDC balance for Helius account creation.',
    {},
    async () => {
      try {
        const address = getSessionWalletAddress();
        if (!address) {
          return mcpError('No signup wallet found. Call `generateKeypair` first to create a wallet.');
        }

        const solBalance = await checkSolBalance(address);
        const usdcBalance = await checkUsdcBalance(address);

        const solAmount = Number(solBalance) / 1_000_000_000;
        const usdcAmount = Number(usdcBalance) / 1_000_000;

        const solOk = solBalance >= 1_000_000n;
        const usdcOk = usdcBalance >= 1_000_000n;

        let status: string;
        if (solOk && usdcOk) {
          status = 'Ready for signup';
        } else {
          const missing: string[] = [];
          if (!solOk) missing.push(`~0.001 SOL (have ${solAmount.toFixed(6)})`);
          if (!usdcOk) missing.push(`1 USDC (have ${usdcAmount.toFixed(2)})`);
          status = `Need more funds: ${missing.join(', ')}`;
        }

        return mcpText(
          `**Signup Wallet Balance** (\`${address}\`)\n\n` +
          `- **SOL:** ${solAmount.toFixed(6)} ${solOk ? '(sufficient)' : '(insufficient)'}\n` +
          `- **USDC:** ${usdcAmount.toFixed(2)} ${usdcOk ? '(sufficient)' : '(insufficient)'}\n\n` +
          `**Status:** ${status}`
        );
      } catch (err) {
        return handleToolError(err, 'Error checking balances');
      }
    }
  );

  server.tool(
    'agenticSignup',
    'Create a Helius account using the generated keypair. Requires the wallet to be funded with ~0.001 SOL + 1 USDC. On success, automatically configures the API key for this session so all other Helius tools work immediately.',
    {},
    async () => {
      try {
        const secretKey = getSessionSecretKey();
        if (!secretKey) {
          return mcpError('No signup keypair found. Call `generateKeypair` first to create a wallet, fund it, then call this tool.');
        }

        const result = await agenticSignup({
          secretKey,
          userAgent: MCP_USER_AGENT,
        });

        // Configure API key for this session so all other tools work
        if (result.apiKey) {
          setApiKey(result.apiKey);
        }

        const saveNote = result.apiKey
          ? `\nAPI key configured for this session. All Helius tools are now ready to use.\n\n` +
            `**To keep this key for future sessions**, save your API key \`${result.apiKey}\` by either:\n` +
            `1. Setting \`HELIUS_API_KEY\` in your MCP server config environment variables\n` +
            `2. Calling the \`setHeliusApiKey\` tool at the start of each new session`
          : '';

        if (result.status === 'existing_project') {
          return mcpText(
            `**Helius Account Found**\n\n` +
            `You already have a Helius account. No payment was needed.\n\n` +
            `- **Wallet:** \`${result.walletAddress}\`\n` +
            `- **Project ID:** \`${result.projectId}\`\n` +
            (result.apiKey ? `- **API Key:** \`${result.apiKey}\`\n` : '') +
            (result.endpoints ? `- **Mainnet RPC:** \`${result.endpoints.mainnet}\`\n` : '') +
            (result.endpoints ? `- **Devnet RPC:** \`${result.endpoints.devnet}\`\n` : '') +
            (result.credits !== null ? `- **Credits:** ${result.credits.toLocaleString()}\n` : '') +
            saveNote
          );
        }

        return mcpText(
          `**Helius Account Created**\n\n` +
          `- **Wallet:** \`${result.walletAddress}\`\n` +
          `- **Project ID:** \`${result.projectId}\`\n` +
          (result.apiKey ? `- **API Key:** \`${result.apiKey}\`\n` : '') +
          (result.endpoints ? `- **Mainnet RPC:** \`${result.endpoints.mainnet}\`\n` : '') +
          (result.endpoints ? `- **Devnet RPC:** \`${result.endpoints.devnet}\`\n` : '') +
          (result.credits !== null ? `- **Credits:** ${result.credits.toLocaleString()}\n` : '') +
          (result.txSignature ? `- **Payment TX:** \`${result.txSignature}\`\n` : '') +
          saveNote
        );
      } catch (err) {
        return handleToolError(err, 'Error during signup');
      }
    }
  );
}
