import chalk from "chalk";
import ora from "ora";
import { CLI_USER_AGENT } from "../http.js";
import { outputJson, handleCommandError, exitWithError, ExitCode, type OutputOptions } from "../lib/output.js";

// ---------------------------------------------------------------------------
// GitHub constants
// ---------------------------------------------------------------------------

const SIMD_REPO = "solana-foundation/solana-improvement-documents";
const SIMD_API_URL = `https://api.github.com/repos/${SIMD_REPO}/contents/proposals`;
const SIMD_RAW_BASE = `https://raw.githubusercontent.com/${SIMD_REPO}/main/proposals`;

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": CLI_USER_AGENT,
    Accept: "application/vnd.github.v3+json",
  };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `token ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// SIMD index
// ---------------------------------------------------------------------------

interface SimdEntry {
  number: string;
  slug: string;
  filename: string;
}

async function fetchSimdIndex(): Promise<SimdEntry[]> {
  const response = await fetch(SIMD_API_URL, { headers: githubHeaders() });
  if (!response.ok) {
    if (response.status === 403 || response.status === 429) {
      throw new Error(`GitHub API rate limit exceeded (HTTP ${response.status}). Set GITHUB_TOKEN env var to increase the limit.`);
    }
    throw new Error(`GitHub API returned HTTP ${response.status}: ${response.statusText}`);
  }

  const files = (await response.json()) as Array<{ name: string }>;
  return files
    .filter((f) => f.name.endsWith(".md"))
    .map((f) => {
      const match = f.name.match(/^(\d+)-(.+)\.md$/);
      return match ? { number: match[1], slug: match[2], filename: f.name } : null;
    })
    .filter((x): x is SimdEntry => x !== null);
}

// ---------------------------------------------------------------------------
// Extract title/status from SIMD front-matter
// ---------------------------------------------------------------------------

function extractFrontMatter(markdown: string): { title: string; status: string; authors: string } {
  const fmMatch = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return { title: "", status: "", authors: "" };
  const fm = fmMatch[1];

  const titleMatch = fm.match(/^title:\s*(.+)/m);
  const statusMatch = fm.match(/^status:\s*(.+)/m);
  const authorsMatch = fm.match(/^authors:\s*(.+)/m);

  return {
    title: titleMatch?.[1]?.replace(/^["']|["']$/g, "").trim() ?? "",
    status: statusMatch?.[1]?.trim() ?? "",
    authors: authorsMatch?.[1]?.trim() ?? "",
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

interface SimdListOptions extends OutputOptions {}

export async function simdListCommand(options: SimdListOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Fetching SIMD index from GitHub...");
    const index = await fetchSimdIndex();
    spinner?.stop();

    if (options.json) {
      outputJson(index.map((e) => ({ number: e.number, slug: e.slug })));
      return;
    }

    console.log(chalk.bold(`\nSolana Improvement Documents (${chalk.cyan(String(index.length))} proposals)\n`));

    for (const entry of index) {
      const title = entry.slug.replace(/-/g, " ");
      console.log(`  ${chalk.cyan(`SIMD-${entry.number}`)}  ${title}`);
    }

    console.log(chalk.gray(`\nUse ${chalk.white("helius simd get <number>")} to read a specific proposal.\n`));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

interface SimdGetOptions extends OutputOptions {}

export async function simdGetCommand(number: string, options: SimdGetOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    if (!/^\d+$/.test(number)) {
      if (options.json) {
        exitWithError("INVALID_INPUT", `Invalid SIMD number: "${number}". Must be numeric.`, undefined, true);
      }
      console.error(chalk.red(`Invalid SIMD number: "${number}". Must be a numeric value (e.g. 96, 0228).`));
      process.exit(ExitCode.INVALID_INPUT);
    }

    const paddedNumber = number.replace(/^0+/, "").padStart(4, "0");

    spinner?.start(`Fetching SIMD-${paddedNumber}...`);

    // Fetch index to find the filename
    const index = await fetchSimdIndex();
    const entry = index.find((e) => e.number === paddedNumber);

    if (!entry) {
      spinner?.stop();
      // Show nearby proposals as hints
      const nearby = index
        .filter((e) => {
          const n = parseInt(e.number, 10);
          const target = parseInt(paddedNumber, 10);
          return Math.abs(n - target) <= 10;
        })
        .map((e) => `  SIMD-${e.number}: ${e.slug.replace(/-/g, " ")}`)
        .join("\n");

      if (options.json) {
        exitWithError("NOT_FOUND", `SIMD-${paddedNumber} not found`, undefined, true);
      }

      console.log(chalk.yellow(`\nSIMD-${paddedNumber} not found.`));
      if (nearby) {
        console.log(chalk.gray("\nNearby proposals:"));
        console.log(nearby);
      }
      console.log();
      return;
    }

    // Fetch the raw markdown
    const url = `${SIMD_RAW_BASE}/${entry.filename}`;
    const response = await fetch(url, {
      headers: { "User-Agent": CLI_USER_AGENT },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch SIMD: HTTP ${response.status}`);
    }

    const content = await response.text();
    spinner?.stop();

    if (options.json) {
      const fm = extractFrontMatter(content);
      outputJson({
        number: entry.number,
        slug: entry.slug,
        title: fm.title,
        status: fm.status,
        authors: fm.authors,
        content,
        source: `https://github.com/${SIMD_REPO}/blob/main/proposals/${entry.filename}`,
      });
      return;
    }

    // Pretty-print the proposal
    const fm = extractFrontMatter(content);
    const title = fm.title || entry.slug.replace(/-/g, " ");

    console.log(chalk.bold(`\n${"─".repeat(60)}`));
    console.log(chalk.bold.cyan(`  SIMD-${entry.number}: ${title}`));
    if (fm.status) {
      const statusColor = fm.status.toLowerCase() === "accepted" ? chalk.green
        : fm.status.toLowerCase() === "draft" ? chalk.yellow
        : fm.status.toLowerCase() === "rejected" ? chalk.red
        : chalk.gray;
      console.log(`  ${chalk.gray("Status:")} ${statusColor(fm.status)}`);
    }
    if (fm.authors) {
      console.log(`  ${chalk.gray("Authors:")} ${fm.authors}`);
    }
    console.log(chalk.bold(`${"─".repeat(60)}\n`));

    // Print the body (strip front-matter)
    const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "").trim();
    console.log(body);

    console.log(chalk.gray(`\n${"─".repeat(60)}`));
    console.log(chalk.gray(`Source: https://github.com/${SIMD_REPO}/blob/main/proposals/${entry.filename}\n`));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}
