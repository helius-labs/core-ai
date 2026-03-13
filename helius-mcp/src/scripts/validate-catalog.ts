#!/usr/bin/env node

/**
 * Validates the product catalog for correctness.
 *
 * Checks:
 * 1. Every mcpTools entry exists in KNOWN_TOOLS
 * 2. Every referenceFile exists on disk
 * 3. Every docKey exists in DOCS_INDEX
 * 4. Every minimumPlan is a valid key in PLAN_RANK and HELIUS_PLANS
 * 5. Plan-feature compatibility (Laserstream mainnet → professional, Enhanced WebSockets → business+)
 * 6. No empty mcpTools arrays
 */

import fs from 'fs';
import path from 'path';
import { PRODUCT_CATALOG, PLAN_RANK } from '../tools/product-catalog.js';
import { KNOWN_TOOLS } from '../tools/recommend.js';
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
  // 1. MCP tool names exist in KNOWN_TOOLS
  for (const tool of product.mcpTools) {
    if (!KNOWN_TOOLS.has(tool)) {
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
  if (nameLower.includes('laserstream') && nameLower.includes('mainnet') && product.minimumPlan !== 'professional') {
    error(key, `Laserstream mainnet requires professional plan, but has "${product.minimumPlan}"`);
  }
  if (nameLower.includes('enhanced websocket') && (PLAN_RANK[product.minimumPlan] ?? 0) < PLAN_RANK['business']) {
    error(key, `Enhanced WebSockets requires business+ plan, but has "${product.minimumPlan}"`);
  }

  // 6. No empty mcpTools
  if (product.mcpTools.length === 0) {
    error(key, 'mcpTools array is empty');
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
  console.log(`\u2705 All products valid (${productCount} products in catalog)`);
}
