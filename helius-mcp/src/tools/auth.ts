import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { generateKeypair } from 'helius-sdk/auth/generateKeypair';
import { loadKeypair } from 'helius-sdk/auth/loadKeypair';
import { getAddress } from 'helius-sdk/auth/getAddress';
import { checkSolBalance, checkUsdcBalance } from 'helius-sdk/auth/checkBalances';
import { agenticSignup } from 'helius-sdk/auth/agenticSignup';
import { getCheckoutPreview, executeUpgrade, executeRenewal } from 'helius-sdk/auth/checkout';
import { listProjects } from 'helius-sdk/auth/listProjects';
import { getProject } from 'helius-sdk/auth/getProject';
import { PLAN_CATALOG } from 'helius-sdk/auth/constants';
import { MCP_USER_AGENT } from '../http.js';
import {
  setApiKey,
  setSessionSecretKey,
  getSessionSecretKey,
  setSessionWalletAddress,
  getSessionWalletAddress,
} from '../utils/helius.js';
import { mcpText, mcpError, handleToolError } from '../utils/errors.js';
import { setSharedApiKey, setJwt, getJwt, SHARED_CONFIG_PATH, KEYPAIR_PATH, loadKeypairFromDisk, saveKeypairToDisk } from '../utils/config.js';

