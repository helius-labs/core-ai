import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchDoc, extractSections } from '../utils/docs.js';
import { mcpError } from '../utils/errors.js';

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

export function registerPlanTools(server: McpServer) {
  server.tool(
    'getHeliusPlanInfo',
    'BEST FOR: pricing questions — "how much does Helius cost?", "what plan should I get?". Start here for any plan/pricing question. PREFER compareHeliusPlans for side-by-side category comparisons. PREFER getRateLimitInfo for credit costs per API method. Get detailed Helius plan information including pricing, credits, rate limits, and feature availability. Shows what features are available on each tier (Free, Developer, Business, Professional). Useful for understanding WebSocket limits, Laserstream access, and API rate limits per plan. Fetches live from official billing documentation.',
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
    'BEST FOR: side-by-side plan comparison in a specific category. Fetches live from official billing documentation. Compare Helius plans for a specific feature category (rate limits, features, connections, pricing, or support).',
    {
      category: z.enum(['rates', 'features', 'connections', 'pricing', 'support']).describe('Category to compare'),
      plans: z.array(z.enum(['free', 'developer', 'business', 'professional'])).optional().describe('Plans to highlight in the comparison (default: all). Full live tables are returned; this parameter indicates which plans to focus on.'),
    },
    async ({ category, plans }) => {
      let billingDoc: string;
      try {
        billingDoc = await fetchDoc('billing');
      } catch {
        return mcpError(BILLING_FETCH_ERROR);
      }

      const sectionMap: Record<string, string[]> = {
        rates: ['rate limits', 'standard rate limits'],
        features: ['standard plans', 'standard pricing'],
        connections: ['websockets', 'websocket connections'],
        pricing: ['standard plans', 'standard pricing'],
        support: ['standard plans', 'standard pricing'],
      };

      const extracted = extractSections(billingDoc, sectionMap[category], { includeLooseMatches: false });
      if (!extracted) {
        return mcpError(BILLING_FETCH_ERROR);
      }

      const lines: string[] = [];

      const plansToCompare = plans || ['free', 'developer', 'business', 'professional'];
      if (plans && plans.length < 4) {
        lines.push(`_Comparing: ${plansToCompare.join(', ')}_`, '');
      }

      lines.push(extracted);
      lines.push('', '---', 'Source: https://www.helius.dev/docs/billing (fetched live)');

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );
}
