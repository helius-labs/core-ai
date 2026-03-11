#!/usr/bin/env npx tsx
/**
 * Skill Compiler — generates cross-platform skill variants from canonical sources.
 *
 * Reads canonical SKILL.md + references/ from helius-skills/<skill>/
 * Outputs to:
 *   .agents/skills/<skill>/           (Codex-native)
 *   helius-mcp/system-prompts/<skill>/ (npm-shipped)
 *
 * Usage: npx tsx scripts/compile-skills.ts
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, existsSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const CANONICAL_DIR = join(ROOT, "helius-skills");
const AGENTS_OUT = join(ROOT, ".agents", "skills");
const MCP_OUT = join(ROOT, "helius-mcp", "system-prompts");

interface SkillConfig {
  /** Directory name under helius-skills/ */
  dir: string;
  /** Directory name under helius-plugin/skills/ and helius-cursor/skills/ */
  pluginDir: string;
  /** Enhanced multi-line description for Codex implicit invocation */
  enhancedDescription: string;
}

const PLUGIN_DIR = join(ROOT, "helius-plugin", "skills");
const CURSOR_DIR = join(ROOT, "helius-cursor", "skills");

/** Load skill versions from versions.json (single source of truth). */
const VERSIONS: Record<string, string> = JSON.parse(
  readFileSync(join(ROOT, "versions.json"), "utf-8")
);

const SKILLS: SkillConfig[] = [
  {
    dir: "helius",
    pluginDir: "build",
    enhancedDescription: `Build Solana applications with Helius infrastructure. Use this skill when:
  sending transactions (SOL, SPL tokens, swaps), querying assets/NFTs (DAS API),
  streaming real-time data (WebSockets, Laserstream), setting up webhooks for
  event notifications, analyzing wallets (balances, history, identity), or
  managing Helius API keys and plans. Requires helius-mcp MCP server.`,
  },
  {
    dir: "helius-dflow",
    pluginDir: "dflow",
    enhancedDescription: `Build Solana trading applications combining DFlow trading APIs with Helius
  infrastructure. Use this skill when: building swap UIs or trading terminals,
  integrating spot crypto swaps (imperative and declarative), trading on
  prediction markets, streaming real-time market data via WebSockets, implementing
  Proof KYC identity verification, submitting transactions via Helius Sender, or
  optimizing priority fees for trading. Requires helius-mcp MCP server.`,
  },
  {
    dir: "helius-phantom",
    pluginDir: "phantom",
    enhancedDescription: `Build frontend Solana applications with Phantom Connect SDK and Helius
  infrastructure. Use this skill when: connecting Phantom wallet in React,
  React Native, or vanilla JS apps, signing and submitting transactions via
  Helius Sender, building token-gated content, minting NFTs, accepting crypto
  payments, displaying portfolio data, streaming real-time updates, or setting
  up secure API key proxying. Requires helius-mcp MCP server.`,
  },
  {
    dir: "svm",
    pluginDir: "svm",
    enhancedDescription: `Explore Solana's architecture and protocol internals. Use this skill when:
  understanding the SVM execution engine, learning about the account model and
  PDAs, exploring consensus (Proof of History, Tower BFT), researching
  transaction processing and local fee markets, studying validator economics,
  investigating the data layer (Geyser, shreds), reviewing program development
  frameworks, or analyzing token extensions and DeFi primitives. Requires
  helius-mcp MCP server for knowledge tools.`,
  },
];

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

/** Parse YAML frontmatter from SKILL.md. Returns { frontmatter, body }. */
function parseFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: "", body: content };
  return { frontmatter: match[1], body: match[2] };
}

/** Extract the `name:` value from frontmatter. */
function extractName(frontmatter: string): string {
  const match = frontmatter.match(/^name:\s*(.+)$/m);
  return match ? match[1].trim() : "unknown";
}

