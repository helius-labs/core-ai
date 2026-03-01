import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpText } from '../utils/errors.js';
import { hasApiKey } from '../utils/helius.js';
import { getPreferences, savePreferences } from '../utils/config.js';
import { HELIUS_PLANS, detectCurrentPlan } from './plans.js';
import { PRODUCT_CATALOG, CatalogProduct } from './product-catalog.js';
// fetchDoc/extractSections no longer needed — live billing fetch removed


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

// ─── Plan Limitations ───

function derivePlanLimitations(minimumPlan: string): string[] {
  const plan = HELIUS_PLANS[minimumPlan];
  if (!plan) return [];

  const limitations: string[] = [];

  limitations.push(`${plan.name} plan — see \`getHeliusPlanInfo\` for credits and rate limits`);

  const gates: string[] = [];
  if (!plan.features.enhancedWebSockets) gates.push('Enhanced WebSockets');
  if (!plan.features.laserstream) {
    gates.push('Laserstream');
  } else if (typeof plan.features.laserstream === 'string' && plan.features.laserstream.toLowerCase().includes('devnet only')) {
    limitations.push('Laserstream limited to devnet');
  }

  if (gates.length > 0) limitations.push(`No ${gates.join(' or ')}`);

  return limitations;
}

// ─── Tier Grouping ───

interface CatalogTier {
  tier: 'budget' | 'standard' | 'production';
  tierPlan: string; // the minimumPlan that defines this tier
  products: CatalogProduct[];
}

const TIER_MAP: Record<string, 'budget' | 'standard' | 'production'> = {
  free: 'budget',
  developer: 'standard',
  business: 'production',
  professional: 'production',
};

const TIER_DISPLAY: Record<string, string> = { budget: 'Free', standard: 'Developer', production: 'Business / Professional' };
const TIER_PLANS: Record<string, string> = { budget: 'free', standard: 'developer', production: 'business' };

function groupCatalogByTier(): CatalogTier[] {
  const groups: Record<string, CatalogProduct[]> = { budget: [], standard: [], production: [] };

  for (const product of Object.values(PRODUCT_CATALOG)) {
    const tier = TIER_MAP[product.minimumPlan] ?? 'production';
    groups[tier].push(product);
  }

  const tiers: CatalogTier[] = [];
  if (groups.budget.length > 0) tiers.push({ tier: 'budget', tierPlan: 'free', products: groups.budget });
  if (groups.standard.length > 0) tiers.push({ tier: 'standard', tierPlan: 'developer', products: groups.standard });
  if (groups.production.length > 0) tiers.push({ tier: 'production', tierPlan: 'business', products: groups.production });

  return tiers;
}

// ─── Formatting ───

function formatProduct(product: CatalogProduct): string {
  const docs = product.referenceFile ? ` | Docs: \`${product.referenceFile}\`` : '';
  return `- **${product.name}** \u2014 ${product.description} (${product.creditCostPerCall})${docs}\n  Tools: ${product.mcpTools.map(t => '`' + t + '`').join(', ')}`;
}

function formatTier(tier: CatalogTier, detectedPlan?: string): string {
  const tierLabel = TIER_DISPLAY[tier.tier];

  let heading = `## ${tierLabel} Tier`;
  if (detectedPlan) {
    if (planAtOrBelow(tier.tierPlan, detectedPlan)) {
      heading += ` \u2014 Available on your plan`;
    } else {
      heading += ` \u2014 Requires upgrade`;
    }
  }

  const lines: string[] = [heading, ''];

  for (const product of tier.products) {
    lines.push(formatProduct(product), '');
  }

  const limitations = derivePlanLimitations(tier.tierPlan);
  if (limitations.length > 0) {
    lines.push(`### ${tierLabel} Tier Limits`);
    for (const lim of limitations) {
      lines.push(`- ${lim}`);
    }
  }

  return lines.join('\n');
}

function formatUpgradeTier(tier: CatalogTier): string {
  const planInfo = HELIUS_PLANS[tier.tierPlan];
  const planName = planInfo ? planInfo.name : tier.tierPlan;
  const tierLabel = TIER_DISPLAY[tier.tier];

  const productNames = tier.products.map(p => p.name);
  const firstDesc = tier.products[0].description.split('.')[0];
  const addsLine = `Adds: ${productNames.join(', ')} \u2014 ${firstDesc}`;

  const refs = tier.products
    .filter(p => p.referenceFile)
    .map(p => `\`${p.referenceFile}\``);
  const refsLine = refs.length > 0 ? `Read: ${refs.join(', ')}` : '';

  const lines = [
    `### ${tierLabel} Tier \u2014 Requires ${planName} plan`,
    addsLine,
  ];
  if (refsLine) lines.push(refsLine);

  return lines.join('\n');
}

