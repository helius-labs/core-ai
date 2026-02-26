import chalk from "chalk";
import ora from "ora";
import { resolveApiKey, resolveNetwork, getClient, type ResolveOptions } from "../lib/helius.js";
import { formatAddress, formatTable, type TableColumn } from "../lib/formatters.js";
import { outputJson, classifyError, type OutputOptions } from "../lib/output.js";

interface AssetOptions extends OutputOptions, ResolveOptions {}

async function setup(spinner: ReturnType<typeof ora> | null, options: AssetOptions, message: string) {
  spinner?.start("Resolving API key...");
  const apiKey = await resolveApiKey(options);
  const network = resolveNetwork(options);
  const helius = getClient(apiKey, network);
  spinner?.start(message);
  return helius;
}

function printAssetSummary(asset: any): void {
  console.log(`  ${chalk.gray("ID:")}           ${chalk.cyan(asset.id)}`);
  console.log(`  ${chalk.gray("Name:")}         ${asset.content?.metadata?.name || "N/A"}`);
  console.log(`  ${chalk.gray("Symbol:")}       ${asset.content?.metadata?.symbol || "N/A"}`);
  console.log(`  ${chalk.gray("Interface:")}    ${asset.interface || "N/A"}`);
  console.log(`  ${chalk.gray("Owner:")}        ${asset.ownership?.owner || "N/A"}`);
  console.log(`  ${chalk.gray("Compressed:")}   ${asset.compression?.compressed ? chalk.green("yes") : "no"}`);
  console.log(`  ${chalk.gray("Mutable:")}      ${asset.mutable ? "yes" : "no"}`);
  console.log(`  ${chalk.gray("Burnt:")}        ${asset.burnt ? chalk.red("yes") : "no"}`);
  if (asset.royalty) {
    console.log(`  ${chalk.gray("Royalty:")}      ${(asset.royalty.percent * 100).toFixed(1)}%`);
  }
  if (asset.creators?.length) {
    console.log(`  ${chalk.gray("Creators:")}    ${asset.creators.map((c: any) => c.address).join(", ")}`);
  }
}

function printAssetList(items: any[], label: string): void {
  if (items.length === 0) {
    console.log(chalk.yellow(`\nNo ${label} found.`));
    return;
  }
  const columns: TableColumn[] = [
    { key: "name", label: "Name", width: 24 },
    { key: "type", label: "Type", width: 16 },
    { key: "id", label: "Mint", width: 14, format: (v: string) => v ? formatAddress(v) : "" },
  ];
  const rows = items.map((a: any) => ({
    name: a.content?.metadata?.name || "Unknown",
    type: a.interface || "N/A",
    id: a.id || "",
  }));
  console.log(formatTable(rows, columns));
  console.log(chalk.gray(`\n  ${items.length} asset(s) shown`));
}

