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

### DFlow Skill References

The DFlow skill (`helius-skills/helius-dflow/` and `helius-plugin/skills/dflow/`) has its own reference files that **must also be kept in sync**.

- **Canonical source**: `helius-skills/helius-dflow/references/`
- **Copy**: `helius-plugin/skills/dflow/references/`
- The DFlow skill contains 12 reference files: 7 Helius copies (prefixed with `helius-`), 4 DFlow-specific files, and 1 integration-patterns file.
- The Helius copies have modified cross-references (e.g., `references/helius-laserstream.md` instead of `references/laserstream.md`) to work alongside DFlow files in the same directory.
- When updating DFlow reference files, update in `helius-skills/helius-dflow/references/` first, then copy to `helius-plugin/skills/dflow/references/`.

### Phantom Skill References

The Phantom skill (`helius-skills/helius-phantom/` and `helius-plugin/skills/phantom/`) has its own reference files that **must also be kept in sync**.

- **Canonical source**: `helius-skills/helius-phantom/references/`
- **Copy**: `helius-plugin/skills/phantom/references/`
- The Phantom skill contains 16 reference files: 7 Helius copies (prefixed with `helius-`), 8 Phantom-specific files (react-sdk, browser-sdk, react-native-sdk, transactions, token-gating, nft-minting, payments, frontend-security), and 1 integration-patterns file.
- The Helius copies have modified cross-references (e.g., LaserStream and Webhooks point to `docs.helius.dev` instead of local references, since those are excluded from the frontend skill).
- When updating Phantom reference files, update in `helius-skills/helius-phantom/references/` first, then copy to `helius-plugin/skills/phantom/references/`.

### SVM Skill References

The SVM skill (`helius-skills/svm/` and `helius-plugin/skills/svm/`) has its own reference files that **must also be kept in sync**.

- **Canonical source**: `helius-skills/svm/references/`
- **Copy**: `helius-plugin/skills/svm/references/`
- The SVM skill contains 10 reference files: compilation, programs, execution, accounts, transactions, consensus, validators, data, development, tokens.
- When updating SVM reference files, update in `helius-skills/svm/references/` first, then copy to `helius-plugin/skills/svm/references/`.

## SKILL.md Files

The SKILL.md files in each package are intentionally **not identical** — they share most content but differ in:

- Skill name (`helius` vs `build`, `helius-dflow` vs `dflow`, `helius-phantom` vs `phantom`, `svm` vs `svm`)
- Metadata/frontmatter
- MCP prerequisite messaging (manual install vs plugin auto-start)

When making content changes to SKILL.md (e.g., adding rules, updating routing logic, new pitfalls), apply the change to both files manually.
