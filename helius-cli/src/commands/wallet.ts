import chalk from "chalk";
import ora from "ora";
import { resolveApiKey, restRequest, type ResolveOptions } from "../lib/helius.js";
import { formatAddress, formatTable, formatEnumLabel, type TableColumn } from "../lib/formatters.js";
import { outputJson, classifyError, type OutputOptions } from "../lib/output.js";

interface WalletOptions extends OutputOptions, ResolveOptions {}

export async function walletIdentityCommand(address: string, options: WalletOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    spinner?.start("Looking up wallet identity...");
    const result = await restRequest(`/v1/wallet/${address}/identity`, apiKey);
    spinner?.stop();
    if (options.json) { outputJson(result); return; }
    if (!result || (!result.name && !result.type)) {
      console.log(chalk.yellow(`\nNo known identity for ${address}`));
      return;
    }
    console.log(chalk.bold(`\nWallet Identity for ${chalk.cyan(address)}:\n`));
    if (result.name) console.log(`  ${chalk.gray("Name:")}     ${chalk.green(result.name)}`);
    if (result.type) console.log(`  ${chalk.gray("Type:")}     ${formatEnumLabel(result.type)}`);
    if (result.category) console.log(`  ${chalk.gray("Category:")} ${result.category}`);
    if (result.tags?.length) console.log(`  ${chalk.gray("Tags:")}     ${result.tags.join(", ")}`);
  } catch (error) {
    const { exitCode, errorCode, retryable } = classifyError(error);
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      outputJson({ error: errorCode, message, retryable });
    } else {
      const hint = retryable ? chalk.gray(" (transient — safe to retry)") : "";
      spinner?.fail(`${message}${hint}`);
    }
    process.exit(exitCode);
  }
}

export async function walletIdentityBatchCommand(addresses: string[], options: WalletOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    spinner?.start(`Looking up ${addresses.length} wallet(s)...`);
    const result = await restRequest("/v1/wallet/batch-identity", apiKey, {
      method: "POST",
      body: JSON.stringify({ addresses }),
    });
    spinner?.stop();
    if (options.json) { outputJson(result); return; }
    const identities = Array.isArray(result) ? result : [];
    console.log(chalk.bold(`\nWallet Identities (${identities.length}):\n`));
    for (const id of identities) {
      if (id.name || id.type) {
        console.log(`  ${chalk.cyan(id.address || "?")} - ${chalk.green(id.name || "Unknown")} (${id.type ? formatEnumLabel(id.type) : "N/A"})`);
      }
    }
    const unknown = identities.filter((i: any) => !i.name && !i.type);
    if (unknown.length) {
      console.log(chalk.gray(`\n  ${unknown.length} wallet(s) have no known identity`));
    }
  } catch (error) {
    const { exitCode, errorCode, retryable } = classifyError(error);
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      outputJson({ error: errorCode, message, retryable });
    } else {
      const hint = retryable ? chalk.gray(" (transient — safe to retry)") : "";
      spinner?.fail(`${message}${hint}`);
    }
    process.exit(exitCode);
  }
}

export async function walletBalancesCommand(address: string, options: WalletOptions & { showNfts?: boolean } = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const params = new URLSearchParams();
    if (options.showNfts) params.set("showNfts", "true");
    const qs = params.toString();
    spinner?.start("Fetching wallet balances...");
    const result = await restRequest(`/v1/wallet/${address}/balances${qs ? "?" + qs : ""}`, apiKey);
    spinner?.stop();
    if (options.json) { outputJson(result); return; }
    console.log(chalk.bold(`\nBalances for ${chalk.cyan(address)}:\n`));
    const balances = result?.balances || [];
    const solEntry = balances.find((b: any) => b.mint === "So11111111111111111111111111111111111111111");
    if (solEntry) {
      console.log(`  ${chalk.gray("SOL:")} ${chalk.green(solEntry.balance + " SOL")}`);
      if (solEntry.usdValue != null) {
        console.log(`       ${chalk.gray("$" + solEntry.usdValue.toFixed(2) + " USD")}`);
      }
    }
    const tokens = balances.filter((b: any) => b.mint !== "So11111111111111111111111111111111111111111");
    if (tokens.length > 0) {
      console.log(chalk.bold("\n  Tokens:"));
      const columns: TableColumn[] = [
        { key: "symbol", label: "Symbol", width: 10 },
        { key: "amount", label: "Amount", align: "right", width: 20 },
        { key: "usd", label: "USD", align: "right", width: 12 },
        { key: "mint", label: "Mint", width: 14, format: (v: string) => v ? formatAddress(v) : "" },
      ];
      const rows = tokens.map((t: any) => ({
        symbol: t.symbol || "???",
        amount: t.balance?.toString() || "0",
        usd: t.usdValue != null ? "$" + t.usdValue.toFixed(2) : "N/A",
        mint: t.mint || "",
      }));
      console.log(formatTable(rows, columns));
    }
  } catch (error) {
    const { exitCode, errorCode, retryable } = classifyError(error);
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      outputJson({ error: errorCode, message, retryable });
    } else {
      const hint = retryable ? chalk.gray(" (transient — safe to retry)") : "";
      spinner?.fail(`${message}${hint}`);
    }
    process.exit(exitCode);
  }
}