/** Inject or update the version field in YAML frontmatter. */
function injectVersion(frontmatter: string, version: string): string {
  // If metadata.version exists, replace it
  if (/^\s+version:\s*.+$/m.test(frontmatter)) {
    return frontmatter.replace(
      /^(\s+version:\s*).+$/m,
      `$1"${version}"`
    );
  }
  // If metadata block exists, append version to it
  if (/^metadata:\s*$/m.test(frontmatter)) {
    return frontmatter.replace(
      /^(metadata:\s*)$/m,
      `$1\n  version: "${version}"`
    );
  }
  // Otherwise append a metadata block
  return `${frontmatter}\nmetadata:\n  version: "${version}"`;
}

/** Build Codex-compatible frontmatter (name + enhanced description + version). */
function buildCodexFrontmatter(name: string, enhancedDesc: string, version: string): string {
  return `---
name: ${name}
version: "${version}"
description: >
  ${enhancedDesc}
---`;
}

/** Strip Claude-specific language from body text. */
function stripClaudeSpecific(body: string): string {
  let result = body;

  // Replace "claude mcp add helius npx helius-mcp@latest" — inline backtick version
  result = result.replace(
    /`claude mcp add helius npx helius-mcp@latest`/g,
    "`npx helius-mcp@latest` (configure in your MCP client)"
  );

  // Replace bare "claude mcp add helius npx helius-mcp@latest" (inside code blocks)
  result = result.replace(
    /^claude mcp add helius npx helius-mcp@latest$/gm,
    "npx helius-mcp@latest  # configure in your MCP client"
  );

  // Replace multi-line code blocks with claude mcp add
  result = result.replace(
    /```\n(?:You need to install the Helius MCP server first:\n)?claude mcp add helius npx helius-mcp@latest\nThen restart Claude so the tools become available\.\n```/g,
    "```\nConfigure the Helius MCP server in your MCP client: npx helius-mcp@latest\nThen restart your AI assistant so the tools become available.\n```"
  );

  // Also handle the code block variant with leading text
  result = result.replace(
    /```\nYou need to install the Helius MCP server first:\nclaude mcp add helius npx helius-mcp@latest\nThen restart Claude so the tools become available\.\n```/g,
    "```\nConfigure the Helius MCP server in your MCP client: npx helius-mcp@latest\nThen restart your AI assistant so the tools become available.\n```"
  );

  // Replace "claude mcp add" instructions for DFlow
  result = result.replace(
    /It can also be installed by running the command `claude mcp add --transport http DFlow https:\/\/pond\.dflow\.net\/mcp`, or by being directly added to your project's `\.mcp\.json`:/g,
    "It can also be configured in your MCP client at `https://pond.dflow.net/mcp`, or by being directly added to your project's `.mcp.json`:"
  );

  // Replace /helius, /svm, /helius-dflow, /helius-phantom slash commands
  result = result.replace(/`\/helius-dflow`/g, "the Helius DFlow skill");
  result = result.replace(/`\/helius-phantom`/g, "the Helius Phantom skill");
  result = result.replace(/`\/helius`/g, "the Helius skill");
  result = result.replace(/`\/svm`/g, "the SVM skill");

  // Replace "restart Claude" with generic
  result = result.replace(/restart Claude/g, "restart your AI assistant");

  // Replace "Helius MCP Server: `claude mcp add helius npx helius-mcp@latest`" in Resources
  result = result.replace(
    /Helius MCP Server: `claude mcp add helius npx helius-mcp@latest`/g,
    "Helius MCP Server: `npx helius-mcp@latest`"
  );

  // Strip internal notes: <!-- internal --> lines, <!-- internal-only --> lines
  result = result.replace(/<!--\s*internal(?:-only)?\s*-->[^\n]*\n?/g, "");

  // Strip internal blocks: <!-- BEGIN INTERNAL --> ... <!-- END INTERNAL -->
  result = result.replace(/<!--\s*BEGIN INTERNAL\s*-->[\s\S]*?<!--\s*END INTERNAL\s*-->\n?/g, "");

  return result;
}

