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


---

## Workflow Preferences (TEST — added 2026-05-03)

> Pilot of autonomous-with-guardrails workflow. If this works well it gets promoted to global config. If it misfires, delete this entire section.

### Self-answered planning (not user-answered)
For non-trivial work, generate the planning questions you would normally ask me, then answer them yourself based on context, codebase signals, and reasonable defaults. Format as a visible Q&A block so I can scan and correct assumptions before implementation begins.

Format:
```
**Plan**
- Q: <question> → A: <your answer> *(assumed — correct me if wrong)*
- Q: <question> → A: <your answer>
- Q: <question> → A: <your answer>

Proceeding unless you redirect.
```

Then implement immediately. Do not pause for user response.

Escalate a question to me ONLY if:
- The answer materially changes the downstream approach AND cannot be inferred from context
- It concerns my taste, business intent, or a destructive/irreversible decision
- I have not given you enough context to make a reasonable default

### After a recommendation, just proceed
- When you surface options and recommend one, **treat the recommendation as the chosen path and proceed**.
- Do not write "Want me to spec X?", "Should I proceed?", "If yes, I'll start...", or similar approval-seeking phrasings. They are banned.
- Pick → self-Q&A → execute. The user interrupts if they want to redirect; absence of objection is consent.

### Never drip questions one at a time
- If you have multiple clarifying questions, batch them ALL into the Plan block.
- Never write "I'll ask one at a time" or "let me ask the first question first" — that is the exact anti-pattern this config exists to prevent.
- One Plan block, all questions self-answered, then go.

### Skills with built-in checkpoints — override their ceremony
- `superpowers:writing-plans`, `superpowers:brainstorming`, `superpowers:executing-plans` and similar skills have approval gates built into their workflow. **The rules in this section override those gates.**
- Use the skills' frameworks (the structure, the rigor, the verification discipline) but skip the "wait for user to confirm before each phase" parts.
- A task list is fine; pausing between tasks for approval is not.

### Execute plans straight through
- Do not break execution into review checkpoints between phases.
- Do not stop to ask "shall I proceed?" — keep going until the plan is done or you hit a real blocker (failing test, ambiguous spec, destructive op).
- Save status updates for the end.

### Plan mode is opt-in
- Do not invoke `EnterPlanMode` for routine work. Proceed directly.
- Use plan mode only for: destructive operations, schema migrations, or changes to shared infrastructure (CI/CD, prod configs, MCP server configs, ~/.claude/settings.json, the canonical sync sources at `helius-skills/`).

### Accuracy gate (non-negotiable)
- Before claiming any task is "done", "fixed", "passing", or "complete": invoke `superpowers:verification-before-completion`.
- Show command output as evidence, not assertions. This rule applies even when other ceremony is skipped.
- For this repo specifically, "done" requires: relevant tests pass, `npx tsx scripts/compile-skills.ts` succeeds if any `helius-skills/` files changed, and CI sync checks would pass.
