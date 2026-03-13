import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchDoc, extractSections } from '../utils/docs.js';
import { mcpText, mcpError } from '../utils/errors.js';
import type { ErrorMeta } from '../utils/errors.js';
import { hasApiKey } from '../utils/helius.js';
import { getJwt } from '../utils/config.js';
import { listProjects } from 'helius-sdk/auth/listProjects';
import { getProject } from 'helius-sdk/auth/getProject';
import { MCP_USER_AGENT } from '../http.js';
import { PRODUCT_CATALOG, PLAN_RANK } from './product-catalog.js';

/**
 * Static plan metadata — NOT the source of truth for pricing or billing data.
 *
 * Remaining uses (no billing data should be served from here):
 * 1. Plan name lookup in auth.ts getAccountStatus
 * 2. Feature-gate booleans in recommend.ts derivePlanLimitations()
 * 3. Validation of minimumPlan keys in validate-catalog.ts
 *
 * All user-facing billing data (prices, credits, rate limits) is fetched live
 * from the billing docs via fetchDoc('billing').
 */
export const HELIUS_PLANS: Record<string, {
  name: string;
  features: Record<string, boolean | string>;
}> = {
  free: {
    name: 'Free',
    features: { webhooks: true, standardWebSockets: true, enhancedWebSockets: false, laserstream: false, stakedConnections: true, archivalData: true },
  },
  developer: {
    name: 'Developer',
    features: { webhooks: true, standardWebSockets: true, enhancedWebSockets: false, laserstream: 'Devnet only', stakedConnections: true, archivalData: true },
  },
  business: {
    name: 'Business',
    features: { webhooks: true, standardWebSockets: true, enhancedWebSockets: true, laserstream: 'Devnet only', stakedConnections: true, archivalData: true },
  },
  professional: {
    name: 'Professional',
    features: { webhooks: true, standardWebSockets: true, enhancedWebSockets: true, laserstream: 'Full access (mainnet + devnet)', stakedConnections: true, archivalData: true },
  },
};

const BILLING_FETCH_ERROR =
  'Could not fetch live billing data. Try:\n' +
  '- `lookupHeliusDocs({ topic: \'billing\' })` for full billing documentation\n' +
  '- Visit https://www.helius.dev/docs/billing directly';

const BILLING_FETCH_META: ErrorMeta = {
  type: 'API',
  code: 'FETCH_FAILED',
  retryable: true,
  recovery: 'Try lookupHeliusDocs({ topic: "billing" }) or visit https://www.helius.dev/docs/billing directly',
};

/**
 * Detect the user's current Helius plan from their JWT session.
 * Returns the plan key (e.g. "developer") or undefined if unavailable.
 * Best-effort — never throws.
 */
export async function detectCurrentPlan(): Promise<string | undefined> {
  const jwt = getJwt();
  if (!jwt) return undefined;
  try {
    const projects = await listProjects(jwt, MCP_USER_AGENT);
    if (projects.length > 0) {
      const details = await getProject(jwt, projects[0].id, MCP_USER_AGENT);
      const raw = details.subscriptionPlanDetails?.currentPlan?.trim().toLowerCase();
      if (raw && raw in HELIUS_PLANS) return raw;
    }
  } catch {
    // Best-effort — don't block the response
  }
  return undefined;
}

