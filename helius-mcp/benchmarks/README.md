## Benchmark Setup

This directory contains benchmark case files for comparing the old direct-tool MCP surface against the new routed MCP surface.

### Local old-vs-new comparison

- New/router worktree: `/Users/nathan/Desktop/dev/core-ai` on branch `context-bloat-router-benchmark`
- Old baseline worktree: `/tmp/core-ai-main-baseline` on branch `main`

The baseline worktree was built locally from `main`, so the comparison includes the full 90+ legacy tools from the repo, not the older npm publish that is missing newer ZK/staking additions.

### Generated files

- `legacy-actions.dummy.json`: full 92-action dummy benchmark corpus generated from `src/router/legacy-actions.ts`
- `router-ab.example.json`: smaller sampled old-vs-new corpus for spot checks

Regenerate the full corpus with:

```bash
cd /Users/nathan/Desktop/dev/core-ai/helius-mcp
pnpm benchmark:mcp:generate-cases
```

### Full local benchmark

Run the full local old-vs-new benchmark with:

```bash
cd /Users/nathan/Desktop/dev/core-ai/helius-mcp
pnpm benchmark:mcp:local-main-vs-router
```

That command:

- uses `/tmp/core-ai-main-baseline/helius-mcp/dist/index.js` as the old 90+ tool baseline
- uses the current `dist/index.js` as the new routed candidate
- regenerates the 92-action corpus first
- restarts the server per scenario
- isolates `HOME` per scenario so config/keypair actions do not touch your real machine state
