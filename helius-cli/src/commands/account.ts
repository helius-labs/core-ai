import chalk from "chalk";
import ora from "ora";
import { resolveApiKey, resolveNetwork, getClient, type ResolveOptions } from "../lib/helius.js";
import { formatSol } from "../lib/formatters.js";
import { outputJson, handleCommandError, type OutputOptions } from "../lib/output.js";

interface AccountOptions extends OutputOptions, ResolveOptions {}

export async function accountCommand(address: string, options: AccountOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start("Fetching account info...");
    const result = await helius.raw.getAccountInfo(address, { encoding: "jsonParsed" });
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
