import { describe, expect, it } from 'vitest';
import type { ActionName } from '../src/router/actions.js';
import { ACTION_CATALOG } from '../src/router/catalog.js';
import { PRODUCT_CATALOG } from '../src/tools/product-catalog.js';

/**
 * Actions whose catalog gate is deliberately looser than the product that
 * lists them, with the reason.
 */
const EXEMPT: Partial<Record<ActionName, string>> = {
  getPreConfCoverage: 'The docs give the coverage method no plan requirement; only preconfSubscribe needs a paid plan.',
};

/** Paid actions no product lists, with the reason. */
const UNLISTED: Partial<Record<ActionName, string>> = {
  ask: 'Lana is an assistant inside the MCP, not a product getAccountPlan reports.',
};

/** Products that exist on one network only, keyed by the suffix of their id. */
const PRODUCT_NETWORKS: Record<string, string> = { '-mainnet': 'mainnet-beta', '-devnet': 'devnet' };

/** The plan an action's gate requires on a network. */
function gatePlanOn(action: ActionName, network: string): string {
  const gate = ACTION_CATALOG[action].capabilityGate;
  const variant = (gate.variants ?? []).find(
    (candidate) => candidate.predicate.kind === 'network' && (candidate.predicate.oneOf as readonly string[]).includes(network),
  );
  return (variant ?? gate.baseline).minimumPlan;
}

describe('plan requirements', () => {
  it('agree between the action catalog and the product catalog', () => {
    // getAccountPlan and recommendStack read plans from the product catalog;
    // the action catalog states them too, so the two must not drift apart.
    const productPlans = new Map<string, Set<string>>();
    for (const product of Object.values(PRODUCT_CATALOG)) {
      for (const action of product.mcpTools) {
        const plans = productPlans.get(action) ?? new Set<string>();
        plans.add(product.minimumPlan);
        productPlans.set(action, plans);
      }
    }

    for (const [action, plans] of productPlans) {
      if (EXEMPT[action as ActionName]) continue;
      const gate = ACTION_CATALOG[action as ActionName].capabilityGate;
      const gatePlans = new Set([gate.baseline.minimumPlan, ...(gate.variants ?? []).map((variant) => variant.minimumPlan)]);
      for (const plan of plans) {
        expect(gatePlans, `${action}: a product requires ${plan}, the catalog gate does not mention it`).toContain(plan);
      }
      for (const plan of gatePlans) {
        if (plan === 'agent') continue;
        expect(plans, `${action}: the catalog gate requires ${plan}, no product does`).toContain(plan);
      }
    }
  });

  it('agree on each network for single-network products', () => {
    // Without this, swapping the mainnet and devnet LaserStream plans passes
    // the check above: both plans are still mentioned.
    for (const [id, product] of Object.entries(PRODUCT_CATALOG)) {
      const suffix = Object.keys(PRODUCT_NETWORKS).find((candidate) => id.endsWith(candidate));
      if (!suffix) continue;
      for (const action of product.mcpTools as ActionName[]) {
        expect(gatePlanOn(action, PRODUCT_NETWORKS[suffix]), `${action} on ${PRODUCT_NETWORKS[suffix]} (${id})`).toBe(product.minimumPlan);
      }
    }
  });

  it('lists every paid action under a product', () => {
    // getAccountPlan reports plan access from the product catalog, so a paid
    // action no product lists is missing from it.
    const listed = new Set(Object.values(PRODUCT_CATALOG).flatMap((product) => product.mcpTools));
    for (const [action, entry] of Object.entries(ACTION_CATALOG) as Array<[ActionName, (typeof ACTION_CATALOG)[ActionName]]>) {
      const gate = entry.capabilityGate;
      const paid = [gate.baseline, ...(gate.variants ?? [])].some((rule) => rule.minimumPlan !== 'agent');
      if (paid && !UNLISTED[action]) {
        expect(listed.has(action), `${action} needs a paid plan but no product lists it`).toBe(true);
      }
    }
  });
});