export function registerAuthTools(server: McpServer) {
  server.tool(
    'generateKeypair',
    'Generate a new Solana keypair for Helius account signup. Returns the wallet address. The user must fund this wallet with ~0.001 SOL + 1 USDC (basic plan) or more USDC (for paid plans) before calling agenticSignup.',
    {},
    async () => {
      try {
        // Check disk first — reuse existing keypair if available
        const existingKey = loadKeypairFromDisk();
        if (existingKey) {
          const walletKeypair = loadKeypair(existingKey);
          const address = await getAddress(walletKeypair);

          setSessionSecretKey(existingKey);
          setSessionWalletAddress(address);

          return mcpText(
            `**Existing Keypair Loaded** from \`${KEYPAIR_PATH}\`\n\n` +
            `**Wallet Address:** \`${address}\`\n\n` +
            `To create a Helius account, fund this wallet with:\n` +
            `- **~0.001 SOL** for transaction fees\n` +
            `- **1 USDC** for basic plan (or more for paid plans)\n\n` +
            `Then call \`agenticSignup\` to complete account creation.`
          );
        }

        // Generate new keypair and persist to disk
        const keypair = await generateKeypair();
        const walletKeypair = loadKeypair(keypair.secretKey);
        const address = await getAddress(walletKeypair);

        saveKeypairToDisk(keypair.secretKey);
        setSessionSecretKey(keypair.secretKey);
        setSessionWalletAddress(address);

        return mcpText(
          `**Keypair Generated**\n\n` +
          `**Wallet Address:** \`${address}\`\n` +
          `**Saved to:** \`${KEYPAIR_PATH}\`\n\n` +
          `To create a Helius account, fund this wallet with:\n` +
          `- **~0.001 SOL** for transaction fees\n` +
          `- **1 USDC** for basic plan (or more for paid plans)\n\n` +
          `Then call \`agenticSignup\` to complete account creation.`
        );
      } catch (err) {
        return handleToolError(err, 'Error generating keypair');
      }
    }
  );

  server.tool(
    'checkSignupBalance',
    'Check if the signup wallet has sufficient SOL and USDC balance for Helius basic plan ($1 USDC). Paid plans (developer/business/professional) require more USDC — the exact amount depends on the plan and is checked during checkout.',
    {},
    async () => {
      try {
        let address = getSessionWalletAddress();

        // Fall back to disk keypair if no session wallet
        if (!address) {
          const diskKey = loadKeypairFromDisk();
          if (diskKey) {
            const walletKeypair = loadKeypair(diskKey);
            address = await getAddress(walletKeypair);
            setSessionSecretKey(diskKey);
            setSessionWalletAddress(address);
          }
        }

        if (!address) {
          return mcpError('No signup wallet found. Call `generateKeypair` first to create a wallet.');
        }

        const solBalance = await checkSolBalance(address);
        const usdcBalance = await checkUsdcBalance(address);

        const solAmount = Number(solBalance) / 1_000_000_000;
        const usdcAmount = Number(usdcBalance) / 1_000_000;

        const solOk = solBalance >= 1_000_000n;
        const usdcOk = usdcBalance >= 1_000_000n; // 1 USDC for basic plan

        let status: string;
        if (solOk && usdcOk) {
          status = 'Ready for signup (basic plan). For paid plans, ensure sufficient USDC for the plan price.';
        } else {
          const missing: string[] = [];
          if (!solOk) missing.push(`~0.001 SOL (have ${solAmount.toFixed(6)})`);
          if (!usdcOk) missing.push(`1 USDC (have ${usdcAmount.toFixed(2)})`);
          status = `Need more funds: ${missing.join(', ')}`;
        }

        return mcpText(
          `**Signup Wallet Balance** (\`${address}\`)\n\n` +
          `- **SOL:** ${solAmount.toFixed(6)} ${solOk ? '(sufficient)' : '(insufficient)'}\n` +
          `- **USDC:** ${usdcAmount.toFixed(2)} ${usdcOk ? '(sufficient for basic)' : '(insufficient)'}\n\n` +
          `**Status:** ${status}`
        );
      } catch (err) {
        return handleToolError(err, 'Error checking balances');
      }
    }
  );

  server.tool(
    'agenticSignup',
    'Create a Helius account using the generated keypair. Default: basic plan ($1 USDC). For paid plans, specify plan: developer ($49/mo), business ($499/mo), or professional ($999/mo). On success, automatically configures the API key for this session.',
    {
      plan: z.string().optional().describe('Plan to sign up for: "basic" ($1, default), "developer", "business", or "professional"'),
      period: z.enum(["monthly", "yearly"]).optional().describe('Billing period for paid plans (default: monthly)'),
      email: z.string().email().optional().describe('Contact email for the account (may be required for new signups)'),
      couponCode: z.string().optional().describe('Coupon code for paid plans'),
    },
    async ({ plan, period, email, couponCode }) => {
      try {
        let secretKey = getSessionSecretKey();

        // Fall back to disk keypair if no session key
        if (!secretKey) {
          secretKey = loadKeypairFromDisk();
          if (secretKey) {
            const walletKeypair = loadKeypair(secretKey);
            const address = await getAddress(walletKeypair);
            setSessionSecretKey(secretKey);
            setSessionWalletAddress(address);
          }
        }

        if (!secretKey) {
          return mcpError('No signup keypair found. Call `generateKeypair` first to create a wallet, fund it, then call this tool.');
        }

        const result = await agenticSignup({
          secretKey,
          userAgent: MCP_USER_AGENT,
          plan,
          period,
          email,
          couponCode,
        });

        // Configure API key for this session and persist to shared config
        if (result.apiKey) {
          setApiKey(result.apiKey);
          setSharedApiKey(result.apiKey);
        }

        // Persist JWT to disk
        if (result.jwt) {
          setJwt(result.jwt);
        }

        const saveNote = result.apiKey
          ? `\nAPI key configured for this session and saved to \`${SHARED_CONFIG_PATH}\`. All Helius tools are now ready to use.`
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

        if (result.status === 'upgraded') {
          return mcpText(
            `**Plan Upgraded to ${plan || 'paid plan'}**\n\n` +
            `- **Wallet:** \`${result.walletAddress}\`\n` +
            `- **Project ID:** \`${result.projectId}\`\n` +
            (result.apiKey ? `- **API Key:** \`${result.apiKey}\`\n` : '') +
            (result.txSignature ? `- **Payment TX:** \`${result.txSignature}\`\n` : '') +
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

  // ── Upgrade, Preview, Renewal Tools ──

  server.tool(
    'previewUpgrade',
    'Preview pricing for a plan upgrade with proration details. Shows current plan, new plan cost, prorated credits, and amount due today.',
    {
      plan: z.enum(['developer', 'business', 'professional']).describe('Target plan name'),
      period: z.enum(['monthly', 'yearly']).default('monthly').describe('Billing period'),
      couponCode: z.string().optional().describe('Optional coupon code'),
    },
    async ({ plan, period, couponCode }) => {
      try {
        const jwt = getJwt();
        if (!jwt) {
          return mcpError('Not authenticated. Call `agenticSignup` or authenticate first.');
        }

        const projects = await listProjects(jwt, MCP_USER_AGENT);
        if (projects.length === 0) {
          return mcpError('No projects found. Call `agenticSignup` to create an account first.');
        }

        const projectId = projects[0].id;
        const projectDetails = await getProject(jwt, projectId, MCP_USER_AGENT);
        const currentPlan = projectDetails.subscriptionPlanDetails?.currentPlan || 'unknown';

        const preview = await getCheckoutPreview(jwt, plan, period, projectId, couponCode, MCP_USER_AGENT);

        let text =
          `**Upgrade Preview**\n\n` +
          `- **Current Plan:** ${currentPlan}\n` +
          `- **Target Plan:** ${preview.planName} (${preview.period})\n\n` +
          `**Pricing Breakdown:**\n` +
          `- Subtotal: $${(preview.subtotal / 100).toFixed(2)}\n`;

        if (preview.proratedCredits > 0) {
          text += `- Prorated credit: -$${(preview.proratedCredits / 100).toFixed(2)}\n`;
        }
        if (preview.appliedCredits > 0) {
          text += `- Applied credits: -$${(preview.appliedCredits / 100).toFixed(2)}\n`;
        }
        if (preview.discounts > 0) {
          text += `- Discounts: -$${(preview.discounts / 100).toFixed(2)}\n`;
        }
        if (preview.coupon?.valid) {
          text += `- Coupon (${preview.coupon.code}): ${preview.coupon.description || 'Applied'}\n`;
        } else if (preview.coupon && !preview.coupon.valid) {
          text += `- Coupon (${preview.coupon.code}): **Invalid** — ${preview.coupon.invalidReason || 'not applicable'}\n`;
        }

        text += `\n**Due Today: $${(preview.dueToday / 100).toFixed(2)}**\n`;

        if (preview.note) {
          text += `\n_${preview.note}_\n`;
        }

        text += `\nTo proceed, use the \`upgradePlan\` tool with plan: '${plan}'.`;

        return mcpText(text);
      } catch (err) {
        return handleToolError(err, 'Error previewing upgrade');
      }
    }
  );

  server.tool(
    'upgradePlan',
    'Upgrade your Helius plan. Processes USDC payment with proration. Call previewUpgrade first to see pricing.',
    {
      plan: z.enum(['developer', 'business', 'professional']).describe('Target plan name'),
      period: z.enum(['monthly', 'yearly']).default('monthly').describe('Billing period'),
      couponCode: z.string().optional().describe('Optional coupon code'),
    },
    async ({ plan, period, couponCode }) => {
      try {
        let secretKey = getSessionSecretKey();
        if (!secretKey) {
          secretKey = loadKeypairFromDisk();
          if (secretKey) {
            const walletKeypair = loadKeypair(secretKey);
            const address = await getAddress(walletKeypair);
            setSessionSecretKey(secretKey);
            setSessionWalletAddress(address);
          }
        }
        if (!secretKey) {
          return mcpError('No keypair found. Call `generateKeypair` first.');
        }

        const jwt = getJwt();
        if (!jwt) {
          return mcpError('Not authenticated. Call `agenticSignup` or authenticate first.');
        }

        const projects = await listProjects(jwt, MCP_USER_AGENT);
        if (projects.length === 0) {
          return mcpError('No projects found. Call `agenticSignup` to create an account first.');
        }

        const projectId = projects[0].id;
        const result = await executeUpgrade(secretKey, jwt, plan, period, projectId, couponCode, MCP_USER_AGENT);

        if (result.status !== 'completed') {
          return mcpError(
            `**Upgrade ${result.status}**\n\n` +
            (result.error ? `Error: ${result.error}\n` : '') +
            (result.txSignature ? `TX: \`${result.txSignature}\`\n` : '') +
            `\nIf you need help, contact support with the payment intent ID: \`${result.paymentIntentId}\``
          );
        }

        const planInfo = PLAN_CATALOG[plan];
        return mcpText(
          `**Plan Upgraded Successfully**\n\n` +
          `- **New Plan:** ${planInfo.name} (${period})\n` +
          `- **Project ID:** \`${projectId}\`\n` +
          (result.txSignature ? `- **Payment TX:** \`${result.txSignature}\`\n` : '') +
          `\nYour new plan is now active with ${(planInfo.credits / 1_000_000).toFixed(0)}M credits and ${planInfo.requestsPerSecond} RPS.`
        );
      } catch (err) {
        return handleToolError(err, 'Error upgrading plan');
      }
    }
  );

  server.tool(
    'payRenewal',
    'Pay an existing payment intent (e.g., from a renewal notification). Fetches intent details, validates, and processes USDC payment.',
    {
      paymentIntentId: z.string().describe('Payment intent ID from renewal notification'),
    },
    async ({ paymentIntentId }) => {
      try {
        let secretKey = getSessionSecretKey();
        if (!secretKey) {
          secretKey = loadKeypairFromDisk();
          if (secretKey) {
            const walletKeypair = loadKeypair(secretKey);
            const address = await getAddress(walletKeypair);
            setSessionSecretKey(secretKey);
            setSessionWalletAddress(address);
          }
        }
        if (!secretKey) {
          return mcpError('No keypair found. Call `generateKeypair` first.');
        }

        const jwt = getJwt();
        if (!jwt) {
          return mcpError('Not authenticated. Call `agenticSignup` or authenticate first.');
        }

        const result = await executeRenewal(secretKey, jwt, paymentIntentId, MCP_USER_AGENT);

        if (result.status !== 'completed') {
          return mcpError(
            `**Payment ${result.status}**\n\n` +
            (result.error ? `Error: ${result.error}\n` : '') +
            (result.txSignature ? `TX: \`${result.txSignature}\`\n` : '') +
            `\nIf you need help, contact support with the payment intent ID: \`${result.paymentIntentId}\``
          );
        }

        return mcpText(
          `**Payment Complete**\n\n` +
          `- **Payment Intent:** \`${result.paymentIntentId}\`\n` +
          (result.txSignature ? `- **TX:** \`${result.txSignature}\`\n` : '') +
          `\nYour subscription has been renewed successfully.`
        );
      } catch (err) {
        return handleToolError(err, 'Error processing renewal payment');
      }
    }
  );
}
