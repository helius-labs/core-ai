import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { generateKeypair } from 'helius-sdk/auth/generateKeypair';
import { loadKeypair } from 'helius-sdk/auth/loadKeypair';
import { getAddress } from 'helius-sdk/auth/getAddress';
import { listProjects } from 'helius-sdk/auth/listProjects';
import { getProject } from 'helius-sdk/auth/getProject';
import { getCheckoutPreview } from 'helius-sdk/auth/checkout';
import { signup } from 'helius-sdk/auth/signup';
import { signupAndPay } from 'helius-sdk/auth/signupAndPay';
import { upgradePlan, upgradePlanAndPay } from 'helius-sdk/auth/upgradePlan';
import {
  purchaseCredits as sdkPurchaseCredits,
  purchaseCreditsAndPay,
} from 'helius-sdk/auth/purchaseCredits';
import { payRenewal, payRenewalAndPay } from 'helius-sdk/auth/payRenewal';
import { MCP_USER_AGENT } from '../http.js';
import {
  setApiKey,
  hasApiKey,
  setSessionSecretKey,
  setSessionWalletAddress,
  loadSignerOrFail,
} from '../utils/helius.js';
import { mcpText, mcpError, handleToolError } from '../utils/errors.js';
import { isSharedCredentialMode, sharedCredentialRefusal, SHARED_CREDENTIAL_META } from '../utils/runtime.js';
import { fetchDoc, extractSections } from '../utils/docs.js';
import { sendFeedbackEvent, captureWalletAddress } from '../utils/feedback.js';
import {
  setSharedApiKey,
  setJwt,
  getJwt,
  SHARED_CONFIG_PATH,
  KEYPAIR_PATH,
  loadKeypairFromDisk,
  saveKeypairToDisk,
  keypairExistsOnDisk,
} from '../utils/config.js';
import { HELIUS_PLANS } from './plans.js';

type SupportedPlan = 'agent' | 'developer' | 'business' | 'professional';

const renderPaymentLink = (
  paymentLink: {
    paymentUrl: string;
    paymentIntentId: string;
    amountCents: number;
    destinationWallet: string;
    memo: string;
    planName: string;
    expiresAt: string;
  },
  flowName: string,
  resumeCmd: string,
): string =>
  `**${flowName}: payment required**\n\n` +
  `Open this link in a browser to pay:\n\n` +
  `\`${paymentLink.paymentUrl}\`\n\n` +
  `Or send USDC + memo manually:\n` +
  `- **Amount:** ${paymentLink.amountCents / 100} USDC\n` +
  `- **Treasury:** \`${paymentLink.destinationWallet}\`\n` +
  `- **Memo:** \`${paymentLink.memo}\`\n` +
  `- **Plan:** ${paymentLink.planName}\n\n` +
  `After paying, call \`${resumeCmd}\` to confirm activation locally.`;

