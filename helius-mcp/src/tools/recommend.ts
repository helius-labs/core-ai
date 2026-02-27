import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpText } from '../utils/errors.js';
import { hasApiKey } from '../utils/helius.js';
import { getPreferences, savePreferences, getJwt } from '../utils/config.js';
import { HELIUS_PLANS } from './plans.js';
import { listProjects } from 'helius-sdk/auth/listProjects';
import { getProject } from 'helius-sdk/auth/getProject';
import { MCP_USER_AGENT } from '../http.js';
import { PROJECT_TEMPLATES } from './project-templates.js';
import type { ProjectTemplate, TierRecommendation, ProductRecommendation } from './project-templates.js';

// ─── Known MCP Tools (for validation script) ───

export const KNOWN_TOOLS = new Set([
  'getStarted', 'setHeliusApiKey', 'generateKeypair', 'checkSignupBalance',
  'agenticSignup', 'getAccountStatus', 'previewUpgrade', 'upgradePlan', 'payRenewal',
  'getBalance', 'getTokenBalances', 'getWalletBalances',
  'parseTransactions', 'getTransactionHistory', 'getWalletHistory', 'getWalletTransfers',
  'getAsset', 'getAssetsByOwner', 'searchAssets', 'getAssetsByGroup',
  'getAssetProof', 'getAssetProofBatch', 'getSignaturesForAsset', 'getNftEditions',
  'getAccountInfo', 'getTokenAccounts', 'getProgramAccounts', 'getTokenHolders',
  'getBlock', 'getNetworkStatus',
  'getPriorityFeeEstimate',
  'createWebhook', 'getAllWebhooks', 'getWebhookByID', 'updateWebhook', 'deleteWebhook',
  'transactionSubscribe', 'accountSubscribe', 'getEnhancedWebSocketInfo',
  'laserstreamSubscribe', 'getLaserstreamInfo',
  'getWalletIdentity', 'batchWalletIdentity', 'getWalletFundedBy',
  'getHeliusPlanInfo', 'compareHeliusPlans',
  'lookupHeliusDocs', 'listHeliusDocTopics', 'getHeliusCreditsInfo', 'getRateLimitInfo',
  'troubleshootError', 'getSenderInfo', 'getWebhookGuide', 'getLatencyComparison', 'getPumpFunGuide',
  'recommendStack',
]);

// ─── Plan Ranking ───

export const PLAN_RANK: Record<string, number> = { free: 0, developer: 1, business: 2, professional: 3 };

function planAtOrBelow(plan: string, maxPlan: string): boolean {
  return (PLAN_RANK[plan] ?? 99) <= (PLAN_RANK[maxPlan] ?? 99);
}

// ─── Formatting ───

const TIER_DISPLAY: Record<string, string> = { budget: 'Budget', standard: 'Standard', production: 'Production' };
const COMPLEXITY_LABEL: Record<string, string> = { low: 'budget', medium: 'standard', high: 'production' };

function formatTier(tier: TierRecommendation, detectedPlan?: string): string {
  const planInfo = HELIUS_PLANS[tier.minimumPlan];
  const planPrice = planInfo ? planInfo.price : tier.minimumPlan;
  const planName = planInfo ? planInfo.name : tier.minimumPlan;

  let heading = `## ${TIER_DISPLAY[tier.tier]} Tier`;
  if (detectedPlan) {
    if (planAtOrBelow(tier.minimumPlan, detectedPlan)) {
      heading += ` — Available on your plan`;
    } else {
      heading += ` — Requires ${planName} (${planPrice})`;
    }
  }

  const lines: string[] = [
    heading,
    `**Plan:** ${planName} (${planPrice}) | **Complexity:** ${tier.complexity === 'low' ? 'Beginner-friendly' : tier.complexity === 'medium' ? 'Intermediate' : 'Advanced'}`,
    '',
    '### What to use:',
    '',
  ];

  for (const product of tier.products) {
    const productPlan = HELIUS_PLANS[product.minimumPlan];
    const productPlanName = productPlan ? productPlan.name : product.minimumPlan;
    lines.push(
      `**${product.product}** — ${product.plainEnglish}`,
      `- Why: ${product.why}`,
      `- Tools: ${product.mcpTools.map(t => '`' + t + '`').join(', ')}`,
      `- Cost: ${product.creditCostPerCall}, ${product.callPattern}`,
      `- Requires: ${productPlanName} plan`,
      '',
    );
  }

  lines.push('### Limitations:');
  for (const limitation of tier.limitations) {
    lines.push(`- ${limitation}`);
  }

  lines.push('');
  lines.push(`### To implement, read: ${tier.references.map(r => '`' + r + '`').join(', ')}`);

  return lines.join('\n');
}

