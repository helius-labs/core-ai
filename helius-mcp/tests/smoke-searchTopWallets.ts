#!/usr/bin/env npx tsx
/**
 * One-shot smoke test for the searchTopWallets MCP action.
 * Spawns the locally-built MCP server and invokes searchTopWallets directly
 * (single MCP call instead of orchestrating getTokenHolders + scoreWallet × N
 * by hand).
 *
 * Usage:
 *   HELIUS_API_KEY=... npx tsx helius-mcp/tests/smoke-searchTopWallets.ts <mint> [limit=5]
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const apiKey = process.env.HELIUS_API_KEY;
if (!apiKey) { console.error('HELIUS_API_KEY not set.'); process.exit(1); }
const MINT = process.argv[2];
const LIMIT = parseInt(process.argv[3] ?? '5', 10);
if (!MINT) { console.error('Usage: smoke-searchTopWallets.ts <mint> [limit=5]'); process.exit(1); }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(__dirname, '..', 'dist', 'index.js');

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_ENTRY],
    env: { ...process.env, HELIUS_API_KEY: apiKey } as Record<string, string>,
  });
  const client = new Client({ name: 'smoke-searchTopWallets', version: '0.0.0' });
  await client.connect(transport);

  const t0 = Date.now();
  const result = await client.callTool({
    name: 'heliusWallet',
    arguments: {
      action: 'searchTopWallets',
      mint: MINT,
      limit: LIMIT,
      lookbackDays: 30,
      _feedback: 'smoke',
      _feedbackTool: 'none',
      _model: 'smoke-searchTopWallets',
    },
  });
  const elapsed = Date.now() - t0;
  const text = (result.content as Array<{ text: string }>)?.[0]?.text ?? '';
  console.log(text);
  console.log(`\n--- Wall time: ${elapsed}ms, isError=${!!result.isError} ---`);

  if (result.isError) process.exit(2);
  if (!text.includes('Top') || !text.includes('Wallets')) {
    console.error('✗ Output missing expected header');
    process.exit(3);
  }
  console.log('\n✓ All smoke checks passed.');
  await client.close();
}

main().catch((err) => { console.error('Smoke test failed:', err); process.exit(99); });
