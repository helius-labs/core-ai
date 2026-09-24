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
 * 9. Every action needing a signer is labelled a write
 * 10. Every manually excluded action is absent from the hosted surface
 * 11. No heliusWrite action reaches the hosted surface
 */

import fs from 'fs';
import path from 'path';
import { PRODUCT_CATALOG, PLAN_RANK } from '../tools/product-catalog.js';
import { ACTION_NAME_SET } from '../router/actions.js';
import { ACTION_CATALOG, getHostedActions, hostedExclusionReason } from '../router/catalog.js';
import { ACTION_NAMES } from '../router/actions.js';
import { needsHostSecret } from '../router/types.js';
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
for (const entry of Object.values(ACTION_CATALOG)) {
  if (entry.responseFamily === 'mutationReceipt' && entry.mutability !== 'write') {
    error(entry.action, 'returns a mutation receipt but is labelled a read');
  }

  if (entry.publicTool === 'heliusWrite' && entry.mutability !== 'write') {
    error(entry.action, 'is a heliusWrite action but is labelled a read');
  }

  // Acting as the wallet is a mutation wherever it appears. This is the check
  // that caught `signup`, whose receipt shape and public tool both look read-ish.
  if (needsHostSecret(entry.authRequirement) && entry.authRequirement !== 'jwt'
      && entry.mutability !== 'write') {
    error(entry.action, `requires "${entry.authRequirement}" but is labelled a read`);
  }
}

// Hosted-surface checks that do not restate the predicate. Asserting that no
// signer/jwt action is hosted would only confirm `hostedEligible` agrees with
// itself; these two can fail for a catalog edit that leaves the predicate alone.
const hosted = new Set<string>(getHostedActions());

for (const action of ACTION_NAMES) {
  const reason = hostedExclusionReason(action);
  if (reason && hosted.has(action)) {
    error(action, `is manually excluded (${reason}) but reaches the hosted surface`);
  }
}

for (const entry of Object.values(ACTION_CATALOG)) {
  if (entry.publicTool === 'heliusWrite' && hosted.has(entry.action)) {
    error(entry.action, 'is a heliusWrite action but reaches the hosted surface');
  }
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
  console.log(
    `\u2705 Valid: ${productCount} products, ${ACTION_NAMES.length} actions `
    + `(${hosted.size} hosted-eligible)`,
  );
}
