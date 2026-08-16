# Core AI

Monorepo containing Helius developer tools distributed as independent packages:

- `helius-mcp/` — MCP server (npm: `helius-mcp`) — AI-assistant agnostic
- `helius-skills/` — Standalone Claude Code skill (installed via `install.sh`)
- `helius-plugin/` — Claude Code plugin (all-in-one: bundles skill + auto-starts MCP)
- `helius-cursor/` — Cursor plugin (all-in-one: bundles skill + auto-starts MCP)
- `helius-cli/` — CLI for account setup (npm: `helius-cli`)

## Compiler-managed sync

The compiler (`npx tsx scripts/compile-skills.ts`) is the source of truth for everything generated from `helius-skills/`. It writes:

1. `helius-skills/<skill>/SKILL.md` frontmatter version (re-injected from `versions.json`)
2. `.agents/skills/<skill>/` — Codex-native SKILL.md + 3 prompt variants (`openai.developer.md`, `claude.system.md`, `full.md`)
3. `helius-mcp/system-prompts/<skill>/` — same prompt variants, npm-shipped
4. `helius-plugin/skills/<dir>/references/` and `helius-plugin/skills/<dir>/SKILL.md` (refs bytewise from canonical; SKILL.md gets version re-injected)
5. `helius-cursor/skills/<dir>/references/` and `helius-cursor/skills/<dir>/SKILL.md` (same)

Run `npx tsx scripts/compile-skills.ts` after any change in `helius-skills/`. CI runs `--check` mode and fails on drift.

**Reference files** are byte-identical across all destinations — never hand-edit `helius-plugin/` or `helius-cursor/` references; only edit the canonical copy in `helius-skills/<skill>/references/`.

**SKILL.md bodies** in `helius-plugin/` and `helius-cursor/` are intentionally **not identical** to canonical (different MCP prerequisite messaging, condensed router surface section). They are hand-managed in those packages. Only the frontmatter version is auto-synced from `versions.json`.

## Skill Versioning

Skill versions are managed via `versions.json` at the repo root (single source of truth). To bump a version, edit `versions.json` and re-run the compiler. Versions follow semver.

## Router Surface Maintenance

The Helius MCP public surface is a coordinated contract: 10 public tools total, shared `action` routing, and summary-first responses with `expandResult`.

If you change the router surface, routed tool descriptions, action-routing guidance, or summary-first response behavior, update all of these in the same pass:

- `AGENTS.md`
- `README.md`
- `helius-mcp/README.md`
- `helius-plugin/README.md`
- `helius-cursor/README.md`
- canonical `helius-skills/*/SKILL.md`
- manual plugin/cursor `SKILL.md` copies
- generated `.agents/skills/` output
- generated `helius-mcp/system-prompts/` output

Do not leave router/runtime changes documented in only one layer.
