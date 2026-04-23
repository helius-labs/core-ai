import chalk from "chalk";
import { setupClient, type ResolveOptions } from "../lib/helius.js";
import { formatSol } from "../lib/formatters.js";
import { outputJson, exitWithError, handleCommandError, createSpinner, withRetry, type OutputOptions, type RetryOptions } from "../lib/output.js";
import { validateAddress } from "../lib/validation.js";

interface AccountOptions extends OutputOptions, ResolveOptions, RetryOptions {}

export async function accountCommand(address: string, options: AccountOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(address);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching account info...");
    const result = await withRetry(() => helius.raw.getAccountInfo(address, { encoding: "jsonParsed" }), options, spinner) as any;
    spinner?.stop();

    if (options.json) {
      outputJson({ address, ...result.value });
      return;
    }

    if (!result.value) {
      console.log(chalk.yellow(`\nAccount ${address} not found (may not exist or have zero balance).`));
      return;
    }

    const info = result.value;
    console.log(chalk.bold(`\nAccount: ${chalk.cyan(address)}\n`));
    console.log(`  ${chalk.gray("Owner:")}       ${info.owner || "N/A"}`);
    console.log(`  ${chalk.gray("Lamports:")}    ${formatSol(Number(info.lamports))}`);
    console.log(`  ${chalk.gray("Data size:")}   ${info.space ?? "N/A"} bytes`);
    console.log(`  ${chalk.gray("Executable:")}  ${info.executable ? chalk.green("yes") : "no"}`);
    console.log(`  ${chalk.gray("Rent epoch:")}  ${info.rentEpoch ?? "N/A"}`);
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}
