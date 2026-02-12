import chalk from "chalk";
import ora from "ora";
import { resolveApiKey, resolveNetwork, getClient, type ResolveOptions } from "../lib/helius.js";
import { formatSol, formatTimestamp, formatAddress } from "../lib/formatters.js";
import { outputJson, ExitCode, type OutputOptions } from "../lib/output.js";

interface TxOptions extends OutputOptions, ResolveOptions {}

export async function txParseCommand(signatures: string[], options: TxOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start(`Parsing ${signatures.length} transaction(s)...`);
    const result = await helius.enhanced.getTransactions({ transactions: signatures });
    spinner?.stop();

    if (options.json) {
      outputJson(result);
      return;
    }

    if (!result || (Array.isArray(result) && result.length === 0)) {
      console.log(chalk.yellow("\nNo transactions found."));
      return;
    }

    const txs = Array.isArray(result) ? result : [result];
    for (const tx of txs) {
      console.log(chalk.bold(`\n${"─".repeat(60)}`));
      console.log(`${chalk.gray("Signature:")}    ${chalk.cyan(tx.signature || "N/A")}`);
      console.log(`${chalk.gray("Type:")}         ${chalk.yellow(tx.type || "UNKNOWN")}`);
      console.log(`${chalk.gray("Source:")}       ${tx.source || "N/A"}`);
      console.log(`${chalk.gray("Timestamp:")}    ${tx.timestamp ? formatTimestamp(tx.timestamp) : "N/A"}`);
      console.log(`${chalk.gray("Fee:")}          ${tx.fee != null ? formatSol(tx.fee) : "N/A"}`);
      if (tx.description) {
        console.log(`${chalk.gray("Description:")} ${tx.description}`);
      }
      if (tx.nativeTransfers?.length) {
        console.log(chalk.bold("\n  Native Transfers:"));
        for (const t of tx.nativeTransfers) {
          console.log(`    ${t.fromUserAccount || "?"} → ${t.toUserAccount || "?"}: ${formatSol(t.amount)}`);
        }
      }
      if (tx.tokenTransfers?.length) {
        console.log(chalk.bold("\n  Token Transfers:"));
        for (const t of tx.tokenTransfers) {
          console.log(`    ${t.fromUserAccount || "?"} → ${t.toUserAccount || "?"}: ${t.tokenAmount} ${t.mint || ""}`);
        }
      }
    }
    console.log();
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function txHistoryCommand(address: string, options: TxOptions & { limit?: string; before?: string; type?: string } = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start("Fetching transaction history...");
    const params: any = { address };
    if (options.limit) params.limit = parseInt(options.limit, 10);
    if (options.before) params.before = options.before;
    if (options.type) params.type = options.type;
    const result = await helius.enhanced.getTransactionsByAddress(params);
    spinner?.stop();

    if (options.json) {
      outputJson(result);
      return;
    }

    const txs = Array.isArray(result) ? result : [];
    if (txs.length === 0) {
      console.log(chalk.yellow("\nNo transactions found."));
      return;
    }

    console.log(chalk.bold(`\nTransaction history for ${chalk.cyan(address)}:\n`));
    for (const tx of txs) {
      const sig = tx.signature || "N/A";
      const shortSig = formatAddress(sig);
      const time = tx.timestamp ? formatTimestamp(tx.timestamp) : "N/A";
      const type = tx.type || "UNKNOWN";
      console.log(`  ${chalk.cyan(shortSig)}  ${chalk.yellow(type.padEnd(16))}  ${chalk.gray(time)}`);
      if (tx.description) {
        console.log(`    ${chalk.gray(tx.description)}`);
      }
    }
    console.log(chalk.gray(`\n  ${txs.length} transaction(s) shown`));
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function txFeesCommand(options: TxOptions & { accounts?: string } = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start("Fetching priority fee estimate...");
    const params: any = { options: { includeAllPriorityFeeLevels: true } };
    if (options.accounts) {
      params.accountKeys = options.accounts.split(",").map((s: string) => s.trim());
    }
    const result = await helius.getPriorityFeeEstimate(params);
    spinner?.stop();

    if (options.json) {
      outputJson(result);
      return;
    }

    console.log(chalk.bold("\nPriority Fee Estimates (microlamports per CU):\n"));
    const levels = (result as any)?.priorityFeeLevels;
    if (levels) {
      for (const [level, fee] of Object.entries(levels)) {
        console.log(`  ${chalk.gray(level.padEnd(12))} ${chalk.cyan(String(fee))}`);
      }
    } else {
      console.log(chalk.gray("  No fee data available."));
    }
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}
