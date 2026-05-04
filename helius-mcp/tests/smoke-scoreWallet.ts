#!/usr/bin/env npx tsx
/**
 * End-to-end smoke test for scoreWallet.
 *
 * Spawns the locally-built MCP server, performs the MCP handshake, sets the
 * Helius API key from env, calls scoreWallet on a real on-chain address, and
 * prints the response.
 *
 * Usage:
 *   HELIUS_API_KEY=... npx tsx helius-mcp/tests/smoke-scoreWallet.ts [address]
 *
 * Not run by the regular `pnpm test` suite — this is a one-shot validator
 * that requires an API key and burns ~310 credits per invocation.
 */

import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const apiKey = process.env.HELIUS_API_KEY;
if (!apiKey) {
  console.error('HELIUS_API_KEY not set. Aborting.');
  process.exit(1);
}

// Default test address: the $WIF top holder we hand-scored earlier.
const ADDRESS = process.argv[2] ?? 'BAd1gxwsNHdKgprCZ34Ruth1tzhCo3dfs46w8XW8BEoy';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(__dirname, '..', 'dist', 'index.js');

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_ENTRY],
    env: { ...process.env, HELIUS_API_KEY: apiKey } as Record<string, string>,
  });

  const client = new Client({ name: 'smoke-test', version: '0.0.0' });
  await client.connect(transport);

  // Verify scoreWallet is in the heliusWallet action enum
  const tools = await client.listTools();
  const heliusWallet = tools.tools.find(t => t.name === 'heliusWallet');
  if (!heliusWallet) throw new Error('heliusWallet tool missing');
  const actions = (heliusWallet.inputSchema as { properties?: { action?: { enum?: string[] } } })
    .properties?.action?.enum;
  if (!actions?.includes('scoreWallet')) {
    throw new Error(`scoreWallet not in action enum. Available: ${actions?.join(', ')}`);
  }
  console.log(`✓ scoreWallet registered in heliusWallet enum (${actions.length} actions total)`);

  // Call scoreWallet
  console.log(`\nCalling heliusWallet({ action: "scoreWallet", address: "${ADDRESS}" })...\n`);
  const t0 = Date.now();
  const result = await client.callTool({
    name: 'heliusWallet',
    arguments: {
      action: 'scoreWallet',
      address: ADDRESS,
      lookbackDays: 30,
      _feedback: 'smoke test',
      _feedbackTool: 'none',
      _model: 'smoke-test',
    },
  });
  const elapsed = Date.now() - t0;

  const text = (result.content as Array<{ type: string; text?: string }>)?.[0]?.text ?? '';
  console.log(text);
  console.log(`\n--- Wall time: ${elapsed}ms ---`);

  // Sanity assertions
  if (result.isError) {
    console.error(`\n✗ Tool returned isError=true`);
    process.exit(2);
  }
  const scoreMatch = text.match(/Wallet Score:\s*(\d+)\/100/);
  if (!scoreMatch) {
    console.error(`\n✗ No "Wallet Score: N/100" in response`);
    process.exit(3);
  }
  const score = parseInt(scoreMatch[1], 10);
  if (score < 0 || score > 100) {
    console.error(`\n✗ Score out of range: ${score}`);
    process.exit(4);
  }

  // Component lines
  for (const component of ['Activity', 'Diversification', 'Recency', 'Hold age']) {
    if (!text.includes(component + ':')) {
      console.error(`\n✗ Missing ${component} component in output`);
      process.exit(5);
    }
  }

  console.log(`\n✓ All smoke checks passed. Score: ${score}/100`);
  await client.close();
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(99);
});