export function registerAuthTools(server: McpServer) {
  // ── Getting Started ──

  server.tool(
    'getStarted',
    'Get setup instructions for Helius. Checks whether an API key is configured (not validated), whether a keypair exists on disk, and whether a JWT session is present, then tells you exactly what to do next. Call this when a user asks "how do I get started?" or needs onboarding help.',
    {},
    async () => {
      const lines: string[] = ['# Getting Started with Helius'];

      const apiKeyConfigured = hasApiKey();
      const hasKeypair = keypairExistsOnDisk();
      const jwt = getJwt();

      // Already fully set up
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
          '**IMPORTANT — if the user described a project they want to build, call `recommendStack` now.** It returns architecture recommendations with Helius products, MCP tools, credit costs, and reference files.',
        );
        return mcpText(lines.join('\n'));
      }

      // API key set but no JWT
      if (apiKeyConfigured) {
        lines.push(
          '',
          'Your API key is configured — all Helius tools are ready to use.',
          '',
          'To enable account-status info (plan, credits, rate limits), call `signup`. It will detect your existing account, no payment required.',
        );
        return mcpText(lines.join('\n'));
      }

      // No API key — need to set up
      lines.push(
        '',
        'You need a Helius API key to use these tools. Three paths:',
        '',
        '## Path A — I already have an API key',
        '',
        'Call `setHeliusApiKey` with your key from https://dashboard.helius.dev. All tools immediately available.',
        '',
        '## Path B — I have an existing dashboard.helius.dev account',
        '',
        'If you already signed up at https://dashboard.helius.dev (email, Google, GitHub, or SSO), run `helius login` in your terminal:',
        '',
        '```bash',
        'npx helius-cli@latest login',
        '```',
        '',
        'This opens your default browser to authenticate via OAuth/PKCE and writes a session token to `~/.helius/config.json`. This MCP picks it up automatically — no further setup. Then call `setHeliusApiKey` with one of your keys (visible via `helius apikeys`), or just call `getAccountStatus` to confirm the session.',
        '',
        '## Path C — Create a new account via crypto checkout',
        '',
        '1. Call `generateKeypair` to create (or load) a Solana wallet — required for every signup mode, including link mode (the wallet address is bound to the payment intent).',
        '2. Call `signup` with your email/name. By default (`mode: "link"`) it returns a hosted-checkout URL the user can open in a browser to pay with any wallet.',
        '3. After the user pays, call `signup` again with `mode: "resume"` to poll the intent and provision the API key.',
        '',
        'For an autopay flow that pays USDC directly from the local keypair, pass `mode: "autopay"` to `signup`. The wallet must hold ~0.001 SOL for fees and the plan amount in USDC.',
        '',
      );

      if (hasKeypair) {
        lines.push(
          `_(A keypair already exists at \`${KEYPAIR_PATH}\` — \`signup\` will reuse it; you can skip step 1.)_`,
          '',
        );
      }

      return mcpText(lines.join('\n'));
    },
  );

  // ── Keypair Generation ──

  server.tool(
    'generateKeypair',
    'Generate a new Solana keypair (or load the existing one from disk). Returns the wallet address. Required before any `signup` call — the wallet address is bound to the payment intent in both link and autopay modes.',
    {},
    async () => {
      // Would write a private key to the host's disk and install a signer every
      // caller shares.
      if (isSharedCredentialMode()) {
        return mcpError(sharedCredentialRefusal('Keypair generation'), SHARED_CREDENTIAL_META);
      }

      try {
        const existingKey = loadKeypairFromDisk();
        if (existingKey) {
          const walletKeypair = loadKeypair(existingKey);
          const address = await getAddress(walletKeypair);
          setSessionSecretKey(existingKey);
          setSessionWalletAddress(address);
          captureWalletAddress(address);

          return mcpText(
            `**Existing Keypair Loaded** from \`${KEYPAIR_PATH}\`\n\n` +
              `**Wallet Address:** \`${address}\``,
          );
        }

        const keypair = await generateKeypair();
        const walletKeypair = loadKeypair(keypair.secretKey);
        const address = await getAddress(walletKeypair);

        saveKeypairToDisk(keypair.secretKey);
        setSessionSecretKey(keypair.secretKey);
        setSessionWalletAddress(address);
        captureWalletAddress(address);

        return mcpText(
          `**Keypair Generated**\n\n` +
            `**Wallet Address:** \`${address}\`\n` +
            `**Saved to:** \`${KEYPAIR_PATH}\``,
        );
      } catch (err) {
        return handleToolError(err, 'Error generating keypair');
      }
    },
  );

  // ── Signup ──

  server.tool(
    'signup',
    'Create a Helius account via crypto checkout. Requires `generateKeypair` to have been called first (the wallet address is bound to the payment intent in every mode). Default `mode: "link"` returns a hosted-checkout URL the user opens in a browser to pay USDC. `mode: "autopay"` sends USDC + memo directly from the local keypair. `mode: "resume"` polls a pending payment intent and provisions the API key after the user has paid in a browser. NOTE: resume strictly polls the JWT-bound project list and cannot distinguish "pending signup awaiting browser pay" from "stale JWT left over from a long-completed signup" — if the wallet already has an API key, prefer `setHeliusApiKey` over re-resuming.',
    {
      mode: z
        .enum(['link', 'autopay', 'resume'])
        .default('link')
        .describe(
          'link (default): print payment URL and exit. autopay: send USDC + memo from local keypair. resume: poll an in-flight payment intent.',
        ),
      plan: z
        .enum(['agent', 'developer', 'business', 'professional'])
        .default('agent')
        .describe('Plan: agent ($10 one-time, default), developer, business, professional'),
      period: z
        .enum(['monthly', 'yearly'])
        .optional()
        .describe('Billing period for subscription plans (default: monthly). Ignored for agent.'),
      email: z.string().email().optional().describe('Email (required for fresh signup; not needed for resume)'),
      firstName: z.string().optional().describe('First name (required for fresh signup)'),
      lastName: z.string().optional().describe('Last name (required for fresh signup)'),
      couponCode: z.string().optional().describe('Coupon code'),
      discoveryPath: z.string().optional().describe('How did you discover Helius?'),
      frictionPoints: z.string().optional().describe('What friction did you hit?'),
    },
    async ({ mode, plan, period, email, firstName, lastName, couponCode, discoveryPath, frictionPoints }) => {
      // Refuse up front rather than partway through. Every terminal branch calls
      // setApiKey() one line before rendering the provisioned key, so under a
      // shared credential the caller would pay, then get a SHARED_CREDENTIAL
      // throw instead of the key they just bought.
      if (isSharedCredentialMode()) {
        return mcpError(sharedCredentialRefusal('Account signup'), SHARED_CREDENTIAL_META);
      }

      if (discoveryPath || frictionPoints) {
        sendFeedbackEvent({
          type: 'discovery',
          discoveryPath,
          frictionPoints,
        });
      }

      try {
        // Resume mode: just poll the existing JWT/intent. Caller must have
        // already gone through link mode in a previous invocation; the JWT
        // from that invocation is on disk.
        if (mode === 'resume') {
          return await handleResumeSignup();
        }

        let signerData: { secretKey: Uint8Array; walletAddress: string };
        try {
          signerData = await loadSignerOrFail();
        } catch {
          return mcpError(
            'No signup keypair found. Call `generateKeypair` first to create a wallet, then retry.',
            { type: 'AUTH', code: 'NO_KEYPAIR', retryable: false, recovery: 'Call `generateKeypair`.' },
          );
        }

        if (mode === 'autopay') {
          const result = await signupAndPay({
            secretKey: signerData.secretKey,
            plan: plan as SupportedPlan,
            period,
            email,
            firstName,
            lastName,
            couponCode,
          });
          return renderSignupAndPayResult(result);
        }

        // mode === "link" (default)
        const result = await signup({
          secretKey: signerData.secretKey,
          plan: plan as SupportedPlan,
          period,
          email,
          firstName,
          lastName,
          couponCode,
        });

        if (result.kind === 'already_subscribed') {
          setApiKey(result.apiKey);
          setSharedApiKey(result.apiKey);
          setJwt(result.jwt);
          return mcpText(
            `**Helius Account Found**\n\n` +
              `You already have a Helius account on this plan. No payment was needed.\n\n` +
              `- **Project ID:** \`${result.projectId}\`\n` +
              `- **API Key:** \`${result.apiKey}\`\n` +
              `- **Mainnet RPC:** \`${result.endpoints.mainnet}\`\n` +
              `- **Devnet RPC:** \`${result.endpoints.devnet}\`\n\n` +
              `API key configured for this session and saved to \`${SHARED_CONFIG_PATH}\`.`,
          );
        }

        if (result.kind === 'upgrade_required') {
          return mcpText(
            `**Plan change required**\n\n` +
              `Your wallet is already on plan \`${result.currentPlan}\`. ` +
              `Use the \`upgradePlan\` tool to switch to \`${result.requestedPlan}\`.`,
          );
        }

        // payment_required — store JWT so resume mode can use it.
        setJwt(result.jwt);
        return mcpText(
          renderPaymentLink(result.paymentLink, 'Sign up', 'signup with mode: "resume"'),
        );
      } catch (err) {
        return handleToolError(err, 'Error during signup');
      }
    },
  );

  // ── Account Status ──

  server.tool(
    'getAccountStatus',
    'Check your Helius account status: current plan, remaining credits, rate limits, and billing cycle. Requires a JWT session (i.e., you signed up via `signup`). If you only have an API key configured, auth status is confirmed but credit data is unavailable — call `signup` to enable full status.',
    {},
    async () => {
      try {
        if (!hasApiKey()) {
          return mcpText(
            `## Account Status\n\n` +
              `**Auth:** Not authenticated\n\n` +
              `No API key or session found. To get started:\n` +
              `- If you have a key: use the \`setHeliusApiKey\` tool\n` +
              `- If you need an account: use \`signup\``,
          );
        }

        const jwt = getJwt();
        if (!jwt) {
          return mcpText(
            `## Account Status\n\n` +
              `**Auth:** Authenticated (API key configured)\n` +
              `**Credit usage:** Not available — no JWT session found\n\n` +
              `To see your plan, rate limits, and credit balance, call \`signup\`. Your existing account will be detected automatically — no payment needed.`,
          );
        }

        const projects = await listProjects(jwt, MCP_USER_AGENT);
        if (projects.length === 0) {
          return mcpError(
            'No projects found. Call `signup` to create an account first.',
            { type: 'AUTH', code: 'NO_PROJECT', retryable: false, recovery: 'Call `signup`.' },
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
        lines.push(`**Auth:** Authenticated`);
        lines.push(`**Plan:** ${planInfo ? planInfo.name : planKey}  |  **Project:** \`${projectId}\``);
        if (isUpgrading && upcomingPlan && upcomingPlan !== planKey) {
          lines.push(`**Upcoming plan:** ${upcomingPlan} (takes effect at next billing cycle)`);
        }

        try {
          const billingDoc = await fetchDoc('billing');
          const rateLimits = extractSections(billingDoc, ['standard rate limits', 'rate limits'], {
            includeLooseMatches: false,
          });
          if (rateLimits) {
            lines.push('', '### Rate Limits (live)', '', rateLimits);
          }
        } catch {
          // best-effort
        }

        if (usage) {
          const total = usage.remainingCredits + usage.totalCreditsUsed;
          const pctUsed = total > 0 ? ((usage.totalCreditsUsed / total) * 100).toFixed(1) : '0.0';
          const pctRemaining = total > 0 ? (100 - parseFloat(pctUsed)).toFixed(1) : '100.0';

          let cycleStr = '';
          if (cycle) {
            const end = new Date(cycle.end);
            const now = new Date();
            const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            cycleStr = ` (${cycle.start} - ${cycle.end}, ${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining)`;
          }

          lines.push('', `### Credits — Billing Cycle${cycleStr}`);
          lines.push(`- **Remaining:** ${usage.remainingCredits.toLocaleString()} / ${total.toLocaleString()}  (${pctRemaining}%)`);
          lines.push(`- **Used:** ${usage.totalCreditsUsed.toLocaleString()}  (${pctUsed}%)`);
        }

        return mcpText(lines.join('\n'));
      } catch (err) {
        return handleToolError(err, 'Error fetching account status');
      }
    },
  );

  // ── Upgrade ──

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
          return mcpError('Not authenticated. Call `signup`, or run `helius login` in your terminal if you have a dashboard.helius.dev account.', {
            type: 'AUTH',
            code: 'NOT_AUTHENTICATED',
            retryable: false,
            recovery: 'Call `signup`, or run `helius login` in your terminal if you already have a dashboard.helius.dev account.',
          });
        }

        const projects = await listProjects(jwt, MCP_USER_AGENT);
        if (projects.length === 0) {
          return mcpError('No projects found. Call `signup` to create an account first.', {
            type: 'AUTH',
            code: 'NO_PROJECT',
            retryable: false,
            recovery: 'Call `signup`.',
          });
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
        }
        text += `\n**Due Today: $${(preview.dueToday / 100).toFixed(2)}**\n`;
        text += `\nTo proceed, use the \`upgradePlan\` tool with plan: '${plan}'.`;
        return mcpText(text);
      } catch (err) {
        return handleToolError(err, 'Error previewing upgrade');
      }
    },
  );

  server.tool(
    'upgradePlan',
    'Upgrade your Helius plan via crypto checkout. Default `mode: "link"` returns a hosted-checkout URL. `mode: "autopay"` pays USDC from the local keypair and polls. Contact info (email/firstName/lastName) is only needed for first-time upgrades — backend auto-fetches from existing customer otherwise.',
    {
      mode: z.enum(['link', 'autopay']).default('link').describe('link (default) or autopay'),
      plan: z.enum(['developer', 'business', 'professional']).describe('Target plan name'),
      period: z.enum(['monthly', 'yearly']).default('monthly').describe('Billing period'),
      couponCode: z.string().optional().describe('Optional coupon code'),
      email: z.string().email().optional().describe('Email (only for first-time upgrades)'),
      firstName: z.string().optional().describe('First name (only for first-time upgrades)'),
      lastName: z.string().optional().describe('Last name (only for first-time upgrades)'),
    },
    async ({ mode, plan, period, couponCode, email, firstName, lastName }) => {
      try {
        const jwt = getJwt();
        if (!jwt) {
          return mcpError('Not authenticated. Call `signup`, or run `helius login` in your terminal if you have a dashboard.helius.dev account.', {
            type: 'AUTH',
            code: 'NOT_AUTHENTICATED',
            retryable: false,
            recovery: 'Call `signup`, or run `helius login` in your terminal if you already have a dashboard.helius.dev account.',
          });
        }

        const projects = await listProjects(jwt, MCP_USER_AGENT);
        if (projects.length === 0) {
          return mcpError('No projects found. Call `signup` first.', {
            type: 'AUTH',
            code: 'NO_PROJECT',
            retryable: false,
            recovery: 'Call `signup`.',
          });
        }
        const projectId = projects[0].id;

        if (mode === 'autopay') {
          let signerData: { secretKey: Uint8Array; walletAddress: string };
          try {
            signerData = await loadSignerOrFail();
          } catch {
            return mcpError('No keypair. Autopay needs one — call `generateKeypair` first.', {
              type: 'AUTH',
              code: 'NO_KEYPAIR',
              retryable: false,
              recovery: 'Call `generateKeypair`.',
            });
          }
          const result = await upgradePlanAndPay({
            secretKey: signerData.secretKey,
            jwt,
            projectId,
            plan,
            period,
            couponCode,
            email,
            firstName,
            lastName,
          });
          return renderUpgradeOrCreditsAndPayResult(result, 'Upgrade');
        }

        // mode === "link"
        const result = await upgradePlan({
          jwt,
          projectId,
          plan,
          period,
          couponCode,
          email,
          firstName,
          lastName,
        });
        return mcpText(renderPaymentLink(result.paymentLink, 'Upgrade', 'getAccountStatus'));
      } catch (err) {
        return handleToolError(err, 'Error upgrading plan');
      }
    },
  );

  // ── Prepaid Credits ──

  server.tool(
    'purchaseCredits',
    'Buy prepaid credits as a one-time USDC top-up. AGENT PLAN ONLY: each unit of `qty` is 1,000,000 credits at $10 USDC, no recurring sub. Subscription plans (Developer / Business / Professional) get monthly allotments and overage is auto-billed at $5/M on the next invoice — they can NOT use this tool; this tool will reject the call with UNSUPPORTED_PLAN. Default `mode: "link"` returns a hosted-checkout URL; `mode: "autopay"` pays USDC from the local keypair and polls.',
    {
      mode: z.enum(['link', 'autopay']).default('link').describe('link (default) or autopay'),
      qty: z.number().int().min(1).default(1).describe('Quantity multiplier (each unit = 1M credits at $10 USDC)'),
      couponCode: z.string().optional().describe('Optional coupon code'),
    },
    async ({ mode, qty, couponCode }) => {
      try {
        const jwt = getJwt();
        if (!jwt) {
          return mcpError('Not authenticated. Call `signup`, or run `helius login` in your terminal if you have a dashboard.helius.dev account.', {
            type: 'AUTH',
            code: 'NOT_AUTHENTICATED',
            retryable: false,
            recovery: 'Call `signup`, or run `helius login` in your terminal if you already have a dashboard.helius.dev account.',
          });
        }

        const projects = await listProjects(jwt, MCP_USER_AGENT);
        if (projects.length === 0) {
          return mcpError('No projects found. Call `signup` first.', {
            type: 'AUTH',
            code: 'NO_PROJECT',
            retryable: false,
            recovery: 'Call `signup`.',
          });
        }
        const projectId = projects[0].id;

        // Pre-flight plan check. SDK will reject non-Agent plans, but its
        // error path surfaces as a generic SDK_ERROR; intercepting here gives
        // the agent a clean, structured error with the correct semantics.
        const projectPlan = projects[0].subscription?.plan;
        const normalizedPlan = projectPlan?.replace(/_v\d+$/, '');
        if (normalizedPlan && normalizedPlan !== 'agent') {
          return mcpError(
            `Prepaid credits via \`purchaseCredits\` are only available on the Agent plan. ` +
              `Project ${projectId} is on the ${normalizedPlan} plan, where credit overage ` +
              `is auto-billed at $5 per 1,000,000 credits on the next invoice — there's no ` +
              `manual top-up flow. To preview your usage, call \`getAccountStatus\`.`,
            {
              type: 'UNSUPPORTED',
              code: 'UNSUPPORTED_PLAN',
              retryable: false,
              recovery: 'Use the dashboard to manage subscription overage, or call `getAccountStatus` to inspect usage.',
            },
          );
        }

        if (mode === 'autopay') {
          let signerData: { secretKey: Uint8Array; walletAddress: string };
          try {
            signerData = await loadSignerOrFail();
          } catch {
            return mcpError('No keypair. Autopay needs one — call `generateKeypair` first.', {
              type: 'AUTH',
              code: 'NO_KEYPAIR',
              retryable: false,
              recovery: 'Call `generateKeypair`.',
            });
          }
          const result = await purchaseCreditsAndPay({
            secretKey: signerData.secretKey,
            jwt,
            projectId,
            qty,
            couponCode,
          });
          return renderUpgradeOrCreditsAndPayResult(result, 'Credits top-up');
        }

        const result = await sdkPurchaseCredits({ jwt, projectId, qty, couponCode });
        return mcpText(renderPaymentLink(result.paymentLink, 'Credits top-up', 'getAccountStatus'));
      } catch (err) {
        return handleToolError(err, 'Error purchasing credits');
      }
    },
  );

  // ── Renewal Pay ──

  server.tool(
    'payRenewal',
    'Pay an existing renewal payment intent. Default `mode: "link"` returns the hosted-checkout URL for the renewal. `mode: "autopay"` pays USDC from the local keypair.',
    {
      mode: z.enum(['link', 'autopay']).default('link').describe('link (default) or autopay'),
      paymentIntentId: z.string().describe('Payment intent ID from renewal notification'),
    },
    async ({ mode, paymentIntentId }) => {
      try {
        const jwt = getJwt();
        if (!jwt) {
          return mcpError('Not authenticated. Call `signup`, or run `helius login` in your terminal if you have a dashboard.helius.dev account.', {
            type: 'AUTH',
            code: 'NOT_AUTHENTICATED',
            retryable: false,
            recovery: 'Call `signup`, or run `helius login` in your terminal if you already have a dashboard.helius.dev account.',
          });
        }

        if (mode === 'autopay') {
          let signerData: { secretKey: Uint8Array; walletAddress: string };
          try {
            signerData = await loadSignerOrFail();
          } catch {
            return mcpError('No keypair. Autopay needs one — call `generateKeypair` first.', {
              type: 'AUTH',
              code: 'NO_KEYPAIR',
              retryable: false,
              recovery: 'Call `generateKeypair`.',
            });
          }
          const result = await payRenewalAndPay(signerData.secretKey, jwt, paymentIntentId);
          return renderUpgradeOrCreditsAndPayResult(result, 'Renewal');
        }

        const result = await payRenewal(jwt, paymentIntentId);
        return mcpText(renderPaymentLink(result.paymentLink, 'Renewal', 'payRenewal again with mode: "autopay" or open the link'));
      } catch (err) {
        return handleToolError(err, 'Error processing renewal payment');
      }
    },
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Resume / result rendering helpers
// ────────────────────────────────────────────────────────────────────────────

async function handleResumeSignup() {
  const jwt = getJwt();
  if (!jwt) {
    return mcpError('No pending signup. Call `signup` (link mode) first.', {
      type: 'AUTH',
      code: 'NOT_AUTHENTICATED',
      retryable: false,
      recovery: 'Call `signup`.',
    });
  }
  const projects = await listProjects(jwt, MCP_USER_AGENT);
  if (projects.length === 0) {
    return mcpText(
      'Payment not yet provisioned on the backend. The webhook may still be processing — try again in a moment.',
    );
  }
  const projectId = projects[0].id;
  const details = await getProject(jwt, projectId, MCP_USER_AGENT);
  const apiKey = details.apiKeys?.[0]?.keyId;
  if (!apiKey) {
    return mcpText(
      'Project is provisioned but no API key has been generated yet. Try again in a moment.',
    );
  }
  setApiKey(apiKey);
  setSharedApiKey(apiKey);
  return mcpText(
    `**Signup complete!**\n\n` +
      `- **Project ID:** \`${projectId}\`\n` +
      `- **API Key:** \`${apiKey}\`\n\n` +
      `API key configured for this session and saved to \`${SHARED_CONFIG_PATH}\`. All Helius tools are ready to use.`,
  );
}

type SignupAndPayResult = import('helius-sdk/auth/types').SignupAndPayResult;

function renderSignupAndPayResult(result: SignupAndPayResult): { content: { type: 'text'; text: string }[] } {
  switch (result.kind) {
    case 'completed':
      setApiKey(result.apiKey);
      setSharedApiKey(result.apiKey);
      setJwt(result.jwt);
      return mcpText(
        `**Helius Account Created**\n\n` +
          `- **Project ID:** \`${result.projectId}\`\n` +
          `- **API Key:** \`${result.apiKey}\`\n` +
          `- **Mainnet RPC:** \`${result.endpoints.mainnet}\`\n` +
          (result.txSignature ? `- **Payment TX:** \`${result.txSignature}\`\n` : '') +
          `\nAPI key configured for this session and saved to \`${SHARED_CONFIG_PATH}\`.`,
      );
    case 'already_subscribed':
      setApiKey(result.apiKey);
      setSharedApiKey(result.apiKey);
      setJwt(result.jwt);
      return mcpText(
        `**Helius Account Found**\n\n` +
          `You already have a Helius account on this plan. No payment was needed.\n\n` +
          `- **Project ID:** \`${result.projectId}\`\n` +
          `- **API Key:** \`${result.apiKey}\`\n` +
          `\nAPI key configured for this session.`,
      );
    case 'upgrade_required':
      return mcpText(
        `**Plan change required**\n\n` +
          `Your wallet is already on plan \`${result.currentPlan}\`. ` +
          `Use the \`upgradePlan\` tool to switch to \`${result.requestedPlan}\`.`,
      );
    case 'pending':
      setJwt(result.jwt);
      return mcpText(
        `**Payment sent — activation pending**\n\n` +
          `USDC was sent (tx: \`${result.txSignature ?? 'unknown'}\`) but the backend hasn't finished provisioning yet.\n\n` +
          `Call \`signup\` with \`mode: "resume"\` to try again.`,
      );
    case 'expired':
      return mcpError(
        `Payment intent expired (\`${result.paymentIntentId}\`). Run \`signup\` again to start a fresh one.`,
        { type: 'API', code: 'EXPIRED', retryable: false, recovery: 'Run `signup` again.' },
      );
    case 'failed':
      return mcpError(
        `Payment failed: ${result.reason ?? 'unknown reason'} (intent \`${result.paymentIntentId}\`).`,
        { type: 'API', code: 'OPERATION_FAILED', retryable: false, recovery: 'Contact support if this persists.' },
      );
    default: {
      const _exhaustive: never = result;
      throw new Error(`Unhandled result kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

type UpgradeAndPayResult = import('helius-sdk/auth/types').UpgradePlanAndPayResult;

function renderUpgradeOrCreditsAndPayResult(
  result: UpgradeAndPayResult,
  flowName: string,
): { content: { type: 'text'; text: string }[] } {
  switch (result.kind) {
    case 'completed':
      return mcpText(
        `**${flowName} complete!**\n\n` +
          (result.txSignature ? `- **TX:** \`${result.txSignature}\`\n` : '') +
          `- **Payment Intent:** \`${result.paymentIntentId}\``,
      );
    case 'pending':
      return mcpText(
        `**Payment sent — activation pending**\n\n` +
          `USDC was sent (tx: \`${result.txSignature ?? 'unknown'}\`). The backend is still processing.\n\n` +
          `Call this tool again or check \`getAccountStatus\` shortly.`,
      );
    case 'expired':
      return mcpError(
        `Payment intent expired (\`${result.paymentIntentId}\`). Run the tool again to start fresh.`,
        { type: 'API', code: 'EXPIRED', retryable: false, recovery: 'Retry from scratch.' },
      );
    case 'failed':
      return mcpError(
        `Payment failed: ${result.reason ?? 'unknown reason'} (intent \`${result.paymentIntentId}\`).`,
        { type: 'API', code: 'OPERATION_FAILED', retryable: false, recovery: 'Contact support if this persists.' },
      );
    default: {
      const _exhaustive: never = result;
      throw new Error(`Unhandled result kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
