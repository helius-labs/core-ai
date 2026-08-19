#!/usr/bin/env npx tsx
/**
 * Skill Compiler — generates cross-platform skill variants from canonical sources.
 *
 * Reads canonical SKILL.md + references/ from helius-skills/<skill>/
 * (and optional variants/{plugin,cursor}.md for destination-specific frontmatter
 * + Prerequisites section).
 *
 * Outputs to:
 *   .agents/skills/<skill>/                    (Codex-native + prompt variants)
 *   helius-mcp/system-prompts/<skill>/         (npm-shipped prompt copies)
 *   helius-plugin/skills/<pluginDir>/          (Claude Code plugin)
 *   helius-cursor/skills/<pluginDir>/          (Cursor plugin)
 *
 * Usage:
 *   npx tsx scripts/compile-skills.ts          # generate everything
 *   npx tsx scripts/compile-skills.ts --check  # diff against on-disk; exit 1 on drift
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

const CHECK_MODE = process.argv.includes("--check");
const driftReports: string[] = [];

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

/** Package roots that own a generated .mcp.json. */
const PLUGIN_ROOT = join(ROOT, "helius-plugin");
const CURSOR_ROOT = join(ROOT, "helius-cursor");

/** Load skill versions from versions.json (single source of truth). */
const VERSIONS: Record<string, string> = JSON.parse(
  readFileSync(join(ROOT, "versions.json"), "utf-8")
);

/**
 * Exact `helius-mcp` version every generated artifact must name.
 *
 * The plugin marketplace pins this repo to a reviewed commit, so a floating
 * `@latest` anywhere in the shipped surface — `.mcp.json` or the "add it
 * manually" instructions the skills print — puts server code outside that
 * review. One pin, one source, enforced by `--check`.
 */
const MCP_PIN: string = VERSIONS["helius-mcp"];
if (!MCP_PIN) {
  console.error('\nversions.json is missing the "helius-mcp" key (the MCP server pin).');
  process.exit(1);
}

/** Matches `helius-mcp@<anything>`, so the pin re-stamps whatever is on disk. */
const MCP_SPEC_SOURCE = "helius-mcp@[0-9A-Za-z.\\-]+";

/**
 * Re-stamp every `helius-mcp@<version>` mention with the pin.
 *
 * Deliberately scoped to the `helius-mcp` package: `helius-cli@latest` in the
 * onboarding paths is a genuinely floating install and stays that way.
 */
