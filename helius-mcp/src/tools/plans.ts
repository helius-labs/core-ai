import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchDoc, extractSections } from '../utils/docs.js';
import { mcpError } from '../utils/errors.js';
import { getJwt } from '../utils/config.js';
import { listProjects } from 'helius-sdk/auth/listProjects';
import { getProject } from 'helius-sdk/auth/getProject';
import { MCP_USER_AGENT } from '../http.js';

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
        return mcpError(BILLING_FETCH_ERROR);
      }

      // Required: plans table
      const plansTable = extractSections(billingDoc, ['standard plans', 'standard pricing'], { includeLooseMatches: false });
      if (!plansTable) {
        return mcpError(BILLING_FETCH_ERROR);
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
        return mcpError(BILLING_FETCH_ERROR);
      }

      const sectionMap: Record<string, string[]> = {
        rates: ['rate limits', 'standard rate limits', 'special rate limits'],
        features: ['standard plans', 'standard pricing'],
        pricing: ['credits system', 'credit costs', 'data add-ons'],
      };

      const extracted = extractSections(billingDoc, sectionMap[category], { includeLooseMatches: false });
      if (!extracted) {
        return mcpError(BILLING_FETCH_ERROR);
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
}
