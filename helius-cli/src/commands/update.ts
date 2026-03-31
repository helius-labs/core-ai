import { execSync } from "child_process";
import chalk from "chalk";
import { VERSION } from "../constants.js";
import { outputJson, createSpinner, type OutputOptions } from "../lib/output.js";

interface UpdateOptions extends OutputOptions {
  check?: boolean;
}

const NPM_REGISTRY_URL = "https://registry.npmjs.org/helius-cli/latest";

async function fetchLatestVersion(): Promise<string> {
  const res = await fetch(NPM_REGISTRY_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch latest version from npm (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { version: string };
  return data.version;
}

/**
 * Compare two semver strings. Returns:
 *   -1 if a < b, 0 if equal, 1 if a > b
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

/**
 * Detect which package manager was used to install the CLI globally,
 * based on the resolved path of the running binary.
 */
function detectPackageManager(): "pnpm" | "volta" | "bun" | "npm" {
  const execPath = process.argv[1] || "";
  // Normalize to forward slashes for consistent matching
  const normalized = execPath.replace(/\\/g, "/");
  if (/[/]\.?pnpm[/]/.test(normalized)) return "pnpm";
  if (/[/]\.?volta[/]/.test(normalized)) return "volta";
  if (/[/]\.?bun[/]/.test(normalized)) return "bun";
  return "npm";
}

function getUpdateCommand(pm: string): string {
  switch (pm) {
    case "pnpm":  return "pnpm add -g helius-cli@latest";
    case "volta":  return "volta install helius-cli@latest";
    case "bun":    return "bun add -g helius-cli@latest";
    default:       return "npm install -g helius-cli@latest";
  }
}

export async function updateCommand(options: UpdateOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    spinner?.start("Checking for updates...");
    const latest = await fetchLatestVersion();
    const cmp = compareSemver(VERSION, latest);

    if (cmp >= 0) {
      spinner?.stop();
      if (options.json) {
        outputJson({ current: VERSION, latest, upToDate: true });
      } else {
        console.log(chalk.green(`\n  helius-cli is up to date (v${VERSION})`));
      }
      return;
    }

    // Update available
    if (options.check) {
      spinner?.stop();
      if (options.json) {
        outputJson({ current: VERSION, latest, upToDate: false });
      } else {
        console.log(`\n  Current: ${chalk.gray("v" + VERSION)}`);
        console.log(`  Latest:  ${chalk.green("v" + latest)}`);
        console.log(`\n  Run ${chalk.cyan("helius update")} to install the latest version.`);
      }
      return;
    }

    // Perform the update
    const pm = detectPackageManager();
    const cmd = getUpdateCommand(pm);
    spinner?.start(`Updating v${VERSION} → v${latest} via ${pm}...`);

    try {
      execSync(cmd, { stdio: "pipe" });
    } catch (execError: any) {
      const stderr = execError?.stderr?.toString() || "";
      if (stderr.includes("EACCES") || stderr.includes("permission denied")) {
        spinner?.fail("Permission denied");
        if (options.json) {
          outputJson({
            error: "PERMISSION_DENIED",
            message: `Permission denied. Try: sudo ${cmd}`,
            retryable: true,
          });
        } else {
          console.error(chalk.yellow(`\n  Hint: Run with elevated permissions: ${chalk.cyan("sudo " + cmd)}`));
        }
        process.exit(1);
      }
      throw execError;
    }

    spinner?.succeed(`Updated helius-cli v${VERSION} → v${latest}`);

    if (options.json) {
      outputJson({ previous: VERSION, current: latest, updated: true, packageManager: pm });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spinner?.fail(message);
    if (options.json) {
      outputJson({ error: "UPDATE_FAILED", message, retryable: true });
    }
    process.exit(1);
  }
}
