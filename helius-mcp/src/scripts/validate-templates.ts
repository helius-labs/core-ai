#!/usr/bin/env node

/**
 * Validates recommendStack template data for correctness.
 *
 * Checks:
 * 1. MCP tool names exist in KNOWN_TOOLS
 * 2. Reference paths exist on disk
 * 3. Plan-feature compatibility (e.g., Laserstream mainnet requires professional)
 * 4. Tier ordering (budget <= standard <= production plan rank)
 * 5. No empty arrays (products, limitations, references)
 */

import fs from 'fs';
import path from 'path';
import { PROJECT_TEMPLATES, KNOWN_TOOLS } from '../tools/recommend.js';
import { HELIUS_PLANS } from '../tools/plans.js';

const PLAN_RANK: Record<string, number> = { free: 0, developer: 1, business: 2, professional: 3 };
const TIER_RANK: Record<string, number> = { budget: 0, standard: 1, production: 2 };

// Resolve skill references relative to repo root
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const SKILL_DIR = path.join(REPO_ROOT, 'helius-skills', 'helius');

let errors: string[] = [];

function error(templateName: string, msg: string) {
  errors.push(`[${templateName}] ${msg}`);
}

for (const [key, template] of Object.entries(PROJECT_TEMPLATES)) {
  // ── Check tier ordering ──
  const sorted = [...template.tiers].sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if ((PLAN_RANK[curr.minimumPlan] ?? 0) < (PLAN_RANK[prev.minimumPlan] ?? 0)) {
      error(key, `Tier ordering violation: ${curr.tier} (${curr.minimumPlan}) has lower plan rank than ${prev.tier} (${prev.minimumPlan})`);
    }
  }

  for (const tier of template.tiers) {
    const tierLabel = `${key}/${tier.tier}`;

    // ── No empty arrays ──
    if (tier.products.length === 0) {
      error(tierLabel, 'products array is empty');
    }
    if (tier.limitations.length === 0) {
      error(tierLabel, 'limitations array is empty');
    }
    if (tier.references.length === 0) {
      error(tierLabel, 'references array is empty');
    }

    // ── Validate each product ──
    for (const product of tier.products) {
      // MCP tool name validation
      for (const tool of product.mcpTools) {
        if (!KNOWN_TOOLS.has(tool)) {
          error(tierLabel, `Unknown MCP tool "${tool}" in product "${product.product}"`);
        }
      }

      // Plan-feature compatibility
      if (!(product.minimumPlan in PLAN_RANK)) {
        error(tierLabel, `Unknown plan "${product.minimumPlan}" in product "${product.product}"`);
      }
      if (!(product.minimumPlan in HELIUS_PLANS)) {
        error(tierLabel, `Plan "${product.minimumPlan}" not found in HELIUS_PLANS for product "${product.product}"`);
      }

      // Laserstream mainnet must require professional
      const nameLower = product.product.toLowerCase();
      if (nameLower.includes('laserstream') && nameLower.includes('mainnet') && product.minimumPlan !== 'professional') {
        error(tierLabel, `Laserstream mainnet in product "${product.product}" requires professional plan, but has "${product.minimumPlan}"`);
      }

      // Enhanced WebSockets must require business+
      if (nameLower.includes('enhanced websocket') && (PLAN_RANK[product.minimumPlan] ?? 0) < PLAN_RANK['business']) {
        error(tierLabel, `Enhanced WebSockets in product "${product.product}" requires business+ plan, but has "${product.minimumPlan}"`);
      }
    }

    // ── Reference path validation ──
    for (const ref of tier.references) {
      const refPath = path.join(SKILL_DIR, ref);
      if (!fs.existsSync(refPath)) {
        error(tierLabel, `Reference file not found: ${ref} (looked at ${refPath})`);
      }
    }
  }
}

// ── Report ──

if (errors.length > 0) {
  console.error(`\n❌ Template validation failed with ${errors.length} error(s):\n`);
  for (const err of errors) {
    console.error(`  • ${err}`);
  }
  console.error('');
  process.exit(1);
} else {
  const templateCount = Object.keys(PROJECT_TEMPLATES).length;
  const tierCount = Object.values(PROJECT_TEMPLATES).reduce((sum, t) => sum + t.tiers.length, 0);
  console.log(`✅ All templates valid (${templateCount} templates, ${tierCount} tiers)`);
}
