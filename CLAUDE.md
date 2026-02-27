# Core AI

Monorepo containing Helius developer tools distributed as independent packages:

- `helius-mcp/` — MCP server (npm: `helius-mcp`) — AI-assistant agnostic
- `helius-skills/` — Standalone Claude Code skill (installed via `install.sh`)
- `helius-plugin/` — Claude Code plugin (all-in-one: bundles skill + auto-starts MCP)
- `helius-cli/` — CLI for account setup (npm: `helius-cli`)

## Shared Content: Reference Files

The reference files in `helius-skills/helius/references/` and `helius-plugin/skills/build/references/` **must be kept in sync**. These are the canonical Helius API reference docs used by Claude to route and compose tool calls.

- **Canonical source**: `helius-skills/helius/references/`
- **Copy**: `helius-plugin/skills/build/references/`
- When updating any reference file, update it in `helius-skills/` first, then copy the change to `helius-plugin/`.
- CI will fail if these directories diverge.

## SKILL.md Files

The SKILL.md files in each package are intentionally **not identical** — they share most content but differ in:

- Skill name (`helius` vs `build`)
- Metadata/frontmatter
- MCP prerequisite messaging (manual install vs plugin auto-start)

When making content changes to SKILL.md (e.g., adding rules, updating routing logic, new pitfalls), apply the change to both files manually.