function formatCatalog(
  availableTiers: CatalogTier[],
  upgradeTiers: CatalogTier[],
  description: string,
  complexity: 'low' | 'medium' | 'high' | undefined,
  detectedPlan?: string,
): string {
  const lines: string[] = ['# Helius Product Catalog', ''];

  lines.push(`> "${description}"`, '');

  if (detectedPlan) {
    const planInfo = HELIUS_PLANS[detectedPlan];
    if (planInfo) {
      lines.push(
        `**Your plan:** ${planInfo.name}`,
        '',
      );
    }
  }

  lines.push('---', '');

  if (complexity) {
    const label: Record<string, string> = { low: 'free tier only', medium: 'free + developer tiers', high: 'all tiers' };
    lines.push(`_Showing ${label[complexity]}_`, '', '---', '');
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
    '_Use `getHeliusPlanInfo` for pricing and `lookupHeliusDocs` for API details._',
    '',
    '*Token tip: Use batch endpoints and `section` filters on `lookupHeliusDocs` to minimize per-call context usage.*',
  );

  return lines.join('\n');
}

// ─── Filtering ───

const COMPLEXITY_MAX_TIER: Record<string, string[]> = {
  low: ['budget'],
  medium: ['budget', 'standard'],
  high: ['budget', 'standard', 'production'],
};

const SCALE_TIERS: Record<string, string[]> = {
  budget: ['budget'],
  standard: ['standard'],
  production: ['production'],
  all: ['budget', 'standard', 'production'],
};

// ─── Tool Registration ───

export function registerRecommendTools(server: McpServer) {
  server.tool(
    'recommendStack',
    'BEST FOR: project architecture when user describes a Solana app to build. PREFER getHeliusPlanInfo for pricing-only, lookupHeliusDocs for API docs. Get tiered architecture recommendations. Returns Helius products, MCP tools, credit costs, minimum plan, and reference files.',
    {
      description: z.string().describe('What the user wants to build, in their own words'),
      budget: z.enum(['free', 'developer', 'business', 'professional']).optional(),
      complexity: z.enum(['low', 'medium', 'high']).optional(),
      scale: z.enum(['budget', 'standard', 'production', 'all']).optional().default('all'),
      remember: z.boolean().optional().describe('Save budget/complexity preferences for future sessions'),
    },
    async ({ description, budget, complexity, scale, remember }) => {
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
      const detectedPlan = await detectCurrentPlan();

      // 4. Group catalog into tiers
      let tiers = groupCatalogByTier();

      // 5. Apply filters (AND logic)
      if (scale !== 'all') {
        const allowed = SCALE_TIERS[scale] ?? [];
        tiers = tiers.filter(t => allowed.includes(t.tier));
      }

      if (effectiveComplexity) {
        const allowed = COMPLEXITY_MAX_TIER[effectiveComplexity] ?? [];
        tiers = tiers.filter(t => allowed.includes(t.tier));
      }

      if (effectiveBudget) {
        tiers = tiers.filter(t => planAtOrBelow(t.tierPlan, effectiveBudget));
      }

      if (tiers.length === 0) {
        return mcpText(
          `# Helius Product Catalog\n\n` +
          `> "${description}"\n\n` +
          'No tiers match your current filters. Try:\n' +
          '- Increasing your `budget` (e.g., `developer`, `business`)\n' +
          '- Setting `scale` to `all` to see all tiers\n' +
          '- Removing filters to see the full recommendation'
        );
      }

      // 6. Partition tiers when plan is detected and no explicit budget filter
      const shouldSplit = detectedPlan && !budget && !savedPrefs.budget;
      let availableTiers: CatalogTier[] = tiers;
      let upgradeTiers: CatalogTier[] = [];

      if (shouldSplit) {
        const available = tiers.filter(t => planAtOrBelow(t.tierPlan, detectedPlan!));
        const upgrades = tiers.filter(t => !planAtOrBelow(t.tierPlan, detectedPlan!));
        if (available.length > 0) {
          availableTiers = available;
          upgradeTiers = upgrades;
        }
      }

      // 7. Format output
      let output = formatCatalog(availableTiers, upgradeTiers, description, effectiveComplexity, detectedPlan);

      // 9. Soft hint: if no API key, append setup note
      if (!hasApiKey()) {
        output += '\n\n---\n\n> **Setup needed:** You\'ll need a Helius API key to use these tools. Call `getStarted` for setup instructions.';
      }

      return mcpText(output);
    }
  );
}