function pinMcpVersion(text: string): string {
  return text.replace(new RegExp(MCP_SPEC_SOURCE, "g"), `helius-mcp@${MCP_PIN}`);
}

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
    dir: "helius-jupiter",
    pluginDir: "jupiter",
    enhancedDescription: `Build Solana DeFi applications combining Jupiter APIs with Helius
  infrastructure. Use this skill when: building token swap UIs or trading terminals,
  integrating lending/borrowing via Jupiter Lend, setting up limit orders or DCA,
  querying token prices and metadata, checking token safety via Token Shield,
  embedding a drop-in swap widget, submitting transactions via Helius Sender, or
  optimizing priority fees for DeFi operations. Requires helius-mcp MCP server.`,
  },
  {
    dir: "helius-okx",
    pluginDir: "okx",
    enhancedDescription: `Build Solana trading and intelligence applications combining OKX DEX aggregation
  with Helius infrastructure. Use this skill when: executing swaps via OKX's 500+
  liquidity source aggregator, discovering trending tokens, tracking smart money
  signals, analyzing meme tokens (pump.fun scanning, dev reputation, bundle
  detection), fetching market data and charts, submitting transactions via Helius
  Sender, or building trading bots with LaserStream signals. Requires helius-mcp
  MCP server and onchainos CLI.`,
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
  // Normalize the pin to `@latest` on the way in so the patterns below can stay
  // written against one literal, then re-stamp the real pin on the way out.
  let result = body.replace(new RegExp(MCP_SPEC_SOURCE, "g"), "helius-mcp@latest");

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

  return pinMcpVersion(result);
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
// Filesystem helpers (check-mode aware)
// ---------------------------------------------------------------------------

/** Write text content if changed; in check mode, record drift instead. */
function writeFileMaybe(path: string, content: string): void {
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : null;
  if (CHECK_MODE) {
    if (existing === null) {
      driftReports.push(`MISSING: ${relative(ROOT, path)}`);
    } else if (existing !== content) {
      driftReports.push(`DRIFT:   ${relative(ROOT, path)}`);
    }
    return;
  }
  if (existing !== content) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

/** Copy a file (binary-safe) with the same drift-detection semantics. */
function copyFileMaybe(src: string, dest: string): void {
  const srcBuf = readFileSync(src);
  const existing = existsSync(dest) ? readFileSync(dest) : null;
  if (CHECK_MODE) {
    if (existing === null) {
      driftReports.push(`MISSING: ${relative(ROOT, dest)}`);
    } else if (!existing.equals(srcBuf)) {
      driftReports.push(`DRIFT:   ${relative(ROOT, dest)}`);
    }
    return;
  }
  if (!existing || !existing.equals(srcBuf)) {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, srcBuf);
  }
}

/**
 * Report files present in a generated references/ directory but absent from
 * canonical.
 *
 * Copying canonical -> dest cannot see these: a reference file that was renamed
 * or removed upstream leaves its old copy behind in every destination, and every
 * byte-for-byte comparison still passes. The bash this replaced caught it with
 * `comm -13`.
 *
 * Orphans are reported, never deleted — removing files the compiler does not own
 * is not a safe default for a codegen step.
 */
function reportOrphanRefs(canonicalRefsDir: string, destRefsDir: string): void {
  if (!existsSync(destRefsDir)) return;

  const canonical = new Set(
    existsSync(canonicalRefsDir) ? readdirSync(canonicalRefsDir) : []
  );

  for (const file of readdirSync(destRefsDir)) {
    if (!canonical.has(file)) {
      const rel = relative(ROOT, join(destRefsDir, file));
      if (CHECK_MODE) {
        driftReports.push(`ORPHAN:  ${rel}`);
      } else {
        console.warn(`  ! orphan reference (not in canonical): ${rel}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Plugin/Cursor sync
// ---------------------------------------------------------------------------
//
// Plugin/cursor SKILL.md bodies are intentionally bespoke (different MCP
// prerequisite messaging, condensed router surface section). They are
// hand-managed in helius-plugin/ and helius-cursor/. The compiler:
//   1. Re-injects the canonical version into their frontmatter (single
//      source of truth = versions.json).
//   2. Re-stamps the helius-mcp pin in the body. The prose stays hand-authored;
//      only the version token is compiler-owned.
//   3. Bytewise-copies the canonical references/ directory into each.
//
// Reference files MUST be byte-identical across all destinations — this is
// what previously required ~420 lines of duplicated bash in CI.

/** Update version in an existing plugin/cursor SKILL.md and copy refs. */
function syncPluginCursorSkill(
  destRoot: string,
  pluginDir: string,
  canonicalRefsDir: string,
  version: string
): void {
  const destSkillDir = join(destRoot, pluginDir);
  const destSkillMd = join(destSkillDir, "SKILL.md");

  // Version sync into existing SKILL.md frontmatter.
  //
  // These bodies are hand-authored, so the compiler cannot create one. But
  // skipping silently hides the misconfiguration it is most likely to encounter:
  // a new pluginDir added to SKILLS whose SKILL.md nobody wrote.
  if (!existsSync(destSkillMd)) {
    const rel = relative(ROOT, destSkillMd);
    if (CHECK_MODE) {
      driftReports.push(`MISSING: ${rel}`);
    } else {
      console.warn(`  ! hand-authored SKILL.md not found: ${rel}`);
    }
  } else {
    const raw = readFileSync(destSkillMd, "utf-8");
    const parsed = parseFrontmatter(raw);
    if (parsed.frontmatter) {
      const updatedFm = injectVersion(parsed.frontmatter, version);
      const updated = `---\n${updatedFm}\n---\n${pinMcpVersion(parsed.body)}`;
      writeFileMaybe(destSkillMd, updated);
    } else {
      // Same reasoning: a SKILL.md with no frontmatter can never receive a
      // version, so the version guarantee silently stops holding for it.
      const rel = relative(ROOT, destSkillMd);
      if (CHECK_MODE) {
        driftReports.push(`NO-FRONTMATTER: ${rel}`);
      } else {
        console.warn(`  ! SKILL.md has no frontmatter, version not injected: ${rel}`);
      }
    }
  }

  // Reference files: bytewise copy from canonical
  const destRefsDir = join(destSkillDir, "references");
  if (existsSync(canonicalRefsDir)) {
    for (const file of readdirSync(canonicalRefsDir)) {
      copyFileMaybe(join(canonicalRefsDir, file), join(destRefsDir, file));
    }
  }
  reportOrphanRefs(canonicalRefsDir, destRefsDir);
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
  const { frontmatter, body: rawBody } = parseFrontmatter(raw);
  const body = pinMcpVersion(rawBody);
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
  writeFileMaybe(skillMdPath, updatedCanonical);

  // --- Canonical install.sh: re-stamp the pin ---
  //
  // install.sh copies SKILL.md + references/ into the user's skills dir and then
  // prints how to add the MCP server. If it printed a floating tag it would
  // contradict the very files it just installed.
  const installSh = join(srcDir, "install.sh");
  if (existsSync(installSh)) {
    writeFileMaybe(installSh, pinMcpVersion(readFileSync(installSh, "utf-8")));
  }

  // --- Canonical references: re-stamp the pin at the source ---
  //
  // These are copied bytewise into helius-plugin/ and helius-cursor/, so the pin
  // has to be correct here or the byte-identity invariant would force the
  // destinations to disagree with .mcp.json.
  if (existsSync(refsDir)) {
    for (const file of readdirSync(refsDir)) {
      if (!file.endsWith(".md")) continue;
      const refPath = join(refsDir, file);
      writeFileMaybe(refPath, pinMcpVersion(readFileSync(refPath, "utf-8")));
    }
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

  // Codex SKILL.md
  writeFileMaybe(join(agentsSkillDir, "SKILL.md"), generationHeader + codexSkillMd);

  // Copy reference files into agents/ (with Claude-isms stripped for .md)
  const agentsRefsDir = join(agentsSkillDir, "references");
  if (existsSync(refsDir)) {
    for (const file of readdirSync(refsDir)) {
      const srcPath = join(refsDir, file);
      const destPath = join(agentsRefsDir, file);
      if (file.endsWith(".md")) {
        const content = readFileSync(srcPath, "utf-8");
        writeFileMaybe(destPath, stripClaudeSpecific(content));
      } else {
        copyFileMaybe(srcPath, destPath);
      }
    }
  }
  reportOrphanRefs(refsDir, agentsRefsDir);

  // Prompt variants — both locations
  writeFileMaybe(join(agentsPromptsDir, "openai.developer.md"), openaiContent);
  writeFileMaybe(join(agentsPromptsDir, "claude.system.md"), claudeContent);
  writeFileMaybe(join(agentsPromptsDir, "full.md"), fullContent);

  writeFileMaybe(join(mcpSkillDir, "openai.developer.md"), openaiContent);
  writeFileMaybe(join(mcpSkillDir, "claude.system.md"), claudeContent);
  writeFileMaybe(join(mcpSkillDir, "full.md"), fullContent);

  // --- Plugin + Cursor: version sync + refs copy ---
  syncPluginCursorSkill(PLUGIN_DIR, config.pluginDir, refsDir, version);
  syncPluginCursorSkill(CURSOR_DIR, config.pluginDir, refsDir, version);

  // Count refs for summary
  const refCount = existsSync(refsDir)
    ? readdirSync(refsDir).filter((f: string) => f.endsWith(".md")).length
    : 0;

  console.log(`  ✓ ${config.dir} v${version} (${refCount} refs, 3 prompts)`);
}

/**
 * Generate the plugin + cursor `.mcp.json` from the `helius-mcp` pin in versions.json.
 *
 * The Claude plugin marketplace pins this repo to a reviewed commit, so the MCP
 * server version must be exact — a floating `@latest` would execute code outside
 * that review. Both destinations are byte-identical by design.
 *
 * Emitted as a template literal, not JSON.stringify: `--check` compares bytes, and
 * JSON.stringify(obj, null, 2) expands `args` across three lines instead of the
 * inline form used here.
 */
function syncMcpConfigs(): void {
  const content = `{
  "mcpServers": {
    "helius": {
      "command": "npx",
      "args": ["helius-mcp@${MCP_PIN}"]
    }
  }
}
`;

  writeFileMaybe(join(PLUGIN_ROOT, ".mcp.json"), content);
  writeFileMaybe(join(CURSOR_ROOT, ".mcp.json"), content);

  console.log(`  \u2713 .mcp.json pinned to helius-mcp@${MCP_PIN} (plugin + cursor)`);
}

function main(): void {
  console.log(CHECK_MODE ? "Checking compiled skills...\n" : "Compiling skills...\n");
  console.log(`  Source: ${relative(ROOT, CANONICAL_DIR)}/`);
  if (!CHECK_MODE) {
    console.log(`  Output: ${relative(ROOT, AGENTS_OUT)}/`);
    console.log(`          ${relative(ROOT, MCP_OUT)}/`);
    console.log(`          ${relative(ROOT, PLUGIN_DIR)}/`);
    console.log(`          ${relative(ROOT, CURSOR_DIR)}/`);
  }
  console.log();

  for (const skill of SKILLS) {
    compileSkill(skill);
  }

  // Must run before the drift check below: that block exits the process.
  syncMcpConfigs();

  if (CHECK_MODE) {
    if (driftReports.length > 0) {
      console.error(`\n${driftReports.length} file(s) out of sync:\n`);
      for (const r of driftReports) console.error(`  ${r}`);
      console.error(`\nRun \`npx tsx scripts/compile-skills.ts\` to regenerate.`);
      process.exit(1);
    }
    console.log("\nAll generated outputs are in sync.");
    return;
  }

  console.log("\nDone.");
}

main();
