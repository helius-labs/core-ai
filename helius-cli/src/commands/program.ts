import chalk from "chalk";
import { setupClient, type ResolveOptions } from "../lib/helius.js";
import { formatAddress, formatTable, type TableColumn } from "../lib/formatters.js";
import { outputJson, exitWithError, handleCommandError, createSpinner, withRetry, type OutputOptions, type RetryOptions } from "../lib/output.js";
import { validateAddress } from "../lib/validation.js";

interface ProgramOptions extends OutputOptions, ResolveOptions, RetryOptions {}

export async function programAccountsCommand(programId: string, options: ProgramOptions & { dataSize?: string; limit?: string } = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(programId);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching program accounts...");
    const config: any = {};
    if (options.dataSize) config.filters = [{ dataSize: parseInt(options.dataSize, 10) }];
    if (options.limit) config.limit = parseInt(options.limit, 10);
    const result = await withRetry(() => helius.getProgramAccountsV2([programId, config]), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    const accounts = (result as any)?.accounts || result || [];
    const items = Array.isArray(accounts) ? accounts : [];
    console.log(chalk.bold(`\nProgram accounts for ${chalk.cyan(programId)}:\n`));
    if (items.length === 0) {
      console.log(chalk.yellow("  No accounts found."));
      return;
    }
    const columns: TableColumn[] = [
      { key: "address", label: "Address", width: 14, format: (v: string) => v ? formatAddress(v) : "" },
      { key: "lamports", label: "Lamports", align: "right", width: 16 },
      { key: "space", label: "Space", align: "right", width: 10 },
    ];
    const rows = items.slice(0, 50).map((a: any) => ({
      address: a.pubkey || a.address || "",
      lamports: (a.account?.lamports ?? a.lamports ?? 0).toString(),
      space: (a.account?.space ?? a.space ?? "N/A").toString(),
    }));
    console.log(formatTable(rows, columns));
    console.log(chalk.gray(`\n  ${items.length} account(s) shown`));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function programAccountsAllCommand(programId: string, options: ProgramOptions & { dataSize?: string } = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(programId);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching all program accounts (auto-paginating)...");
    const config: any = {};
    if (options.dataSize) config.filters = [{ dataSize: parseInt(options.dataSize, 10) }];
    const result = await withRetry(() => helius.getAllProgramAccounts([programId, config]), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    const items = Array.isArray(result) ? result : [];
    console.log(chalk.bold(`\nAll program accounts for ${chalk.cyan(programId)}:\n`));
    console.log(`  ${chalk.gray("Total accounts:")} ${chalk.cyan(items.length.toLocaleString())}`);
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function programTokenAccountsCommand(owner: string, options: ProgramOptions & { limit?: string } = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(owner);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching token accounts by owner...");
    const config: any = { encoding: "base64" };
    if (options.limit) config.limit = parseInt(options.limit, 10);
    const filter = { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" };
    const result = await withRetry(() => helius.getTokenAccountsByOwnerV2([owner, filter, config]), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    // Response may have context wrapper or direct value
    const value = (result as any)?.value || result || {};
    const accounts = value?.accounts || [];
    const items = Array.isArray(accounts) ? accounts : [];
    console.log(chalk.bold(`\nToken accounts for ${chalk.cyan(owner)}:\n`));
    if (items.length === 0) {
      console.log(chalk.yellow("  No token accounts found."));
      return;
    }
    const columns: TableColumn[] = [
      { key: "address", label: "Account", width: 14, format: (v: string) => v ? formatAddress(v) : "" },
      { key: "lamports", label: "Lamports", align: "right", width: 14 },
      { key: "space", label: "Space", align: "right", width: 10 },
    ];
    const rows = items.map((a: any) => ({
      address: a.pubkey || "",
      lamports: (a.account?.lamports ?? 0).toString(),
      space: (a.account?.space ?? "N/A").toString(),
    }));
    console.log(formatTable(rows, columns));
    console.log(chalk.gray(`\n  ${items.length} account(s) shown`));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}
