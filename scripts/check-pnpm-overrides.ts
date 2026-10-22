#!/usr/bin/env npx tsx
/**
 * Checks that each package declares the same pnpm overrides in package.json
 * and pnpm-workspace.yaml.
 *
 * The list lives in both places on purpose. pnpm 9, which CI uses, reads
 * overrides only from the "pnpm.overrides" field in package.json. pnpm 12,
 * which Dependabot runs, reads them only from pnpm-workspace.yaml, and without
 * them there it regenerates the lockfile with no overrides, so CI's frozen
 * install fails on every Dependabot PR. If the two lists drift, one of those
 * tools silently installs different versions than the other.
 *
 * Usage: npx tsx scripts/check-pnpm-overrides.ts
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = ["helius-mcp", "helius-cli"];

/** Reads the `overrides:` block from pnpm-workspace.yaml (one `'key': 'value'` per line). */
function workspaceOverrides(yaml: string): Record<string, string> {
  const overrides: Record<string, string> = {};
  let inBlock = false;
  for (const line of yaml.split("\n")) {
    if (/^overrides:\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) break; // next top-level key ends the block

    const entry = line.match(/^\s+(['"]?)(.+?)\1:\s*(['"]?)(.+?)\3\s*$/);
    if (!entry) throw new Error(`Unrecognized overrides line: ${line.trim()}`);
    overrides[entry[2]] = entry[4];
  }
  return overrides;
}

function describe(overrides: Record<string, string>): string[] {
  return Object.entries(overrides).map(([key, value]) => `${key} -> ${value}`).sort();
}

let failed = false;
for (const pkg of PACKAGES) {
  const manifest = JSON.parse(readFileSync(join(ROOT, pkg, "package.json"), "utf-8"));
  const fromPackageJson: Record<string, string> = manifest.pnpm?.overrides ?? {};
  const fromWorkspace = workspaceOverrides(readFileSync(join(ROOT, pkg, "pnpm-workspace.yaml"), "utf-8"));

  const a = describe(fromPackageJson);
  const b = describe(fromWorkspace);
  const onlyInPackageJson = a.filter((x) => !b.includes(x));
  const onlyInWorkspace = b.filter((x) => !a.includes(x));

  if (onlyInPackageJson.length === 0 && onlyInWorkspace.length === 0) {
    console.log(`  ✓ ${pkg}: ${a.length} override(s) match`);
    continue;
  }

  failed = true;
  console.error(`  ✗ ${pkg}: package.json and pnpm-workspace.yaml overrides differ`);
  for (const x of onlyInPackageJson) console.error(`      only in package.json:        ${x}`);
  for (const x of onlyInWorkspace) console.error(`      only in pnpm-workspace.yaml: ${x}`);
}

if (failed) {
  console.error("\nKeep the overrides identical in both files. See the comment in pnpm-workspace.yaml.");
  process.exit(1);
}