function formatUpgradeTier(tier: TierRecommendation): string {
  const planInfo = HELIUS_PLANS[tier.minimumPlan];
  const planPrice = planInfo ? planInfo.price : tier.minimumPlan;
  const planName = planInfo ? planInfo.name : tier.minimumPlan;
  const planCredits = planInfo ? planInfo.credits : '';
  const planRps = planInfo ? planInfo.rateLimit.rpc : '';

  const productNames = tier.products.map(p => p.product);
  const capabilities = tier.products.map(p => p.plainEnglish);
  const productLine = `Adds: ${productNames.join(', ')} (${capabilities[0]})`;

  const statsLine = planInfo
    ? `${planInfo.rateLimit.sendTransaction} send rate, ${planCredits} credits/month, ${planRps}`
    : `Requires ${planName}`;

  const refsLine = `Read: ${tier.references.map(r => '`' + r + '`').join(', ')}`;

  return [
    `### ${TIER_DISPLAY[tier.tier]} Tier — Requires ${planName} (${planPrice})`,
    productLine,
    statsLine,
    refsLine,
  ].join('\n');
}

function formatRecommendation(
  template: ProjectTemplate,
  availableTiers: TierRecommendation[],
  upgradeTiers: TierRecommendation[],
  description: string,
  complexity: 'low' | 'medium' | 'high' | undefined,
  detectedPlan?: string,
): string {
  const lines: string[] = [
    `# Architecture Recommendation: ${template.name}`,
    '',
    `> "${description}"`,
    '',
  ];

  if (detectedPlan) {
    const planInfo = HELIUS_PLANS[detectedPlan];
    if (planInfo) {
      lines.push(
        `**Your plan:** ${planInfo.name} (${planInfo.price}) — ${planInfo.credits} credits/month, ${planInfo.rateLimit.rpc}`,
        '',
      );
    }
  }

  lines.push('---', '');

  if (complexity) {
    lines.push(`_Showing ${COMPLEXITY_LABEL[complexity]} complexity tier_`, '', '---', '');
  }

  for (let i = 0; i < availableTiers.length; i++) {
    lines.push(formatTier(availableTiers[i], detectedPlan));
    if (i < availableTiers.length - 1) {
      lines.push('', '---', '');
    }
  }

  if (upgradeTiers.length > 0) {
    lines.push('', '---', '', '## Upgrade Paths', '');
    for (let i = 0; i < upgradeTiers.length; i++) {
      lines.push(formatUpgradeTier(upgradeTiers[i]));
      if (i < upgradeTiers.length - 1) {
        lines.push('');
      }
    }
  }

  lines.push(
    '',
    '---',
    '',
    '## Estimate your monthly cost',
    'credits/month = (calls per user per day) x (credits per call) x (active users) x 30',
    'Use `getRateLimitInfo` for exact per-method credit costs.',
    '',
    '## Next steps',
    '1. Pick a tier → `getHeliusPlanInfo` for full plan details',
    '2. Read the reference files listed above',
    '3. Start building with the MCP tools listed',
  );

  return lines.join('\n');
}

// ─── Tool Registration ───