export async function walletHistoryCommand(address: string, options: WalletOptions & { limit?: string; type?: string; before?: string } = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", options.limit);
    if (options.type) params.set("type", options.type);
    if (options.before) params.set("before", options.before);
    const qs = params.toString();
    spinner?.start("Fetching wallet history...");
    const result = await restRequest(`/v1/wallet/${address}/history${qs ? "?" + qs : ""}`, apiKey);
    spinner?.stop();
    if (options.json) { outputJson(result); return; }
    const txs = result?.data || result?.transactions || result || [];
    const items = Array.isArray(txs) ? txs : [];
    console.log(chalk.bold(`\nWallet History for ${chalk.cyan(address)}:\n`));
    if (items.length === 0) {
      console.log(chalk.yellow("  No transactions found."));
      return;
    }
    for (const tx of items) {
      const sig = tx.signature || "N/A";
      const shortSig = formatAddress(sig);
      console.log(`  ${chalk.cyan(shortSig)}  ${chalk.yellow((tx.type ? formatEnumLabel(tx.type) : "Unknown").padEnd(16))}  ${tx.description || ""}`);
    }
    console.log(chalk.gray(`\n  ${items.length} transaction(s) shown`));
    if (result?.pagination?.nextCursor) {
      console.log(chalk.gray(`  Next cursor: ${result.pagination.nextCursor}`));
    }
  } catch (error) {
    const { exitCode, errorCode, retryable } = classifyError(error);
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      outputJson({ error: errorCode, message, retryable });
    } else {
      const hint = retryable ? chalk.gray(" (transient — safe to retry)") : "";
      spinner?.fail(`${message}${hint}`);
    }
    process.exit(exitCode);
  }
}

export async function walletTransfersCommand(address: string, options: WalletOptions & { limit?: string; cursor?: string } = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", options.limit);
    if (options.cursor) params.set("cursor", options.cursor);
    const qs = params.toString();
    spinner?.start("Fetching wallet transfers...");
    const result = await restRequest(`/v1/wallet/${address}/transfers${qs ? "?" + qs : ""}`, apiKey);
    spinner?.stop();
    if (options.json) { outputJson(result); return; }
    const transfers = result?.data || result?.transfers || result || [];
    const items = Array.isArray(transfers) ? transfers : [];
    console.log(chalk.bold(`\nTransfers for ${chalk.cyan(address)}:\n`));
    if (items.length === 0) {
      console.log(chalk.yellow("  No transfers found."));
      return;
    }
    for (const t of items) {
      const dir = t.direction === "in" ? chalk.green("IN ") : chalk.red("OUT");
      console.log(`  ${dir}  ${t.counterparty || "?"} - ${t.amount || "?"} ${t.symbol || ""}`);
    }
    console.log(chalk.gray(`\n  ${items.length} transfer(s) shown`));
    if (result?.pagination?.nextCursor) {
      console.log(chalk.gray(`  Next cursor: ${result.pagination.nextCursor}`));
    }
  } catch (error) {
    const { exitCode, errorCode, retryable } = classifyError(error);
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      outputJson({ error: errorCode, message, retryable });
    } else {
      const hint = retryable ? chalk.gray(" (transient — safe to retry)") : "";
      spinner?.fail(`${message}${hint}`);
    }
    process.exit(exitCode);
  }
}

export async function walletFundedByCommand(address: string, options: WalletOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    spinner?.start("Finding funding source...");
    const result = await restRequest(`/v1/wallet/${address}/funded-by`, apiKey);
    spinner?.stop();
    if (options.json) { outputJson(result); return; }
    console.log(chalk.bold(`\nFunding Source for ${chalk.cyan(address)}:\n`));
    if (!result || (!result.funderAddress && !result.funder)) {
      console.log(chalk.yellow("  No funding source found."));
      return;
    }
    const funder = result.funderAddress || result.funder || "Unknown";
    console.log(`  ${chalk.gray("Funder:")}      ${chalk.cyan(funder)}`);
    if (result.funderName) console.log(`  ${chalk.gray("Name:")}        ${chalk.green(result.funderName)}`);
    if (result.funderType) console.log(`  ${chalk.gray("Type:")}        ${formatEnumLabel(result.funderType)}`);
    if (result.signature) console.log(`  ${chalk.gray("Signature:")}   ${result.signature}`);
    if (result.amount != null) console.log(`  ${chalk.gray("Amount:")}      ${result.amount} SOL`);
  } catch (error) {
    const { exitCode, errorCode, retryable } = classifyError(error);
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      outputJson({ error: errorCode, message, retryable });
    } else {
      const hint = retryable ? chalk.gray(" (transient — safe to retry)") : "";
      spinner?.fail(`${message}${hint}`);
    }
    process.exit(exitCode);
  }
}
