import { PLAN_CATALOG } from 'helius-sdk/auth/planCatalog';

/** Compute exact USDC amount (in token units) from plan context, or undefined if no plan. */
export function computeExactUsdc(plan?: string, period?: string): { usdcAmount: number; label: string } | undefined {
  if (!plan) return undefined;
  const key = plan.toLowerCase();
  if (key === 'basic') return { usdcAmount: 1, label: 'basic plan ($1)' };
  const entry = PLAN_CATALOG[key];
  if (!entry) return undefined;
  const priceInCents = period?.toLowerCase() === 'yearly' ? entry.yearlyPrice : entry.monthlyPrice;
  return { usdcAmount: priceInCents / 100, label: `${entry.name} plan ($${priceInCents / 100})` };
}
