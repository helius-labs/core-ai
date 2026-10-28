import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/utils/config.js', () => ({
  getPreferences: vi.fn(() => ({})),
  savePreferences: vi.fn(),
}));

vi.mock('../src/tools/plans.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/tools/plans.js')>();
  return { ...original, detectCurrentPlan: vi.fn(async () => undefined) };
});

vi.mock('../src/utils/helius.js', () => ({ hasApiKey: vi.fn(() => true) }));

import { registerRecommendTools } from '../src/tools/recommend.js';
import { PRODUCT_CATALOG, PLAN_RANK } from '../src/tools/product-catalog.js';

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<{ content: Array<{ text: string }> }>;

let recommend: Handler;

beforeEach(() => {
  registerRecommendTools({
    registerAction: (_name: string, _desc: string, _schema: unknown, handler: Handler) => { recommend = handler; },
  } as never);
});

async function catalogText(args: Record<string, unknown> = {}): Promise<string> {
  const result = await recommend({ description: 'a Solana app', scale: 'all', ...args }, {});
  return result.content[0].text;
}

/** Product names listed under each `## <tier> Tier` heading. */
function productsByTier(text: string): Record<string, string[]> {
  const tiers: Record<string, string[]> = {};
  let current = '';
  for (const line of text.split('\n')) {
    const heading = line.match(/^## (.+?) Tier/);
    if (heading) { current = heading[1]; tiers[current] = []; continue; }
    const product = line.match(/^- \*\*(.+?)\*\*/);
    if (product && current) tiers[current].push(product[1]);
  }
  return tiers;
}

describe('recommendStack tiers', () => {
  it('lists Agent-plan products in the Agent tier, not the top tier', async () => {
    const tiers = productsByTier(await catalogText());
    const agentProducts = Object.values(PRODUCT_CATALOG).filter((p) => p.minimumPlan === 'agent').map((p) => p.name);

    expect(tiers.Agent).toEqual(expect.arrayContaining(agentProducts));
    expect(tiers['Business / Professional']).not.toContain('DAS API');
  });

  it('still returns products for an Agent budget', async () => {
    const text = await catalogText({ budget: 'agent' });
    expect(text).not.toContain('No tiers match');
    expect(text).toContain('**DAS API**');
  });

  it('returns the Agent tier for low complexity', async () => {
    const text = await catalogText({ complexity: 'low' });
    expect(text).not.toContain('No tiers match');
    expect(Object.keys(productsByTier(text))).toEqual(['Agent']);
  });

  it('places every minimumPlan in a tier that matches its rank', async () => {
    const tiers = productsByTier(await catalogText());
    const tierOf = (name: string) => Object.entries(tiers).find(([, names]) => names.includes(name))?.[0];
    const expected: Record<string, string> = { agent: 'Agent', developer: 'Developer', business: 'Business / Professional', professional: 'Business / Professional' };

    for (const plan of Object.keys(PLAN_RANK)) {
      for (const product of Object.values(PRODUCT_CATALOG).filter((p) => p.minimumPlan === plan)) {
        expect(tierOf(product.name), product.name).toBe(expected[plan]);
      }
    }
  });
});

describe('recommendStack product lines', () => {
  it('shows how to integrate products the MCP cannot call yet', async () => {
    const text = await catalogText();
    const block = text.slice(text.indexOf('**Parsed Streams**'));
    const entry = block.slice(0, block.indexOf('\n- **'));

    expect(entry).toContain('Tools: none in this MCP yet');
    expect(entry).toContain('Use from your app:');
    expect(entry).toContain('parsedTransactionSubscribe');
    expect(entry).toContain('`lookupHeliusDocs` topic `parsed-streams`');
  });

  it('labels legacy and beta products', async () => {
    const text = await catalogText();
    expect(text).toContain('**Enhanced Transactions API** (Legacy)');
    expect(text).toContain('**Gatekeeper** (Beta)');
  });
});

describe('PRODUCT_CATALOG', () => {
  it('gives every product without an MCP action an integration path', () => {
    for (const [key, product] of Object.entries(PRODUCT_CATALOG)) {
      if (product.mcpTools.length === 0) {
        expect(product.integration?.trim(), key).toBeTruthy();
      }
    }
  });
});
