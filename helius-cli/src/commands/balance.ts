import chalk from "chalk";
import { setupClient, resolveNetwork, type ResolveOptions } from "../lib/helius.js";
import { formatSol, formatAddress, formatTokenAmount, formatTable, type TableColumn } from "../lib/formatters.js";
import { outputJson, exitWithError, handleCommandError, createSpinner, withRetry, type OutputOptions, type RetryOptions } from "../lib/output.js";
import { validateAddress } from "../lib/validation.js";

interface BalanceOptions extends OutputOptions, ResolveOptions, RetryOptions {}

export async function balanceCommand(address: string, options: BalanceOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(address);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching balance...");
    const result = await withRetry(() => helius.raw.getBalance(address), options, spinner) as any;
    spinner?.stop();

    const lamports = Number(result.value);
    if (options.json) {
      outputJson({ address, lamports, sol: lamports / 1e9, network: resolveNetwork(options) });
      return;
    }

    console.log(chalk.bold(`\nBalance for ${chalk.cyan(address)}:\n`));
    console.log(`  ${chalk.green(formatSol(lamports))}`);
    console.log(`  ${chalk.gray(`(${lamports.toLocaleString()} lamports)`)}`);
    console.log(`  ${chalk.gray(`Network: ${resolveNetwork(options)}`)}`);
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function tokensCommand(address: string, options: BalanceOptions & { limit?: string } = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(address);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching token balances...");
    const limit = options.limit ? parseInt(options.limit, 10) : 100;
    const result = await withRetry(() => helius.getAssetsByOwner({ ownerAddress: address, page: 1, limit, displayOptions: { showFungible: true } }), options, spinner) as any;
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
    handleCommandError(error, options, spinner);
  }
}

export async function tokenHoldersCommand(mint: string, options: BalanceOptions & { limit?: string } = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(mint);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching token holders...");
    const limit = options.limit ? parseInt(options.limit, 10) : 20;
    const result = await withRetry(() => helius.getTokenAccounts({ mint, page: 1, limit }), options, spinner) as any;
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
    handleCommandError(error, options, spinner);
  }
}
