import { PLAN_CATALOG } from 'helius-sdk/auth/planCatalog';

/**
 * Agent-plan pricing is hardcoded here instead of pulled from PLAN_CATALOG
 * because the SDK intentionally keeps agent out of PLAN_CATALOG (its
 * monthlyPrice/yearlyPrice invariants don't apply to a one-time purchase).
 * The backend's `getSignupQuote` is the authoritative source; this local
 * hint only exists to pre-fill the QR amount before auth succeeds.
 */
const AGENT_PLAN_USDC = 10; // 10 USDC one-time, 1,000,000 starting credits.

/** Compute exact USDC amount (in token units) from plan context, or undefined if no plan. */
export function computeExactUsdc(plan?: string, period?: string): { usdcAmount: number; label: string } | undefined {
  if (!plan) return undefined;
  const key = plan.toLowerCase();
  if (key === 'agent') {
    return { usdcAmount: AGENT_PLAN_USDC, label: `agent plan ($${AGENT_PLAN_USDC})` };
  }
  const entry = PLAN_CATALOG[key];
  if (!entry) return undefined;
  const priceInCents = period?.toLowerCase() === 'yearly' ? entry.yearlyPrice : entry.monthlyPrice;
  return { usdcAmount: priceInCents / 100, label: `${entry.name} plan ($${priceInCents / 100})` };
}
