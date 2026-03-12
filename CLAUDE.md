# Core AI

Monorepo containing Helius developer tools distributed as independent packages:

- `helius-mcp/` — MCP server (npm: `helius-mcp`) — AI-assistant agnostic
- `helius-skills/` — Standalone Claude Code skill (installed via `install.sh`)
- `helius-plugin/` — Claude Code plugin (all-in-one: bundles skill + auto-starts MCP)
- `helius-cursor/` — Cursor plugin (all-in-one: bundles skill + auto-starts MCP)
- `helius-cli/` — CLI for account setup (npm: `helius-cli`)

## Shared Content: Reference Files

The reference files in `helius-skills/helius/references/` and `helius-plugin/skills/build/references/` **must be kept in sync**. These are the canonical Helius API reference docs used by Claude to route and compose tool calls.

- **Canonical source**: `helius-skills/helius/references/`
- **Copies**: `helius-plugin/skills/build/references/`, `helius-cursor/skills/build/references/`
- When updating any reference file, update it in `helius-skills/` first, then copy the change to both `helius-plugin/` and `helius-cursor/`.
- CI will fail if these directories diverge.

### DFlow Skill References

The DFlow skill (`helius-skills/helius-dflow/`, `helius-plugin/skills/dflow/`, and `helius-cursor/skills/dflow/`) has its own reference files that **must also be kept in sync**.

- **Canonical source**: `helius-skills/helius-dflow/references/`
- **Copies**: `helius-plugin/skills/dflow/references/`, `helius-cursor/skills/dflow/references/`
- The DFlow skill contains 12 reference files: 7 Helius copies (prefixed with `helius-`), 4 DFlow-specific files, and 1 integration-patterns file.
- The Helius copies have modified cross-references (e.g., `references/helius-laserstream.md` instead of `references/laserstream.md`) to work alongside DFlow files in the same directory.
- When updating DFlow reference files, update in `helius-skills/helius-dflow/references/` first, then copy to both `helius-plugin/skills/dflow/references/` and `helius-cursor/skills/dflow/references/`.

### Phantom Skill References

The Phantom skill (`helius-skills/helius-phantom/`, `helius-plugin/skills/phantom/`, and `helius-cursor/skills/phantom/`) has its own reference files that **must also be kept in sync**.

- **Canonical source**: `helius-skills/helius-phantom/references/`
- **Copies**: `helius-plugin/skills/phantom/references/`, `helius-cursor/skills/phantom/references/`
- The Phantom skill contains 16 reference files: 7 Helius copies (prefixed with `helius-`), 8 Phantom-specific files (react-sdk, browser-sdk, react-native-sdk, transactions, token-gating, nft-minting, payments, frontend-security), and 1 integration-patterns file.
- The Helius copies have modified cross-references (e.g., LaserStream and Webhooks point to `docs.helius.dev` instead of local references, since those are excluded from the frontend skill).
- When updating Phantom reference files, update in `helius-skills/helius-phantom/references/` first, then copy to both `helius-plugin/skills/phantom/references/` and `helius-cursor/skills/phantom/references/`.

### OKX Skill References

The OKX skill (`helius-skills/helius-okx/`, `helius-plugin/skills/okx/`, and `helius-cursor/skills/okx/`) has its own reference files that **must also be kept in sync**.

- **Canonical source**: `helius-skills/helius-okx/references/`
- **Copies**: `helius-plugin/skills/okx/references/`, `helius-cursor/skills/okx/references/`
- The OKX skill contains 13 reference files: 7 Helius copies (prefixed with `helius-`), 5 OKX-specific files (swap, token-discovery, market-data, signals-trenches, gateway), and 1 integration-patterns file.
- The Helius copies have modified cross-references (e.g., `references/helius-laserstream.md` instead of `references/laserstream.md`) to work alongside OKX files in the same directory.
- When updating OKX reference files, update in `helius-skills/helius-okx/references/` first, then copy to both `helius-plugin/skills/okx/references/` and `helius-cursor/skills/okx/references/`.

### SVM Skill References

The SVM skill (`helius-skills/svm/`, `helius-plugin/skills/svm/`, and `helius-cursor/skills/svm/`) has its own reference files that **must also be kept in sync**.

- **Canonical source**: `helius-skills/svm/references/`
- **Copies**: `helius-plugin/skills/svm/references/`, `helius-cursor/skills/svm/references/`
- The SVM skill contains 10 reference files: compilation, programs, execution, accounts, transactions, consensus, validators, data, development, tokens.
- When updating SVM reference files, update in `helius-skills/svm/references/` first, then copy to both `helius-plugin/skills/svm/references/` and `helius-cursor/skills/svm/references/`.

## Skill Versioning

Skill versions are managed via `versions.json` at the repo root (single source of truth). The compiler reads this file and injects versions into all SKILL.md copies and prompt variants.

- **To bump a version**: edit `versions.json`, then run `npx tsx scripts/compile-skills.ts`
- The compiler updates: canonical `helius-skills/*/SKILL.md`, plugin/cursor copies, Codex SKILL.md, and all prompt variants (openai/claude/full)
- Versions follow semver (`major.minor.patch`)

## Generated Output

The following directories are **generated** by `npx tsx scripts/compile-skills.ts` from canonical sources in `helius-skills/`. Do not edit them directly.

- `.agents/skills/` — Codex-native skills + prompt variants
- `helius-mcp/system-prompts/` — npm-shipped prompt copies

### Sync Paths from Canonical Source

All skill content flows from `helius-skills/` to four destinations:

1. `helius-skills/` → `helius-plugin/skills/` (manual copy — Claude Code plugin)
2. `helius-skills/` → `helius-cursor/skills/` (manual copy — Cursor plugin)
3. `helius-skills/` → `.agents/skills/` (compiler-generated)
4. `helius-skills/` → `helius-mcp/system-prompts/` (compiler-generated)

CI validates all sync paths. After modifying any `SKILL.md` or reference file in `helius-skills/`, run `npx tsx scripts/compile-skills.ts` to regenerate output.

## SKILL.md Files

The SKILL.md files in each package are intentionally **not identical** — they share most content but differ in:

- Skill name (`helius` vs `build`, `helius-dflow` vs `dflow`, `helius-okx` vs `okx`, `helius-phantom` vs `phantom`, `svm` vs `svm`)
- Metadata/frontmatter
- MCP prerequisite messaging (manual install vs plugin auto-start, Cursor vs Claude Code restart instructions)

When making content changes to SKILL.md (e.g., adding rules, updating routing logic, new pitfalls), apply the change to `helius-plugin/`, `helius-cursor/`, and `helius-skills/` manually.