/** Rename headings per the plan's normalization table. */
function renameHeadings(body: string): string {
  let result = body;

  // Rename "### Common Pitfalls" or "## Common Pitfalls" to "## Quality Checks & Common Pitfalls"
  result = result.replace(
    /^(#{2,3})\s+Common Pitfalls\s*$/gm,
    "## Quality Checks & Common Pitfalls"
  );

  return result;
}

/** Build the OpenAI API preamble (Layer A harness for openai.developer.md). */
function buildOpenAIPreamble(skillName: string, version: string): string {
  return `<!-- Generated from helius-skills/${skillName}/SKILL.md — do not edit -->
<!-- OpenAI Responses / Chat Completions API — use as a \`developer\` message -->
<!-- Version: ${version} -->

## Runtime Notes

- This skill is designed for the \`developer\` role message (preferred over \`system\` for procedural guidance)
- MCP tools referenced below are available via function calling if you have configured \`helius-mcp\` as a tool source
- Structured output JSON can be enforced for automation via response_format
- Reference files mentioned below are available in the skill directory or can be inlined from \`full.md\`

`;
}

/** Build the Claude API preamble (Layer A harness for claude.system.md). */
function buildClaudePreamble(skillName: string, version: string): string {
  return `<!-- Generated from helius-skills/${skillName}/SKILL.md — do not edit -->
<!-- Claude API — use as a system prompt block -->
<!-- Version: ${version} -->

## Runtime Notes

- This skill goes in the system prompt
- MCP tools referenced below are available natively via Claude's MCP integration
- Configure helius-mcp as an MCP tool source for live blockchain access
- Reference files mentioned below are available in the skill directory or can be inlined from \`full.md\`

`;
}

/** Wrap skill content with delimiters for API prompts. */
function wrapWithDelimiters(skillName: string, content: string): string {
  return `=== BEGIN SKILL: ${skillName} ===

${content}

=== END SKILL: ${skillName} ===`;
}

/** Make reference pointers compact for prompt variants. */
function compactReferencePointers(body: string): string {
  // "**Read**: `references/sender.md`" → "**Reference**: See sender.md"
  return body.replace(
    /\*\*Read\*\*:\s*`references\/([^`]+)`/g,
    "**Reference**: See $1"
  );
}

/** Inline all reference files into the body for full.md variant. */
function inlineReferences(body: string, refsDir: string): string {
  if (!existsSync(refsDir)) return body;

  const refFiles = readdirSync(refsDir)
    .filter((f: string) => f.endsWith(".md"))
    .sort();

  if (refFiles.length === 0) return body;

  let inlined = body;

  // Replace "**Read**: `references/foo.md`" pointers with a note
  inlined = inlined.replace(
    /\*\*Read\*\*:\s*`references\/([^`]+)`/g,
    "**Reference**: See $1 (inlined below)"
  );

  // Append all reference files at the end (with Claude-isms stripped)
  inlined += "\n\n---\n\n# Reference Files\n\n";
  for (const file of refFiles) {
    const raw = readFileSync(join(refsDir, file), "utf-8");
    const cleaned = stripClaudeSpecific(raw);
    inlined += `## ${file}\n\n${cleaned}\n\n---\n\n`;
  }

  return inlined;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function compileSkill(config: SkillConfig): void {
  const srcDir = join(CANONICAL_DIR, config.dir);
  const skillMdPath = join(srcDir, "SKILL.md");
  const refsDir = join(srcDir, "references");

  if (!existsSync(skillMdPath)) {
    console.error(`  SKIP: ${skillMdPath} not found`);
    return;
  }

  const raw = readFileSync(skillMdPath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const name = extractName(frontmatter);
  const version = VERSIONS[config.dir];
  if (!version) {
    console.error(`  SKIP: no version in versions.json for "${config.dir}"`);
    return;
  }
  const generationHeader = `<!-- Generated from helius-skills/${config.dir}/SKILL.md — do not edit -->\n\n`;

  // --- Update canonical SKILL.md version from versions.json ---
  const updatedFrontmatter = injectVersion(frontmatter, version);
  const updatedCanonical = `---\n${updatedFrontmatter}\n---\n${body}`;
  if (updatedCanonical !== raw) {
    writeFileSync(skillMdPath, updatedCanonical);
    console.log(`  ↻ ${config.dir}/SKILL.md version → ${version}`);
  }

  // --- Apply transforms ---
  let transformed = stripClaudeSpecific(body);
  transformed = renameHeadings(transformed);

  // --- Codex SKILL.md ---
  const codexFrontmatter = buildCodexFrontmatter(name, config.enhancedDescription, version);
  const codexSkillMd = `${codexFrontmatter}\n${transformed}`;

  // --- Prompt variants ---
  const compactBody = compactReferencePointers(transformed);

  // openai.developer.md
  const openaiContent =
    buildOpenAIPreamble(config.dir, version) +
    wrapWithDelimiters(name, compactBody);

  // claude.system.md
  const claudeContent =
    buildClaudePreamble(config.dir, version) +
    wrapWithDelimiters(name, compactBody);

  // full.md (all references inlined, no frontmatter — targets Cursor Rules / ChatGPT)
  const fullBody = inlineReferences(transformed, refsDir);
  const fullVersionHeader = `<!-- Generated from helius-skills/${config.dir}/SKILL.md — do not edit -->\n<!-- Version: ${version} -->\n\n`;
  const fullContent = fullVersionHeader + fullBody;

  // --- Write outputs ---
  const agentsSkillDir = join(AGENTS_OUT, config.dir);
  const agentsPromptsDir = join(agentsSkillDir, "prompts");
  const mcpSkillDir = join(MCP_OUT, config.dir);

  mkdirSync(agentsPromptsDir, { recursive: true });
  mkdirSync(mcpSkillDir, { recursive: true });

  // Codex SKILL.md
  writeFileSync(join(agentsSkillDir, "SKILL.md"), generationHeader + codexSkillMd);

  // Copy reference files (with Claude-isms stripped)
  if (existsSync(refsDir)) {
    const agentsRefsDir = join(agentsSkillDir, "references");
    mkdirSync(agentsRefsDir, { recursive: true });
    for (const file of readdirSync(refsDir)) {
      const srcPath = join(refsDir, file);
      const destPath = join(agentsRefsDir, file);
      if (file.endsWith(".md")) {
        const content = readFileSync(srcPath, "utf-8");
        writeFileSync(destPath, stripClaudeSpecific(content));
      } else {
        cpSync(srcPath, destPath);
      }
    }
  }

  // Prompt variants — both locations
  writeFileSync(join(agentsPromptsDir, "openai.developer.md"), openaiContent);
  writeFileSync(join(agentsPromptsDir, "claude.system.md"), claudeContent);
  writeFileSync(join(agentsPromptsDir, "full.md"), fullContent);

  writeFileSync(join(mcpSkillDir, "openai.developer.md"), openaiContent);
  writeFileSync(join(mcpSkillDir, "claude.system.md"), claudeContent);
  writeFileSync(join(mcpSkillDir, "full.md"), fullContent);

  // --- Sync version into plugin/cursor SKILL.md copies ---
  for (const destRoot of [PLUGIN_DIR, CURSOR_DIR]) {
    const destSkillMd = join(destRoot, config.pluginDir, "SKILL.md");
    if (!existsSync(destSkillMd)) continue;
    const destRaw = readFileSync(destSkillMd, "utf-8");
    const destParsed = parseFrontmatter(destRaw);
    const destUpdatedFm = injectVersion(destParsed.frontmatter, version);
    const destUpdated = `---\n${destUpdatedFm}\n---\n${destParsed.body}`;
    if (destUpdated !== destRaw) {
      writeFileSync(destSkillMd, destUpdated);
      console.log(`  ↻ ${relative(ROOT, destSkillMd)} version → ${version}`);
    }
  }

  // Count refs for summary
  const refCount = existsSync(refsDir)
    ? readdirSync(refsDir).filter((f: string) => f.endsWith(".md")).length
    : 0;

  console.log(`  ✓ ${config.dir} v${version} (${refCount} refs, 3 prompts)`);
}

function main(): void {
  console.log("Compiling skills...\n");
  console.log(`  Source: ${relative(ROOT, CANONICAL_DIR)}/`);
  console.log(`  Output: ${relative(ROOT, AGENTS_OUT)}/`);
  console.log(`          ${relative(ROOT, MCP_OUT)}/\n`);

  for (const skill of SKILLS) {
    compileSkill(skill);
  }

  console.log("\nDone.");
}

main();
