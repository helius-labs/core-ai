#!/usr/bin/env node

/**
 * Validates the product catalog for correctness.
 *
 * Checks:
 * 1. Every mcpTools entry exists in the action registry
 * 2. Every referenceFile exists on disk
 * 3. Every docKey exists in DOCS_INDEX
 * 4. Every minimumPlan is a valid key in PLAN_RANK and HELIUS_PLANS
 * 5. Plan-feature compatibility (Laserstream mainnet → business+, Enhanced WebSockets → developer+)
 * 6. No empty mcpTools arrays
 * 7. Every action that returns a mutation receipt is labelled a write
 * 8. Every heliusWrite action is labelled a write
 * 9. No action needing a signer or a JWT is hosted-eligible
 */

import fs from 'fs';
import path from 'path';
import { PRODUCT_CATALOG, PLAN_RANK } from '../tools/product-catalog.js';
import { ACTION_NAME_SET } from '../router/actions.js';
import { ACTION_CATALOG, hostedEligible, getHostedActions } from '../router/catalog.js';
import { HELIUS_PLANS } from '../tools/plans.js';
import { DOCS_INDEX } from '../utils/docs.js';

// Resolve skill references relative to repo root
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const SKILL_DIR = path.join(REPO_ROOT, 'helius-skills', 'helius');

let errors: string[] = [];

function error(productKey: string, msg: string) {
  errors.push(`[${productKey}] ${msg}`);
}

for (const [key, product] of Object.entries(PRODUCT_CATALOG)) {
  // 1. MCP tool names exist in the canonical action registry
  for (const tool of product.mcpTools) {
    if (!ACTION_NAME_SET.has(tool)) {
      error(key, `Unknown MCP tool "${tool}"`);
    }
  }

  // 2. referenceFile exists on disk
  if (product.referenceFile) {
    const refPath = path.join(SKILL_DIR, product.referenceFile);
    if (!fs.existsSync(refPath)) {
      error(key, `Reference file not found: ${product.referenceFile} (looked at ${refPath})`);
    }
  }

  // 3. docKey exists in DOCS_INDEX
  if (!(product.docKey in DOCS_INDEX)) {
    error(key, `Unknown docKey "${product.docKey}" — available: ${Object.keys(DOCS_INDEX).join(', ')}`);
  }

  // 4. minimumPlan is valid
  if (!(product.minimumPlan in PLAN_RANK)) {
    error(key, `Unknown plan "${product.minimumPlan}" in PLAN_RANK`);
  }
  if (!(product.minimumPlan in HELIUS_PLANS)) {
    error(key, `Plan "${product.minimumPlan}" not found in HELIUS_PLANS`);
  }

  // 5. Plan-feature compatibility
  const nameLower = product.name.toLowerCase();
  if (nameLower.includes('laserstream') && nameLower.includes('mainnet') && (PLAN_RANK[product.minimumPlan] ?? 0) < PLAN_RANK['business']) {
    error(key, `Laserstream mainnet requires business+ plan, but has "${product.minimumPlan}"`);
  }
  if (nameLower.includes('enhanced websocket') && (PLAN_RANK[product.minimumPlan] ?? 0) < PLAN_RANK['developer']) {
    error(key, `Enhanced WebSockets requires developer+ plan, but has "${product.minimumPlan}"`);
  }

  // 6. No empty mcpTools
  if (product.mcpTools.length === 0) {
    error(key, 'mcpTools array is empty');
  }
}

// ── Action catalog: mutability and hosted eligibility ──

/**
 * `mutability` defaults to 'read'. These checks exist because a mislabelled
 * write is silent: it looks correct until something filters replay-safety or
 * hosted eligibility on it, and then the actions that most needed protecting
 * are the ones that slipped through.
 */
const HOSTED_ACTION_COUNT = 82;

for (const entry of Object.values(ACTION_CATALOG)) {
  if (entry.responseFamily === 'mutationReceipt' && entry.mutability !== 'write') {
    error(entry.action, 'returns a mutation receipt but is labelled a read');
  }

  if (entry.publicTool === 'heliusWrite' && entry.mutability !== 'write') {
    error(entry.action, 'is a heliusWrite action but is labelled a read');
  }

  // A hosted deployment holds no wallet and no dashboard JWT.
  if (hostedEligible(entry) && entry.authRequirement !== 'apiKey' && entry.authRequirement !== 'none') {
    error(entry.action, `is hosted-eligible but requires "${entry.authRequirement}"`);
  }
}

const hostedActions = getHostedActions();
if (hostedActions.length !== HOSTED_ACTION_COUNT) {
  error(
    'hosted-surface',
    `expected ${HOSTED_ACTION_COUNT} hosted-eligible actions, found ${hostedActions.length}. `
    + 'If this is intentional, update HOSTED_ACTION_COUNT and say why in the PR.',
  );
}

// ── Report ──

if (errors.length > 0) {
  console.error(`\n\u274C Catalog validation failed with ${errors.length} error(s):\n`);
  for (const err of errors) {
    console.error(`  \u2022 ${err}`);
  }
  console.error('');
  process.exit(1);
} else {
  const productCount = Object.keys(PRODUCT_CATALOG).length;
  console.log(`\u2705 All products valid (${productCount} products in catalog)`);
}