export async function assetGetCommand(id: string, options: AssetOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching asset...");
    const result = await helius.getAsset({ id });
    spinner?.stop();
    if (options.json) { outputJson(result); return; }
    console.log(chalk.bold("\nAsset Details:\n"));
    printAssetSummary(result);
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

export async function assetBatchCommand(ids: string[], options: AssetOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, `Fetching ${ids.length} asset(s)...`);
    const result = await helius.getAssetBatch({ ids });
    spinner?.stop();
    if (options.json) { outputJson(result); return; }
    const items = Array.isArray(result) ? result : [];
    console.log(chalk.bold(`\nBatch Assets (${items.length}):\n`));
    printAssetList(items, "assets");
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

export async function assetOwnerCommand(address: string, options: AssetOptions & { page?: string; limit?: string } = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching assets by owner...");
    const result = await helius.getAssetsByOwner({
      ownerAddress: address,
      page: options.page ? parseInt(options.page, 10) : 1,
      limit: options.limit ? parseInt(options.limit, 10) : 20,
    });
    spinner?.stop();
    if (options.json) { outputJson(result); return; }
    console.log(chalk.bold(`\nAssets owned by ${chalk.cyan(address)}:\n`));
    printAssetList(result.items || [], "assets");
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

export async function assetCreatorCommand(address: string, options: AssetOptions & { page?: string; limit?: string; verified?: boolean } = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching assets by creator...");
    const result = await helius.getAssetsByCreator({
      creatorAddress: address,
      onlyVerified: options.verified ?? false,
      page: options.page ? parseInt(options.page, 10) : 1,
      limit: options.limit ? parseInt(options.limit, 10) : 20,
    });
    spinner?.stop();
    if (options.json) { outputJson(result); return; }
    console.log(chalk.bold(`\nAssets by creator ${chalk.cyan(address)}:\n`));
    printAssetList(result.items || [], "assets");
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

export async function assetAuthorityCommand(address: string, options: AssetOptions & { page?: string; limit?: string } = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching assets by authority...");
    const result = await helius.getAssetsByAuthority({
      authorityAddress: address,
      page: options.page ? parseInt(options.page, 10) : 1,
      limit: options.limit ? parseInt(options.limit, 10) : 20,
    });
    spinner?.stop();
    if (options.json) { outputJson(result); return; }
    console.log(chalk.bold(`\nAssets by authority ${chalk.cyan(address)}:\n`));
    printAssetList(result.items || [], "assets");
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

export async function assetCollectionCommand(address: string, options: AssetOptions & { page?: string; limit?: string } = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching collection assets...");
    const result = await helius.getAssetsByGroup({
      groupKey: "collection",
      groupValue: address,
      page: options.page ? parseInt(options.page, 10) : 1,
      limit: options.limit ? parseInt(options.limit, 10) : 20,
    });
    spinner?.stop();
    if (options.json) { outputJson(result); return; }
    console.log(chalk.bold(`\nAssets in collection ${chalk.cyan(address)}:\n`));
    printAssetList(result.items || [], "assets");
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

export async function assetSearchCommand(options: AssetOptions & {
  owner?: string; creator?: string; authority?: string;
  compressed?: boolean; burnt?: boolean; frozen?: boolean;
  page?: string; limit?: string;
} = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Searching assets...");
    const params: any = {
      page: options.page ? parseInt(options.page, 10) : 1,
      limit: options.limit ? parseInt(options.limit, 10) : 20,
    };
    if (options.owner) params.ownerAddress = options.owner;
    if (options.creator) params.creatorAddress = options.creator;
    if (options.authority) params.authorityAddress = options.authority;
    if (options.compressed != null) params.compressed = options.compressed;
    if (options.burnt != null) params.burnt = options.burnt;
    if (options.frozen != null) params.frozen = options.frozen;
    const result = await helius.searchAssets(params);
    spinner?.stop();
    if (options.json) { outputJson(result); return; }
    console.log(chalk.bold("\nSearch Results:\n"));
    printAssetList(result.items || [], "assets");
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

export async function assetProofCommand(id: string, options: AssetOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching asset proof...");
    const result = await helius.getAssetProof({ id });
    spinner?.stop();
    if (options.json) { outputJson(result); return; }
    console.log(chalk.bold(`\nAsset Proof for ${chalk.cyan(id)}:\n`));
    const proof = result as any;
    console.log(`  ${chalk.gray("Root:")}       ${proof.root || "N/A"}`);
    console.log(`  ${chalk.gray("Leaf:")}       ${proof.leaf || "N/A"}`);
    console.log(`  ${chalk.gray("Tree ID:")}    ${proof.tree_id || "N/A"}`);
    console.log(`  ${chalk.gray("Node index:")} ${proof.node_index ?? "N/A"}`);
    if (proof.proof?.length) {
      console.log(`  ${chalk.gray("Proof:")}      ${proof.proof.length} node(s)`);
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

export async function assetProofBatchCommand(ids: string[], options: AssetOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, `Fetching proofs for ${ids.length} asset(s)...`);
    const result = await helius.getAssetProofBatch({ ids });
    spinner?.stop();
    if (options.json) { outputJson(result); return; }
    console.log(chalk.bold(`\nAsset Proofs (${ids.length}):\n`));
    for (const [id, proof] of Object.entries(result as any)) {
      const p = proof as any;
      console.log(`  ${chalk.cyan(id)}: root=${p?.root || "N/A"}, ${p?.proof?.length || 0} node(s)`);
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

export async function assetEditionsCommand(mint: string, options: AssetOptions & { page?: string; limit?: string } = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching NFT editions...");
    const result = await helius.getNftEditions({
      mint,
      page: options.page ? parseInt(options.page, 10) : 1,
      limit: options.limit ? parseInt(options.limit, 10) : 20,
    });
    spinner?.stop();
    if (options.json) { outputJson(result); return; }
    const editions = (result as any)?.editions || [];
    console.log(chalk.bold(`\nEditions for ${chalk.cyan(mint)}:\n`));
    if (editions.length === 0) {
      console.log(chalk.yellow("  No editions found."));
      return;
    }
    for (const ed of editions) {
      console.log(`  ${chalk.gray("Edition:")} ${ed.mint || "N/A"} (${ed.edition_number || "?"})`);
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

export async function assetSignaturesCommand(id: string, options: AssetOptions & { page?: string; limit?: string } = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching signatures for asset...");
    const result = await helius.getSignaturesForAsset({
      id,
      page: options.page ? parseInt(options.page, 10) : 1,
      limit: options.limit ? parseInt(options.limit, 10) : 20,
    });
    spinner?.stop();
    if (options.json) { outputJson(result); return; }
    const sigs = (result as any)?.items || [];
    console.log(chalk.bold(`\nSignatures for ${chalk.cyan(id)}:\n`));
    if (sigs.length === 0) {
      console.log(chalk.yellow("  No signatures found."));
      return;
    }
    for (const sig of sigs) {
      const s = typeof sig === "string" ? sig : (sig as any)[0] || JSON.stringify(sig);
      console.log(`  ${chalk.cyan(s)}`);
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

export async function assetTokenAccountsCommand(options: AssetOptions & { owner?: string; mint?: string; page?: string; limit?: string } = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching token accounts...");
    const params: any = {
      page: options.page ? parseInt(options.page, 10) : 1,
      limit: options.limit ? parseInt(options.limit, 10) : 20,
    };
    if (options.owner) params.owner = options.owner;
    if (options.mint) params.mint = options.mint;
    const result = await helius.getTokenAccounts(params);
    spinner?.stop();
    if (options.json) { outputJson(result); return; }
    const accounts = (result as any)?.token_accounts || [];
    console.log(chalk.bold("\nToken Accounts:\n"));
    if (accounts.length === 0) {
      console.log(chalk.yellow("  No token accounts found."));
      return;
    }
    const columns: TableColumn[] = [
      { key: "address", label: "Account", width: 14, format: (v: string) => v ? formatAddress(v) : "" },
      { key: "owner", label: "Owner", width: 14, format: (v: string) => v ? formatAddress(v) : "" },
      { key: "mint", label: "Mint", width: 14, format: (v: string) => v ? formatAddress(v) : "" },
      { key: "amount", label: "Amount", align: "right", width: 20 },
    ];
    const rows = accounts.map((a: any) => ({
      address: a.address || "",
      owner: a.owner || "",
      mint: a.mint || "",
      amount: a.amount?.toString() || "0",
    }));
    console.log(formatTable(rows, columns));
    console.log(chalk.gray(`\n  ${accounts.length} account(s) shown`));
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
