import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { generateKeypair } from 'helius-sdk/auth/generateKeypair';
import { loadKeypair } from 'helius-sdk/auth/loadKeypair';
import { getAddress } from 'helius-sdk/auth/getAddress';
import { checkSolBalance, checkUsdcBalance } from 'helius-sdk/auth/checkBalances';
import { agenticSignup } from 'helius-sdk/auth/agenticSignup';
import { getCheckoutPreview, executeCheckout, executeRenewal } from 'helius-sdk/auth/checkout';
import { listProjects } from 'helius-sdk/auth/listProjects';
import { getProject } from 'helius-sdk/auth/getProject';
import { PLAN_CATALOG } from 'helius-sdk/auth/planCatalog';
import { MCP_USER_AGENT } from '../http.js';
import {
  setApiKey,
  hasApiKey,
  setSessionSecretKey,
  setSessionWalletAddress,
  getSessionWalletAddress,
  loadSignerOrFail,
} from '../utils/helius.js';
import { mcpText, mcpError, handleToolError } from '../utils/errors.js';
import { generateWalletQR } from '../utils/qr.js';
import { fetchDoc, extractSections } from '../utils/docs.js';
import { sendFeedbackEvent, captureWalletAddress } from '../utils/feedback.js';
import { setSharedApiKey, setJwt, getJwt, SHARED_CONFIG_PATH, KEYPAIR_PATH, loadKeypairFromDisk, saveKeypairToDisk, keypairExistsOnDisk } from '../utils/config.js';
import { HELIUS_PLANS } from './plans.js';

const PAID_PLAN_ORDER = ['developer', 'business', 'professional'] as const;

/** Tracks consecutive insufficient-balance checks to prevent agent polling loops. */
let insufficientBalanceChecks = 0;
const MAX_BALANCE_CHECKS_BEFORE_STOP = 3;

