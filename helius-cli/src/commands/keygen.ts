import chalk from "chalk";
import fs from "fs";
import path from "path";
import os from "os";
import nacl from "tweetnacl";
import { createKeyPairSignerFromBytes } from "@solana/kit";

const DEFAULT_KEYPAIR_PATH = path.join(os.homedir(), ".helius-cli", "keypair.json");

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
  const keypair = nacl.sign.keyPair();
  
  // Save in Solana CLI format (64-byte array)
  const secretKeyArray = Array.from(keypair.secretKey);
  fs.writeFileSync(resolvedPath, JSON.stringify(secretKeyArray));

  // Get address for display
  const signer = await createKeyPairSignerFromBytes(keypair.secretKey);

  console.log(chalk.green("✓ Keypair generated"));
  console.log(`Path: ${chalk.cyan(resolvedPath)}`);
  console.log(`Address: ${chalk.cyan(signer.address)}`);
  console.log("");
  console.log(chalk.yellow("To use this wallet, fund it with:"));
  console.log(`  • ${chalk.cyan("~0.001 SOL")} for transaction fees`);
  console.log(`  • ${chalk.cyan("1 USDC")} for Helius signup`);
}

export function getDefaultKeypairPath(): string {
  return DEFAULT_KEYPAIR_PATH;
}

export function keypairExists(keypairPath?: string): boolean {
  const checkPath = keypairPath || DEFAULT_KEYPAIR_PATH;
  const resolvedPath = checkPath.replace(/^~/, os.homedir());
  return fs.existsSync(resolvedPath);
}