export function registerRecommendTools(server: McpServer) {
  server.tool(
    'recommendStack',
    'BEST FOR: ANY time a user describes a Solana project, app, or tool they want to build. ' +
    'Call this immediately when the user says they want to build, make, or create something — ' +
    'do not ask clarifying questions first. Examples: "I want to build a PnL tracker", ' +
    '"make a tax reporting tool", "create a token sniper", "I need an NFT gallery". ' +
    'PREFER getHeliusPlanInfo for pricing-only questions. ' +
    'PREFER lookupHeliusDocs for specific API docs. Returns tiered architecture ' +
    'recommendations: which Helius products to use, why, which MCP tools to call, ' +
    'credit costs per call, minimum plan required, and reference files to read. ' +
    'Supports saved preferences for budget and complexity level.',
    {
      description: z.string().describe('What the user wants to build, in their own words'),
      projectType: z.enum([
        'portfolio-tracker', 'trading-bot', 'nft-marketplace',
        'blockchain-explorer', 'notification-system', 'data-indexer',
        'wallet-analytics', 'token-launch', 'general',
      ]).optional().describe('Optional classifier — omit for the general capability catalog'),
      budget: z.enum(['free', 'developer', 'business', 'professional']).optional(),
      complexity: z.enum(['low', 'medium', 'high']).optional(),
      scale: z.enum(['budget', 'standard', 'production', 'all']).optional().default('all'),
      remember: z.boolean().optional().describe('Save budget/complexity preferences for future sessions'),
    },
    async ({ description, projectType, budget, complexity, scale, remember }) => {
      // 1. Load saved preferences, merge with provided params
      const savedPrefs = getPreferences();
      const effectiveBudget = budget ?? savedPrefs.budget;
      const effectiveComplexity = complexity ?? savedPrefs.complexity;

      // 2. Save preferences if requested
      if (remember) {
        savePreferences({
          budget: effectiveBudget,
          complexity: effectiveComplexity,
        });
      }

      // 3. Detect current plan from JWT
      const VALID_PLANS = new Set(Object.keys(PLAN_RANK));
      let detectedPlan: string | undefined;
      const jwt = getJwt();
      if (jwt) {
        try {
          const projects = await listProjects(jwt, MCP_USER_AGENT);
          if (projects.length > 0) {
            const details = await getProject(jwt, projects[0].id, MCP_USER_AGENT);
            const raw = details.subscriptionPlanDetails?.currentPlan?.trim().toLowerCase();
            if (raw && VALID_PLANS.has(raw)) {
              detectedPlan = raw;
            }
          }
        } catch {
          // Silent fallback — plan detection is best-effort
        }
      }

      // 4. Look up template (or fall back to general)
      const template = PROJECT_TEMPLATES[projectType ?? 'general'];

      // 5. Filter tiers by scale and/or budget
      let tiers = template.tiers;

      if (scale !== 'all') {
        tiers = tiers.filter(t => t.tier === scale);
      }

      if (effectiveBudget) {
        tiers = tiers.filter(t => planAtOrBelow(t.minimumPlan, effectiveBudget));
      }

      // 5b. Filter by complexity (maps 1:1 to tier: low=budget, medium=standard, high=production)
      if (effectiveComplexity) {
        const targetTier = COMPLEXITY_LABEL[effectiveComplexity];
        tiers = tiers.filter(t => t.tier === targetTier);
      }

      if (tiers.length === 0) {
        return mcpText(
          `# Architecture Recommendation: ${template.name}\n\n` +
          `> "${description}"\n\n` +
          'No tiers match your current filters. Try:\n' +
          '- Increasing your `budget` (e.g., `developer`, `business`)\n' +
          '- Setting `scale` to `all` to see all tiers\n' +
          '- Removing filters to see the full recommendation'
        );
      }

      // 6. Partition tiers when plan is detected and no explicit budget filter
      const shouldSplit = detectedPlan && !budget && !savedPrefs.budget;
      let availableTiers: TierRecommendation[] = tiers;
      let upgradeTiers: TierRecommendation[] = [];

      if (shouldSplit) {
        const available = tiers.filter(t => planAtOrBelow(t.minimumPlan, detectedPlan!));
        const upgrades = tiers.filter(t => !planAtOrBelow(t.minimumPlan, detectedPlan!));
        // Only split if at least one tier is available; otherwise show all with labels
        if (available.length > 0) {
          availableTiers = available;
          upgradeTiers = upgrades;
        }
      }

      // 7. Format output
      let output = formatRecommendation(template, availableTiers, upgradeTiers, description, effectiveComplexity, detectedPlan);

      // 8. Soft hint: if no API key, append setup note
      if (!hasApiKey()) {
        output += '\n\n---\n\n> **Setup needed:** You\'ll need a Helius API key to use these tools. Call `getStarted` for setup instructions.';
      }

      return mcpText(output);
    }
  );
}

export { PROJECT_TEMPLATES };
export type { ProjectTemplate, TierRecommendation, ProductRecommendation };