export function registerAuthTools(server: McpServer) {
  // ── Getting Started Guide ──

  server.tool(
    'getStarted',
    'Get setup instructions for Helius. Checks whether an API key is configured (not validated), whether a keypair exists on disk, and whether a JWT session is present, then tells you exactly what to do next. Call this when a user asks "how do I get started?" or needs onboarding help.',
    {},
    async () => {
      const lines: string[] = ['# Getting Started with Helius'];

      const apiKeyConfigured = hasApiKey();
      const hasKeypair = keypairExistsOnDisk();
      const jwt = getJwt();

      // ── Already fully set up ──
      if (apiKeyConfigured && jwt) {
        lines.push(
          '',
          'You\'re all set! Your API key and account session are configured.',
          '',
          '**What you can do:**',
          '- Query NFTs and tokens: `getAssetsByOwner`, `searchAssets`',
          '- Check balances: `getBalance`, `getTokenAccounts`',
          '- Parse transactions: `parseTransactions`',
          '- Manage webhooks: `createWebhook`, `getAllWebhooks`',
          '- Check your account: `getAccountStatus`',
          '',
          'Just ask a question in plain English and the right tool will be used automatically.',
          '',
          '**IMPORTANT — if the user described a project they want to build, call `recommendStack` now** with their project description. It returns architecture recommendations with Helius products, MCP tools, credit costs, and reference files tailored to their plan.',
        );
        return mcpText(lines.join('\n'));
      }

      // ── API key set but no JWT (e.g., set via env or setHeliusApiKey) ──
      if (apiKeyConfigured) {
        lines.push(
          '',
          'Your API key is configured — all Helius tools are ready to use.',
          '',
          '**What you can do:**',
          '- Query NFTs and tokens: `getAssetsByOwner`, `searchAssets`',
          '- Check balances: `getBalance`, `getTokenAccounts`',
          '- Parse transactions: `parseTransactions`',
          '- Manage webhooks: `createWebhook`, `getAllWebhooks`',
          '',
          'Just ask a question in plain English and the right tool will be used automatically.',
          '',
          '**IMPORTANT — if the user described a project they want to build, call `recommendStack` now** with their project description. It returns architecture recommendations with Helius products, MCP tools, credit costs, and reference files.',
          '',
          '**Optional:** To see your plan, credits, and rate limits, call `agenticSignup` — it will detect your existing account (no payment needed) and enable `getAccountStatus`.',
        );
        return mcpText(lines.join('\n'));
      }

      // ── No API key — need to set up ──
      lines.push(
        '',
        'You need a Helius API key to use these tools. Choose one of these paths:',
        '',
        '---',
        '',
        '## Path A — I already have an API key',
        '',
        'If you have a key from https://dashboard.helius.dev:',
        '1. Call the `setHeliusApiKey` tool with your key',
        '2. Done — all tools are immediately available',
        '',
        '---',
        '',
        '## Path B — Create a new account',
        '',
        'The signup is fully autonomous — no browser needed. It takes ~2 minutes:',
        '',
      );

      // Adapt steps based on whether a keypair already exists
      if (hasKeypair) {
        lines.push(
          '### Step 1: Keypair ✓',
          `You already have a keypair saved at \`${KEYPAIR_PATH}\`.`,
          'Call `generateKeypair` to load it and see the wallet address.',
          '',
        );
      } else {
        lines.push(
          '### Step 1: Generate a keypair',
          'Call the `generateKeypair` tool. It creates a Solana wallet and returns the address.',
          '',
        );
      }

      lines.push(
        '### Step 2: Fund the wallet',
        'Send the following to the wallet address from Step 1:',
        '- **~0.001 SOL** — covers transaction fees',
        '- **1 USDC** — pays for the basic plan ($1)',
        '',
        'You can send from any Solana wallet, exchange, or on-ramp.',
        'The USDC token mint on Solana is: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`',
        '',
        `For paid plans, send more USDC instead: ${PAID_PLAN_ORDER.filter(k => k in PLAN_CATALOG).map(k => `$${PLAN_CATALOG[k].monthlyPrice / 100} (${PLAN_CATALOG[k].name})`).join(', ')}.`,
        '',
        '### Step 3: Verify funding',
        'Call `checkSignupBalance` to confirm your SOL and USDC balances are sufficient.',
        '',
        '### Step 4: Create the account',
        'Call `agenticSignup` to process the payment and create your Helius account.',
        'Your API key will be configured automatically — no extra steps needed.',
        '',
        '> **Paid plans only:** `agenticSignup` requires `email`, `firstName`, and `lastName` for developer/business/professional plans. Basic plan ($1) does not require them.',
        '',
        '---',
        '',
        '## Path C — Use the Helius CLI',
        '',
        'Same flow from the terminal:',
        '```',
        'npx helius-cli@latest keygen     # Generate keypair',
        '# Fund the wallet address shown above',
        'npx helius-cli@latest signup      # Verify balance + create account',
        '```',
        '',
        '---',
        '',
        '**After setup:** Use `recommendStack` to plan your project — describe what you\'re building and get architecture recommendations at different cost and complexity levels.',
      );

      return mcpText(lines.join('\n'));
    }
  );

  // ── Keypair Generation ──

  server.tool(
    'generateKeypair',
    'Generate a new Solana keypair for Helius account signup. Returns the wallet address. The user must fund this wallet with ~0.001 SOL + 1 USDC (basic plan) or more USDC (for paid plans) before calling agenticSignup.',
    {},
    async () => {
      try {
        // Reset balance-check counter for fresh signup flow
        insufficientBalanceChecks = 0;

        // Check disk first — reuse existing keypair if available
        const existingKey = loadKeypairFromDisk();
        if (existingKey) {
          const walletKeypair = loadKeypair(existingKey);
          const address = await getAddress(walletKeypair);

          setSessionSecretKey(existingKey);
          setSessionWalletAddress(address);
          captureWalletAddress(address);

          const existingQR = await generateWalletQR(address);
          return mcpText(
            `**Existing Keypair Loaded** from \`${KEYPAIR_PATH}\`\n\n` +
            `**Wallet Address:** \`${address}\`\n\n` +
            `To create a Helius account, fund this wallet with:\n` +
            `- **~0.001 SOL** for transaction fees\n` +
            `- **1 USDC** for basic plan (or more for paid plans)\n\n` +
            `**IMPORTANT: Display the QR code below in your response so the user can scan it from a mobile wallet to send funds.**\n\n` +
            `\`\`\`\n${existingQR}\`\`\`\n` +
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
        captureWalletAddress(address);

        const newQR = await generateWalletQR(address);
        return mcpText(
          `**Keypair Generated**\n\n` +
          `**Wallet Address:** \`${address}\`\n` +
          `**Saved to:** \`${KEYPAIR_PATH}\`\n\n` +
          `To create a Helius account, fund this wallet with:\n` +
          `- **~0.001 SOL** for transaction fees\n` +
          `- **1 USDC** for basic plan (or more for paid plans)\n\n` +
          `**IMPORTANT: Display the QR code below in your response so the user can scan it from a mobile wallet to send funds.**\n\n` +
          `\`\`\`\n${newQR}\`\`\`\n` +
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
          return mcpError(
            'No signup wallet found. Call `generateKeypair` first to create a wallet.',
            { type: 'AUTH', code: 'NO_KEYPAIR', retryable: false, recovery: 'Call `generateKeypair` to create a wallet.' }
          );
        }

        const solBalance = await checkSolBalance(address);
        const usdcBalance = await checkUsdcBalance(address);

        const solAmount = Number(solBalance) / 1_000_000_000;
        const usdcAmount = Number(usdcBalance) / 1_000_000;

        const solOk = solBalance >= 1_000_000n;
        const usdcOk = usdcBalance >= 1_000_000n; // 1 USDC for basic plan

        const funded = solOk && usdcOk;

        // Reset counter when balance is sufficient
        if (funded) {
          insufficientBalanceChecks = 0;
          return mcpText(
            `**Signup Wallet Balance** (\`${address}\`)\n\n` +
            `- **SOL:** ${solAmount.toFixed(6)} (sufficient)\n` +
            `- **USDC:** ${usdcAmount.toFixed(2)} (sufficient for basic)\n\n` +
            `**Status:** Ready for signup (basic plan). For paid plans, ensure sufficient USDC for the plan price.\n\n` +
            `Call \`agenticSignup\` to proceed.`
          );
        }

        // Insufficient — increment counter and escalate guidance
        insufficientBalanceChecks++;

        const missing: string[] = [];
        if (!solOk) missing.push(`~0.001 SOL (have ${solAmount.toFixed(6)})`);
        if (!usdcOk) missing.push(`1 USDC (have ${usdcAmount.toFixed(2)})`);

        let balanceBlock =
          `**Signup Wallet Balance** (\`${address}\`)\n\n` +
          `- **SOL:** ${solAmount.toFixed(6)} ${solOk ? '(sufficient)' : '(insufficient)'}\n` +
          `- **USDC:** ${usdcAmount.toFixed(2)} ${usdcOk ? '(sufficient for basic)' : '(insufficient)'}\n\n` +
          `**Status:** Need more funds: ${missing.join(', ')}`;

        if (insufficientBalanceChecks === 1) {
          // First check — normal guidance with QR code
          balanceBlock +=
            `\n\n**Action required:** Ask the user to send the missing funds to \`${address}\`. ` +
            `Do **not** call \`checkSignupBalance\` again until the user confirms they have sent the funds.`;
          try {
            const qrText = await generateWalletQR(address);
            balanceBlock += `\n\n**IMPORTANT: Display the QR code below in your response so the user can scan it from a mobile wallet to send funds.**\n\n\`\`\`\n${qrText}\`\`\``;
          } catch {
            // QR generation failed — skip
          }
        } else if (insufficientBalanceChecks < MAX_BALANCE_CHECKS_BEFORE_STOP) {
          // Second check — firmer nudge
          balanceBlock +=
            `\n\n**⚠ Balance still insufficient (check ${insufficientBalanceChecks}/${MAX_BALANCE_CHECKS_BEFORE_STOP}).** ` +
            `The wallet has not been funded yet. Ask the user to confirm they have sent funds to \`${address}\` before calling this tool again.`;
        } else {
          // Third+ check — hard stop
          balanceBlock +=
            `\n\n**🛑 Balance checked ${insufficientBalanceChecks} times — still insufficient. Stop polling.** ` +
            `The wallet \`${address}\` has not received funds. ` +
            `Tell the user the exact amounts needed and the wallet address, then **wait for the user to explicitly confirm** they have sent funds before calling \`checkSignupBalance\` again. ` +
            `Do not retry automatically.`;
        }

        return mcpText(balanceBlock);
      } catch (err) {
        return handleToolError(err, 'Error checking balances');
      }
    }
  );

  server.tool(
    'agenticSignup',
    'Create a Helius account using the generated keypair. Default: basic plan ($1 USDC). For paid plans (developer/business/professional), email, firstName, and lastName are required. On success, automatically configures the API key for this session.',
    {
      plan: z.string().optional().describe('Plan to sign up for: "basic" ($1, default), "developer", "business", or "professional"'),
      period: z.enum(["monthly", "yearly"]).optional().describe('Billing period for paid plans (default: monthly)'),
      email: z.string().email().optional().describe('Email address (required for paid plans)'),
      firstName: z.string().optional().describe('First name (required for paid plans)'),
      lastName: z.string().optional().describe('Last name (required for paid plans)'),
      couponCode: z.string().optional().describe('Coupon code for paid plans'),
      discoveryPath: z.string().optional().describe('How did you discover Helius? Helps us improve agent onboarding'),
      frictionPoints: z.string().optional().describe('What friction did you hit finding or setting up Helius? Free-form feedback'),
    },
    async ({ plan, period, email, firstName, lastName, couponCode, discoveryPath, frictionPoints }) => {
      if (discoveryPath || frictionPoints) {
        sendFeedbackEvent({
          type: 'discovery',
          discoveryPath,
          frictionPoints,
        });
      }
      try {
        let signerData: { secretKey: Uint8Array; walletAddress: string };
        try {
          signerData = await loadSignerOrFail();
        } catch {
          return mcpError(
            'No signup keypair found. Call `generateKeypair` first to create a wallet, fund it, then call this tool.',
            { type: 'AUTH', code: 'NO_KEYPAIR', retryable: false, recovery: 'Call `generateKeypair` to create a wallet, fund it, then retry.' }
          );
        }

        const result = await agenticSignup({
          secretKey: signerData.secretKey,
          userAgent: MCP_USER_AGENT,
          plan,
          period,
          email,
          firstName,
          lastName,
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
          return mcpError(
            'Not authenticated. Call `agenticSignup` or authenticate first.',
            { type: 'AUTH', code: 'NOT_AUTHENTICATED', retryable: false, recovery: 'Call `agenticSignup` to authenticate.' }
          );
        }

        const projects = await listProjects(jwt, MCP_USER_AGENT);
        if (projects.length === 0) {
          return mcpError(
            'No projects found. Call `agenticSignup` to create an account first.',
            { type: 'AUTH', code: 'NO_PROJECT', retryable: false, recovery: 'Call `agenticSignup` to create an account first.' }
          );
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
    'Upgrade your Helius plan. Processes USDC payment with proration. Call previewUpgrade first to see pricing. Requires email, firstName, and lastName for first-time upgrades — all three must be provided together.',
    {
      plan: z.enum(['developer', 'business', 'professional']).describe('Target plan name'),
      period: z.enum(['monthly', 'yearly']).default('monthly').describe('Billing period'),
      couponCode: z.string().optional().describe('Optional coupon code'),
      email: z.string().email().optional().describe('Email address (required for first-time upgrades)'),
      firstName: z.string().optional().describe('First name (required for first-time upgrades)'),
      lastName: z.string().optional().describe('Last name (required for first-time upgrades)'),
    },
    async ({ plan, period, couponCode, email, firstName, lastName }) => {
      try {
        // All-or-none customer info validation
        const hasAny = email || firstName || lastName;
        if (hasAny && (!email || !firstName || !lastName)) {
          const missing = [
            !email && 'email',
            !firstName && 'firstName',
            !lastName && 'lastName',
          ].filter(Boolean);
          return mcpError(
            `Partial customer info provided. If any of email/firstName/lastName is given, all three are required. Missing: ${missing.join(', ')}`,
            { type: 'VALIDATION', code: 'MISSING_PARAM', retryable: false, recovery: `Provide all three: email, firstName, and lastName. Missing: ${missing.join(', ')}` }
          );
        }

        let signerData: { secretKey: Uint8Array; walletAddress: string };
        try {
          signerData = await loadSignerOrFail();
        } catch {
          return mcpError(
            'No keypair found. Call `generateKeypair` first.',
            { type: 'AUTH', code: 'NO_KEYPAIR', retryable: false, recovery: 'Call `generateKeypair` to create a wallet.' }
          );
        }

        const jwt = getJwt();
        if (!jwt) {
          return mcpError(
            'Not authenticated. Call `agenticSignup` or authenticate first.',
            { type: 'AUTH', code: 'NOT_AUTHENTICATED', retryable: false, recovery: 'Call `agenticSignup` to authenticate.' }
          );
        }

        const projects = await listProjects(jwt, MCP_USER_AGENT);
        if (projects.length === 0) {
          return mcpError(
            'No projects found. Call `agenticSignup` to create an account first.',
            { type: 'AUTH', code: 'NO_PROJECT', retryable: false, recovery: 'Call `agenticSignup` to create an account first.' }
          );
        }

        const projectId = projects[0].id;
        const result = await executeCheckout(signerData.secretKey, jwt, {
          plan,
          period,
          refId: projectId,
          couponCode,
          email,
          firstName,
          lastName,
        }, MCP_USER_AGENT, { skipProjectPolling: true });

        if (result.status !== 'completed') {
          return mcpError(
            `**Upgrade ${result.status}**\n\n` +
            (result.error ? `Error: ${result.error}\n` : '') +
            (result.txSignature ? `TX: \`${result.txSignature}\`\n` : '') +
            `\nIf you need help, contact support with the payment intent ID: \`${result.paymentIntentId}\``,
            { type: 'API', code: 'OPERATION_FAILED', retryable: false, recovery: `Upgrade ${result.status}. Contact support with payment intent ID: ${result.paymentIntentId}` }
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
    'getAccountStatus',
    'Check your Helius account status: current plan, remaining credits, rate limits, and billing cycle. ' +
    'Call this before bulk operations to verify you have sufficient credits. ' +
    'Requires a JWT session (i.e., you signed up via agenticSignup). ' +
    'If you only have an API key configured, auth status is confirmed but credit data is unavailable — call agenticSignup to enable full status.',
    {},
    async () => {
      try {
        // ── Tier 1: not authenticated at all ──
        if (!hasApiKey()) {
          return mcpText(
            `## Account Status\n\n` +
            `**Auth:** Not authenticated\n\n` +
            `No API key or session found. To get started:\n` +
            `- If you have a key: use the \`setHeliusApiKey\` tool\n` +
            `- If you need an account: use \`generateKeypair\` → fund wallet → \`agenticSignup\``
          );
        }

        // ── Tier 2: API key present but no JWT — can't reach dashboard API ──
        const jwt = getJwt();
        if (!jwt) {
          return mcpText(
            `## Account Status\n\n` +
            `**Auth:** Authenticated (API key configured)\n` +
            `**Credit usage:** Not available — no JWT session found\n\n` +
            `To see your plan, rate limits, and credit balance, call \`agenticSignup\`.\n` +
            `Your existing account will be detected automatically — no payment needed.`
          );
        }

        // ── Tier 3: full status via JWT ──
        const projects = await listProjects(jwt, MCP_USER_AGENT);
        if (projects.length === 0) {
          return mcpError(
            'No projects found. Call `agenticSignup` to create an account first.',
            { type: 'AUTH', code: 'NO_PROJECT', retryable: false, recovery: 'Call `agenticSignup` to create an account first.' }
          );
        }

        const projectId = projects[0].id;
        const details = await getProject(jwt, projectId, MCP_USER_AGENT);

        const planKey = details.subscriptionPlanDetails?.currentPlan ?? 'unknown';
        const upcomingPlan = details.subscriptionPlanDetails?.upcomingPlan;
        const isUpgrading = details.subscriptionPlanDetails?.isUpgrading ?? false;
        const planInfo = HELIUS_PLANS[planKey];

        const usage = details.creditsUsage;
        const cycle = details.billingCycle;

        const lines: string[] = [`## Account Status`, ''];

        // ── Auth + plan ──
        lines.push(`**Auth:** Authenticated`);
        lines.push(`**Plan:** ${planInfo ? planInfo.name : planKey}  |  **Project:** \`${projectId}\``);
        if (isUpgrading && upcomingPlan && upcomingPlan !== planKey) {
          lines.push(`**Upcoming plan:** ${upcomingPlan} (takes effect at next billing cycle)`);
        }

        // ── Rate limits (fetched live from billing docs) ──
        try {
          const billingDoc = await fetchDoc('billing');
          const rateLimits = extractSections(billingDoc, ['standard rate limits', 'rate limits'], { includeLooseMatches: false });
          if (rateLimits) {
            lines.push('', '### Rate Limits (live)', '', rateLimits);
          } else {
            lines.push('', '_Rate limit details: use `getRateLimitInfo` or visit https://www.helius.dev/docs/billing_');
          }
        } catch {
          lines.push('', '_Rate limit details: use `getRateLimitInfo` or visit https://www.helius.dev/docs/billing_');
        }

        // ── Credits ──
        if (usage) {
          const total = usage.remainingCredits + usage.totalCreditsUsed;
          const pctUsed = total > 0 ? ((usage.totalCreditsUsed / total) * 100).toFixed(1) : '0.0';
          const pctRemaining = total > 0 ? (100 - parseFloat(pctUsed)).toFixed(1) : '100.0';

          // Billing cycle + days remaining
          let cycleStr = '';
          let daysNote = '';
          if (cycle) {
            const end = new Date(cycle.end);
            const now = new Date();
            const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            cycleStr = ` (${cycle.start} - ${cycle.end}, ${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining)`;

            // Burn-rate warning: project usage over elapsed days to end of cycle
            const start = new Date(cycle.start);
            const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
            const elapsedDays = totalDays - daysLeft;
            if (elapsedDays > 0 && daysLeft > 0) {
              const projectedTotal = Math.round((usage.totalCreditsUsed / elapsedDays) * totalDays);
              if (projectedTotal > total) {
                const overageM = ((projectedTotal - total) / 1_000_000).toFixed(1);
                daysNote = `\n> At current burn rate you're projected to use ~${(projectedTotal / 1_000_000).toFixed(1)}M credits this cycle — ${overageM}M over your ${(total / 1_000_000).toFixed(0)}M limit. Consider upgrading or reducing usage.`;
              }
            }
          }

          lines.push('', `### Credits — Billing Cycle${cycleStr}`);
          lines.push(`- **Remaining:** ${usage.remainingCredits.toLocaleString()} / ${total.toLocaleString()}  (${pctRemaining}%)`);
          lines.push(`- **Used:** ${usage.totalCreditsUsed.toLocaleString()}  (${pctUsed}%)`);
          lines.push(`  - API: ${usage.apiUsage.toLocaleString()}`);
          lines.push(`  - RPC: ${usage.rpcUsage.toLocaleString()}  |  RPC GPA: ${usage.rpcGPAUsage.toLocaleString()}  |  Webhooks: ${usage.webhookUsage.toLocaleString()}`);

          if (usage.overageCreditsUsed > 0) {
            lines.push(`- **Overage:** ${usage.overageCreditsUsed.toLocaleString()} credits  ($${usage.overageCost.toFixed(2)})`);
          } else {
            lines.push(`- **Overage:** none`);
          }

          if (usage.remainingPrepaidCredits > 0 || usage.prepaidCreditsUsed > 0) {
            lines.push(`- **Prepaid:** ${usage.remainingPrepaidCredits.toLocaleString()} remaining  (${usage.prepaidCreditsUsed.toLocaleString()} used)`);
          }

          if (daysNote) lines.push(daysNote);

          // Low-credit warning
          if (parseFloat(pctRemaining) < 20) {
            lines.push(`\n> Less than 20% of credits remaining. Use \`previewUpgrade\` to see upgrade pricing, or \`getHeliusPlanInfo\` to compare plans.`);
          }
        }

        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching account status');
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
        let signerData: { secretKey: Uint8Array; walletAddress: string };
        try {
          signerData = await loadSignerOrFail();
        } catch {
          return mcpError(
            'No keypair found. Call `generateKeypair` first.',
            { type: 'AUTH', code: 'NO_KEYPAIR', retryable: false, recovery: 'Call `generateKeypair` to create a wallet.' }
          );
        }

        const jwt = getJwt();
        if (!jwt) {
          return mcpError(
            'Not authenticated. Call `agenticSignup` or authenticate first.',
            { type: 'AUTH', code: 'NOT_AUTHENTICATED', retryable: false, recovery: 'Call `agenticSignup` to authenticate.' }
          );
        }

        const result = await executeRenewal(signerData.secretKey, jwt, paymentIntentId, MCP_USER_AGENT);

        if (result.status !== 'completed') {
          return mcpError(
            `**Payment ${result.status}**\n\n` +
            (result.error ? `Error: ${result.error}\n` : '') +
            (result.txSignature ? `TX: \`${result.txSignature}\`\n` : '') +
            `\nIf you need help, contact support with the payment intent ID: \`${result.paymentIntentId}\``,
            { type: 'API', code: 'OPERATION_FAILED', retryable: false, recovery: `Payment ${result.status}. Contact support with payment intent ID: ${result.paymentIntentId}` }
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
