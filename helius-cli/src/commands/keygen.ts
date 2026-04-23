import chalk from "chalk";
import fs from "fs";
import path from "path";
import os from "os";
import { generateKeypair } from "helius-sdk/auth/generateKeypair";
import { getAddress } from "helius-sdk/auth/getAddress";
import { loadKeypair } from "helius-sdk/auth/loadKeypair";
import { PLAN_CATALOG } from "helius-sdk/auth/planCatalog";
import { outputJson, createSpinner, exitWithError, handleCommandError, type OutputOptions } from "../lib/output.js";

const DEFAULT_KEYPAIR_PATH = path.join(os.homedir(), ".helius", "keypair.json");

interface KeygenOptions extends OutputOptions {
  output?: string;
  force?: boolean;
  qr?: boolean;
}

export async function keygenCommand(options: KeygenOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const outputPath = options.output || DEFAULT_KEYPAIR_PATH;
    const resolvedPath = outputPath.replace(/^~/, os.homedir());

    // Check if file exists
    if (fs.existsSync(resolvedPath) && !options.force) {
      exitWithError(
        "INVALID_INPUT",
        `Keypair already exists at ${resolvedPath}. Use --force to overwrite.`,
        undefined,
        !!options.json,
      );
    }

    // Ensure directory exists
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Generate keypair
    spinner?.start("Generating keypair...");
    const keypair = await generateKeypair();

    // Save in Solana CLI format (64-byte array)
    const secretKeyArray = Array.from(keypair.secretKey);
    fs.writeFileSync(resolvedPath, JSON.stringify(secretKeyArray));
    fs.chmodSync(resolvedPath, 0o600);

    // Get address for display
    const walletKeypair = loadKeypair(keypair.secretKey);
    const address = await getAddress(walletKeypair);
    spinner?.succeed("Keypair generated");

    if (options.json) {
      outputJson({ path: resolvedPath, address });
      return;
    }

    console.log(`  Path:    ${chalk.cyan(resolvedPath)}`);
    console.log(`  Address: ${chalk.cyan(address)}`);
    console.log("");
    console.log(chalk.yellow("To use this wallet, fund it with USDC for your chosen plan:"));
    console.log(`      ${"agent".padEnd(15)}${chalk.cyan("$10")} (one-time, 1M starting credits)`);
    for (const [key, plan] of Object.entries(PLAN_CATALOG)) {
      const price = `$${plan.monthlyPrice / 100}`;
      console.log(`      ${key.padEnd(15)}${chalk.cyan(price)}/mo`);
    }
    console.log(chalk.gray("  SOL fees are sponsored by Helius — only USDC is required."));
    console.log("");
    console.log(`Then run: ${chalk.green("helius signup")}`);
    if (options.qr !== false) {
      console.log(
        chalk.gray(
          "  Signup will show a QR code you can scan to fund the wallet with the exact USDC needed.",
        ),
      );
    }
    console.log(
      chalk.gray(
        "  Options: --plan <plan> --email <email> --first-name <name> --last-name <name> --coupon <code>",
      ),
    );
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export function getDefaultKeypairPath(): string {
  return DEFAULT_KEYPAIR_PATH;
}

export function keypairExists(keypairPath?: string): boolean {
  const checkPath = keypairPath || DEFAULT_KEYPAIR_PATH;
  const resolvedPath = checkPath.replace(/^~/, os.homedir());
  return fs.existsSync(resolvedPath);
}