export function registerPlanTools(server: McpServer) {
  server.tool(
    'getHeliusPlanInfo',
    'BEST FOR: pricing and plan questions. PREFER compareHeliusPlans for side-by-side category comparisons, getRateLimitInfo for per-method credit costs. Get Helius plan pricing, credits, rate limits, and feature availability. Fetches live from billing docs.',
    {
      plan: z.enum(['free', 'developer', 'business', 'professional', 'all']).optional().default('all').describe('Specific plan to show details for, or "all" for comparison'),
    },
    async ({ plan }) => {
      let billingDoc: string;
      try {
        billingDoc = await fetchDoc('billing');
      } catch {
        return mcpError(BILLING_FETCH_ERROR, BILLING_FETCH_META);
      }

      // Required: plans table
      const plansTable = extractSections(billingDoc, ['standard plans', 'standard pricing'], { includeLooseMatches: false });
      if (!plansTable) {
        return mcpError(BILLING_FETCH_ERROR, BILLING_FETCH_META);
      }

      // Optional sections
      const credits = extractSections(billingDoc, ['credits system', 'credit costs'], { includeLooseMatches: false });
      const addOns = extractSections(billingDoc, ['data add-ons', 'add-ons'], { includeLooseMatches: false });
      const rateLimits = extractSections(billingDoc, ['rate limits', 'standard rate limits'], { includeLooseMatches: false });

      const sections: string[] = [];

      const currentPlanKey = await detectCurrentPlan();
      if (currentPlanKey) {
        const displayName = HELIUS_PLANS[currentPlanKey]?.name ?? currentPlanKey;
        sections.push(`**Your current plan: ${displayName}**`, '');
      }

      if (plan !== 'all') {
        const planInfo = HELIUS_PLANS[plan];
        const displayName = planInfo ? planInfo.name : plan;
        sections.push(`## ${displayName} Plan`, `See the "${plan}" column in the tables below.`, '');
      }

      sections.push(plansTable);
      if (credits) sections.push('', credits);
      if (addOns) sections.push('', addOns);
      if (rateLimits) sections.push('', rateLimits);

      sections.push(
        '',
        '---',
        '',
        '## Actions',
        '',
        '- To upgrade, use the `upgradePlan` tool with a plan name (developer, business, professional)',
        '- To preview pricing before upgrading, use the `previewUpgrade` tool',
        '',
        'Source: https://www.helius.dev/docs/billing (fetched live)',
      );

      return { content: [{ type: 'text' as const, text: sections.join('\n') }] };
    }
  );

  server.tool(
    'compareHeliusPlans',
    'BEST FOR: side-by-side plan comparison in a specific category. Compare Helius plans for rate limits, features, or pricing. Fetches live from billing docs.',
    {
      category: z.enum(['rates', 'features', 'pricing']).describe('Category to compare'),
    },
    async ({ category }) => {
      let billingDoc: string;
      try {
        billingDoc = await fetchDoc('billing');
      } catch {
        return mcpError(BILLING_FETCH_ERROR, BILLING_FETCH_META);
      }

      const sectionMap: Record<string, string[]> = {
        rates: ['rate limits', 'standard rate limits', 'special rate limits'],
        features: ['standard plans', 'standard pricing'],
        pricing: ['credits system', 'credit costs', 'data add-ons'],
      };

      const extracted = extractSections(billingDoc, sectionMap[category], { includeLooseMatches: false });
      if (!extracted) {
        return mcpError(BILLING_FETCH_ERROR, BILLING_FETCH_META);
      }

      const lines: string[] = [];

      const currentPlanKey = await detectCurrentPlan();
      if (currentPlanKey) {
        const displayName = HELIUS_PLANS[currentPlanKey]?.name ?? currentPlanKey;
        lines.push(`**Your current plan: ${displayName}**`, '');
      }

      lines.push(extracted);
      lines.push('', '---', 'Source: https://www.helius.dev/docs/billing (fetched live)');

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );

  // ── getAccountPlan — lightweight pre-flight check ──

  server.tool(
    'getAccountPlan',
    'Lightweight pre-flight check: returns current plan, credit balance, and which MCP tools require an upgrade. 0 credits. Call before gated tools (transactionSubscribe, laserstreamSubscribe, etc.).',
    {},
    async () => {
      // ── Tier 1: not authenticated at all ──
      if (!hasApiKey()) {
        return mcpText(
          `## Account Plan\n\n` +
          `**Auth:** Not authenticated\n\n` +
          `No API key or session found. To get started:\n` +
          `- If you have a key: use the \`setHeliusApiKey\` tool\n` +
          `- If you need an account: use \`generateKeypair\` → fund wallet → \`agenticSignup\``
        );
      }

      // ── Tier 2: API key present but no JWT ──
      const jwt = getJwt();
      if (!jwt) {
        return mcpText(
          `## Account Plan\n\n` +
          `**Auth:** API key configured, plan unknown\n\n` +
          `To see your plan and tool eligibility, call \`agenticSignup\`.\n` +
          `Your existing account will be detected automatically — no payment needed.`
        );
      }

      // ── Tier 3: full status via JWT ──
      try {
        const projects = await listProjects(jwt, MCP_USER_AGENT);
        if (projects.length === 0) {
          return mcpError('No projects found. Call `agenticSignup` to create an account first.');
        }

        const projectId = projects[0].id;
        const details = await getProject(jwt, projectId, MCP_USER_AGENT);

        const planKey = (details.subscriptionPlanDetails?.currentPlan?.trim().toLowerCase()) ?? 'unknown';
        const planInfo = HELIUS_PLANS[planKey];
        if (!planInfo) {
          console.warn(`[getAccountPlan] Unrecognized plan "${planKey}" — tool eligibility may be inaccurate`);
        }
        const planName = planInfo?.name ?? planKey;

        // Credit info
        const totalCredits = details.subscriptionPlanDetails?.totalCredits ?? 0;
        const usedCredits = details.subscriptionPlanDetails?.usedCredits ?? 0;
        const remainingCredits = totalCredits - usedCredits;
        const usedPct = totalCredits > 0 ? ((usedCredits / totalCredits) * 100).toFixed(1) : '0.0';

        // Tool eligibility
        const eligibility = computeToolEligibility(planKey);

        const lines: string[] = [
          `## Account Plan`,
          ``,
          `**Plan:** ${planName}`,
          ``,
          `### Credits`,
          `- **Remaining:** ${remainingCredits.toLocaleString()} / ${totalCredits.toLocaleString()} (${usedPct}% used)`,
          ``,
          `### Gated Tool Eligibility`,
          `All Free-tier tools are available on every plan.`,
          ``,
        ];

        if (eligibility.length > 0) {
          lines.push(
            `| Tool | Status | Requires |`,
            `|------|--------|----------|`,
          );
          for (const e of eligibility) {
            lines.push(`| ${e.tool} | ${e.status} | ${e.requires} |`);
          }
        } else {
          lines.push(`All tools are available on your plan.`);
        }

        // Next steps — find tools that need upgrade
        const upgradeNeeded = eligibility.filter(e => e.status.includes('UPGRADE REQUIRED'));
        if (upgradeNeeded.length > 0) {
          lines.push(``, `### Next Steps`);
          const toolNames = upgradeNeeded.map(e => e.tool);
          const uniqueRequires = [...new Set(upgradeNeeded.map(e => e.requires))];
          lines.push(`To unlock ${toolNames.join(', ')}, upgrade to ${uniqueRequires.join(' or ')}.`);
          lines.push(`→ Use \`previewUpgrade\` to see pricing`);
        }

        return mcpText(lines.join('\n'));
      } catch (err) {
        return mcpError(`Failed to fetch account plan: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );
}

// ─── Tool Eligibility Helper ───

interface ToolEligibilityEntry {
  tool: string;
  status: string;
  requires: string;
}

function computeToolEligibility(planKey: string): ToolEligibilityEntry[] {
  const userRank = PLAN_RANK[planKey] ?? 0;

  // Collect all non-free product entries per tool
  const toolProducts: Record<string, { productName: string; minimumPlan: string }[]> = {};

  for (const product of Object.values(PRODUCT_CATALOG)) {
    if (product.minimumPlan === 'free') continue;
    for (const tool of product.mcpTools) {
      if (!toolProducts[tool]) toolProducts[tool] = [];
      toolProducts[tool].push({ productName: product.name, minimumPlan: product.minimumPlan });
    }
  }

  const results: ToolEligibilityEntry[] = [];

  for (const [tool, products] of Object.entries(toolProducts)) {
    // Also check if this tool appears in any free product (e.g. transactionSubscribe in standard-websockets)
    const inFreeToo = Object.values(PRODUCT_CATALOG).some(
      p => p.minimumPlan === 'free' && p.mcpTools.includes(tool)
    );

    if (products.length === 1) {
      const p = products[0];
      const available = userRank >= (PLAN_RANK[p.minimumPlan] ?? 99);
      const planDisplay = HELIUS_PLANS[p.minimumPlan]?.name ?? p.minimumPlan;

      if (inFreeToo && available) {
        // Tool is available at free tier AND at this gated tier — show available
        results.push({ tool, status: 'AVAILABLE', requires: planDisplay });
      } else if (inFreeToo && !available) {
        // Tool works at free tier but the enhanced version needs upgrade
        results.push({ tool, status: `AVAILABLE (basic) / UPGRADE REQUIRED (${p.productName})`, requires: planDisplay });
      } else {
        results.push({ tool, status: available ? 'AVAILABLE' : 'UPGRADE REQUIRED', requires: planDisplay });
      }
    } else {
      // Multiple non-free products (e.g. laserstreamSubscribe in devnet + mainnet)
      const statuses: string[] = [];
      const requires: string[] = [];

      for (const p of products) {
        const available = userRank >= (PLAN_RANK[p.minimumPlan] ?? 99);
        const planDisplay = HELIUS_PLANS[p.minimumPlan]?.name ?? p.minimumPlan;
        const label = p.productName.includes('(') ? p.productName.replace(/.*\(/, '').replace(/\).*/, '').toLowerCase() : p.productName;
        statuses.push(available ? `AVAILABLE (${label})` : `UPGRADE REQUIRED (${label})`);
        requires.push(planDisplay);
      }

      const allAvailable = statuses.every(s => s.startsWith('AVAILABLE'));
      const allUnavailable = statuses.every(s => s.startsWith('UPGRADE'));

      if (allAvailable) {
        results.push({ tool, status: 'AVAILABLE', requires: requires.join(' / ') });
      } else if (allUnavailable) {
        results.push({ tool, status: 'UPGRADE REQUIRED', requires: requires[requires.length - 1] });
      } else {
        results.push({ tool, status: statuses.join(' / '), requires: requires.join(' / ') });
      }
    }
  }

  return results;
}
