import chalk from "chalk";
import fs from "fs";
import path from "path";
import os from "os";
import { generateKeypair } from "helius-sdk/auth/generateKeypair";
import { getAddress } from "helius-sdk/auth/getAddress";
import { loadKeypair } from "helius-sdk/auth/loadKeypair";
import { PLAN_CATALOG } from "helius-sdk/auth/planCatalog";

const DEFAULT_KEYPAIR_PATH = path.join(os.homedir(), ".helius", "keypair.json");

interface KeygenOptions {
  output?: string;
  force?: boolean;
}

export async function keygenCommand(options: KeygenOptions): Promise<void> {
  const outputPath = options.output || DEFAULT_KEYPAIR_PATH;
  const resolvedPath = outputPath.replace(/^~/, os.homedir());

  // Check if file exists
  if (fs.existsSync(resolvedPath) && !options.force) {
    console.error(chalk.red(`Error: Keypair already exists at ${resolvedPath}`));
    console.error(chalk.gray("Use --force to overwrite"));
    process.exit(1);
  }

  // Ensure directory exists
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Generate keypair
  const keypair = await generateKeypair();

  // Save in Solana CLI format (64-byte array)
  const secretKeyArray = Array.from(keypair.secretKey);
  fs.writeFileSync(resolvedPath, JSON.stringify(secretKeyArray));
  fs.chmodSync(resolvedPath, 0o600);

  // Get address for display
  const walletKeypair = loadKeypair(keypair.secretKey);
  const address = await getAddress(walletKeypair);

  console.log(chalk.green("✓ Keypair generated"));
  console.log(`Path: ${chalk.cyan(resolvedPath)}`);
  console.log(`Address: ${chalk.cyan(address)}`);
  console.log("");
  console.log(chalk.yellow("To use this wallet, fund it with:"));
  console.log(`  • ${chalk.cyan("~0.01 SOL")} for transaction fees`);
  console.log(`  • USDC for your chosen plan:`);
  console.log(`      ${"basic".padEnd(15)}${chalk.cyan("$1")} (one-time)`);
  for (const [key, plan] of Object.entries(PLAN_CATALOG)) {
    const price = `$${plan.monthlyPrice / 100}`;
    console.log(`      ${key.padEnd(15)}${chalk.cyan(price)}/mo`);
  }
  console.log("");
  console.log(`Then run: ${chalk.green("helius signup")}`);
  console.log(
    chalk.gray(
      "  Options: --plan <plan> --email <email> --first-name <name> --last-name <name> --coupon <code>",
    ),
  );
}

export function getDefaultKeypairPath(): string {
  return DEFAULT_KEYPAIR_PATH;
}

export function keypairExists(keypairPath?: string): boolean {
  const checkPath = keypairPath || DEFAULT_KEYPAIR_PATH;
  const resolvedPath = checkPath.replace(/^~/, os.homedir());
  return fs.existsSync(resolvedPath);
}
