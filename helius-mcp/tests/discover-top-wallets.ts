#!/usr/bin/env npx tsx
/**
 * End-to-end token-anchored discovery validation.
 *
 * Runs the full helius-smartmoney pipeline against a real token mint:
 *   1. getTokenHolders(mint)             — candidate pool
 *   2. batchWalletIdentity(addresses)    — filter CEX/program addresses
 *   3. scoreWallet(addr) for each        — quality score
 *   4. Rank by score, present top N
 *
 * Spawns the locally-built MCP server so this exercises the new
 * scoreWallet action end-to-end through the MCP protocol.
 *
 * Usage:
 *   HELIUS_API_KEY=... npx tsx helius-mcp/tests/discover-top-wallets.ts <mint> [topN=5]
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const apiKey = process.env.HELIUS_API_KEY;
if (!apiKey) {
  console.error('HELIUS_API_KEY not set. Aborting.');
  process.exit(1);
}

const MINT = process.argv[2];
const TOP_N = parseInt(process.argv[3] ?? '5', 10);
if (!MINT) {
  console.error('Usage: discover-top-wallets.ts <mint> [topN=5]');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(__dirname, '..', 'dist', 'index.js');

const TELEMETRY = {
  _feedback: 'discover-top-wallets smoke',
  _feedbackTool: 'none',
  _model: 'discover-top-wallets',
};

interface ScoreLine {
  address: string;
  score: number;
  components: {
    activity: number;
    diversification: number;
    recency: number;
    holdAge: number;
  };
  flags: string[];
  raw: string;
}

function parseScoreOutput(text: string, address: string): ScoreLine {
  const score = parseInt(text.match(/Wallet Score:\s*(\d+)\/100/)?.[1] ?? '0', 10);
  const activity = parseInt(text.match(/Activity:\s*(\d+)\/100/)?.[1] ?? '0', 10);
  const diversification = parseInt(text.match(/Diversification:\s*(\d+)\/100/)?.[1] ?? '0', 10);
  const recency = parseInt(text.match(/Recency:\s*(\d+)\/100/)?.[1] ?? '0', 10);
  const holdAge = parseInt(text.match(/Hold age:\s*(\d+)\/100/)?.[1] ?? '0', 10);
  const flagsLine = text.match(/Flags:\s*([A-Z_,\s]+)/)?.[1] ?? '';
  const flags = flagsLine.split(',').map(s => s.trim()).filter(Boolean);
  return { address, score, components: { activity, diversification, recency, holdAge }, flags, raw: text };
}

function fmt(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_ENTRY],
    env: { ...process.env, HELIUS_API_KEY: apiKey } as Record<string, string>,
  });
  const client = new Client({ name: 'discover-top-wallets', version: '0.0.0' });
  await client.connect(transport);

  const t0 = Date.now();

  // 1. Get top holders
  console.log(`\n[1/4] Fetching top holders of ${MINT}...`);
  const holdersRes = await client.callTool({
    name: 'heliusAsset',
    arguments: { action: 'getTokenHolders', mint: MINT, ...TELEMETRY },
  });
  const holdersText = (holdersRes.content as Array<{ text: string }>)[0].text;
  const addresses = Array.from(holdersText.matchAll(/^\s*\d+\.\s+\*\*([A-Za-z0-9]{32,44})\*\*/gm)).map(m => m[1]);
  console.log(`      Got ${addresses.length} holders`);

  // 2. Batch identity
  console.log(`[2/4] Batch-identifying...`);
  const idRes = await client.callTool({
    name: 'heliusWallet',
    arguments: { action: 'batchWalletIdentity', addresses, ...TELEMETRY },
  });
  const idText = (idRes.content as Array<{ text: string }>)[0].text;
  // Drop any address whose identity line is NOT "Unknown" — those are CEX/program/etc.
  const labeledOut = new Set<string>();
  const idMatches = Array.from(idText.matchAll(/^-\s+\*\*([^*]+)\*\*\s+—\s+([A-Za-z0-9.…]+)/gm));
  for (const m of idMatches) {
    const labelLine = m[0];
    const fmtAddr = m[2];
    // The full address can be reconstructed only if not truncated; in practice
    // we'll filter by checking labeled wallets in the batch output.
    // Simpler: re-iterate addresses + idMatches together by index — labels appear in same order.
    const addrIdx = idMatches.indexOf(m);
    if (addrIdx >= 0 && addrIdx < addresses.length) {
      labeledOut.add(addresses[addrIdx]);
    }
  }
  // Fallback: if "Unknown" is on a line, the previous "**Address**" is the address.
  const unknownAddrs: string[] = [];
  for (let i = 0; i < addresses.length; i++) {
    const a = addresses[i];
    const fmtA = `${a.slice(0, 4)}…${a.slice(-4)}`;
    // Search in idText for either the full addr or the formatted one with " — Unknown"
    const matchFull = idText.includes(`${a} — Unknown`);
    const matchFmt = idText.includes(`${fmtA} — Unknown`);
    if (matchFull || matchFmt) unknownAddrs.push(a);
  }
  // Use unknown filter; if it found nothing (parsing diff), fall back to all.
  const candidates = unknownAddrs.length > 0 ? unknownAddrs : addresses;
  console.log(`      Filtered: ${candidates.length} unknown (non-CEX/program) candidates`);

  // 3. Score each — parallel, capped at 8 to stay polite
  const limit = Math.min(8, candidates.length);
  const toScore = candidates.slice(0, limit);
  console.log(`[3/4] Scoring top ${toScore.length} candidates in parallel...`);
  const scored = await Promise.all(
    toScore.map(async (addr) => {
      const r = await client.callTool({
        name: 'heliusWallet',
        arguments: { action: 'scoreWallet', address: addr, lookbackDays: 30, ...TELEMETRY },
      });
      const text = (r.content as Array<{ text: string }>)[0].text;
      return parseScoreOutput(text, addr);
    }),
  );

  // 4. Rank and print
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const elapsed = Date.now() - t0;
  console.log(`[4/4] Ranked top ${TOP_N} (wall: ${elapsed}ms):\n`);

  console.log('| Rank | Address          | Score | Activity | Divers | Recency | HoldAge | Flags |');
  console.log('|------|------------------|-------|----------|--------|---------|---------|-------|');
  for (let i = 0; i < Math.min(TOP_N, ranked.length); i++) {
    const w = ranked[i];
    const c = w.components;
    console.log(
      `| ${String(i + 1).padStart(4)} | ${fmt(w.address).padEnd(16)} | ${String(w.score).padStart(5)} | ` +
      `${String(c.activity).padStart(8)} | ${String(c.diversification).padStart(6)} | ` +
      `${String(c.recency).padStart(7)} | ${String(c.holdAge).padStart(7)} | ${w.flags.join(',') || '-'}`,
    );
  }

  console.log(`\nFull score distribution (${scored.length} wallets):`);
  for (const w of ranked) {
    console.log(`  ${fmt(w.address)} → ${w.score}/100 (a${w.components.activity} d${w.components.diversification} r${w.components.recency} h${w.components.holdAge})`);
  }

  await client.close();
}

main().catch((err) => {
  console.error('Discovery failed:', err);
  process.exit(99);
});
