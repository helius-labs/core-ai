import chalk from "chalk";
import ora from "ora";
import { resolveApiKey, resolveNetwork, getClient, type ResolveOptions } from "../lib/helius.js";
import { formatSol, formatAddress, formatTokenAmount, formatTable, type TableColumn } from "../lib/formatters.js";
import { outputJson, ExitCode, type OutputOptions } from "../lib/output.js";

interface BalanceOptions extends OutputOptions, ResolveOptions {}

export async function balanceCommand(address: string, options: BalanceOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start("Fetching balance...");
    const result = await helius.raw.getBalance(address);
    spinner?.stop();

    const lamports = Number(result.value);
    if (options.json) {
      outputJson({ address, lamports, sol: lamports / 1e9, network });
      return;
    }

    console.log(chalk.bold(`\nBalance for ${chalk.cyan(address)}:\n`));
    console.log(`  ${chalk.green(formatSol(lamports))}`);
    console.log(`  ${chalk.gray(`(${lamports.toLocaleString()} lamports)`)}`);
    console.log(`  ${chalk.gray(`Network: ${network}`)}`);
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function tokensCommand(address: string, options: BalanceOptions & { limit?: string } = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start("Fetching token balances...");
    const limit = options.limit ? parseInt(options.limit, 10) : 100;
    const result = await helius.getAssetsByOwner({ ownerAddress: address, page: 1, limit, displayOptions: { showFungible: true } });
    spinner?.stop();

    // Filter to fungible tokens
    const fungibles = (result.items || []).filter(
      (a: any) => a.interface === "FungibleToken" || a.interface === "FungibleAsset"
    );

    if (options.json) {
      outputJson({ address, tokens: fungibles, total: fungibles.length });
      return;
    }

    if (fungibles.length === 0) {
      console.log(chalk.yellow("\nNo fungible tokens found."));
      return;
    }

    console.log(chalk.bold(`\nTokens for ${chalk.cyan(address)}:\n`));
    const columns: TableColumn[] = [
      { key: "name", label: "Token", width: 20 },
      { key: "symbol", label: "Symbol", width: 10 },
      { key: "balance", label: "Balance", align: "right", width: 20 },
      { key: "mint", label: "Mint", width: 14, format: (v: string) => v ? formatAddress(v) : "" },
    ];

    const rows = fungibles.map((t: any) => {
      const info = t.token_info || {};
      const balance = info.balance != null ? formatTokenAmount(info.balance, info.decimals || 0) : "N/A";
      return {
        name: t.content?.metadata?.name || "Unknown",
        symbol: info.symbol || t.content?.metadata?.symbol || "???",
        balance,
        mint: t.id || "",
      };
    });

    console.log(formatTable(rows, columns));
    console.log(chalk.gray(`\n  ${fungibles.length} token(s) found`));
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function tokenHoldersCommand(mint: string, options: BalanceOptions & { limit?: string } = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start("Fetching token holders...");
    const limit = options.limit ? parseInt(options.limit, 10) : 20;
    const result = await helius.getTokenAccounts({ mint, page: 1, limit });
    spinner?.stop();

    const accounts = result.token_accounts || [];

    if (options.json) {
      outputJson({ mint, holders: accounts, total: accounts.length });
      return;
    }

    if (accounts.length === 0) {
      console.log(chalk.yellow("\nNo token holders found."));
      return;
    }

    console.log(chalk.bold(`\nTop holders for ${chalk.cyan(mint)}:\n`));
    const columns: TableColumn[] = [
      { key: "owner", label: "Owner", width: 14, format: (v: string) => v ? formatAddress(v) : "" },
      { key: "amount", label: "Amount", align: "right", width: 24 },
      { key: "account", label: "Token Account", width: 14, format: (v: string) => v ? formatAddress(v) : "" },
    ];

    const rows = accounts.map((a: any) => ({
      owner: a.owner || "",
      amount: a.amount?.toString() || "0",
      account: a.address || "",
    }));

    console.log(formatTable(rows, columns));
    console.log(chalk.gray(`\n  ${accounts.length} holder(s) shown`));
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}
