import chalk from "chalk";
import ora from "ora";
import { resolveApiKey, resolveNetwork, getClient, type ResolveOptions } from "../lib/helius.js";
import { outputJson, ExitCode, type OutputOptions } from "../lib/output.js";

interface ZkOptions extends OutputOptions, ResolveOptions {}

async function setup(spinner: ReturnType<typeof ora> | null, options: ZkOptions, message: string) {
  spinner?.start("Resolving API key...");
  const apiKey = await resolveApiKey(options);
  const network = resolveNetwork(options);
  const helius = getClient(apiKey, network);
  spinner?.start(message);
  return helius;
}

function handleResult(spinner: any, result: any, options: ZkOptions, label: string): void {
  spinner?.stop();
  if (options.json) { outputJson(result); return; }
  console.log(chalk.bold(`\n${label}:\n`));
  console.log(chalk.gray(JSON.stringify(result, null, 2)));
}

export async function zkAccountCommand(addressOrHash: string, options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching compressed account...");
    const result = await helius.zk.getCompressedAccount({ address: addressOrHash });
    handleResult(spinner, result, options, "Compressed Account");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkAccountsByOwnerCommand(owner: string, options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching compressed accounts by owner...");
    const result = await helius.zk.getCompressedAccountsByOwner({ owner });
    handleResult(spinner, result, options, "Compressed Accounts by Owner");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkBalanceCommand(addressOrHash: string, options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching compressed balance...");
    const result = await helius.zk.getCompressedBalance({ address: addressOrHash });
    handleResult(spinner, result, options, "Compressed Balance");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkBalanceByOwnerCommand(owner: string, options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching compressed balance by owner...");
    const result = await helius.zk.getCompressedBalanceByOwner({ owner });
    handleResult(spinner, result, options, "Compressed Balance by Owner");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkTokenHoldersCommand(mint: string, options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching compressed token holders...");
    const result = await helius.zk.getCompressedMintTokenHolders({ mint });
    handleResult(spinner, result, options, "Compressed Token Holders");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkTokenBalanceCommand(account: string, options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching compressed token account balance...");
    const result = await helius.zk.getCompressedTokenAccountBalance({ address: account });
    handleResult(spinner, result, options, "Compressed Token Account Balance");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkTokenAccountsByOwnerCommand(owner: string, options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching compressed token accounts by owner...");
    const result = await helius.zk.getCompressedTokenAccountsByOwner({ owner });
    handleResult(spinner, result, options, "Compressed Token Accounts by Owner");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkTokenAccountsByDelegateCommand(delegate: string, options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching compressed token accounts by delegate...");
    const result = await helius.zk.getCompressedTokenAccountsByDelegate({ delegate });
    handleResult(spinner, result, options, "Compressed Token Accounts by Delegate");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkTokenBalancesByOwnerCommand(owner: string, options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching compressed token balances by owner (V2)...");
    const result = await helius.zk.getCompressedTokenBalancesByOwnerV2({ owner });
    handleResult(spinner, result, options, "Compressed Token Balances by Owner (V2)");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkProofCommand(addressOrHash: string, options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching compressed account proof...");
    const result = await helius.zk.getCompressedAccountProof({ hash: addressOrHash });
    handleResult(spinner, result, options, "Compressed Account Proof");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkProofsCommand(addresses: string[], options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, `Fetching proofs for ${addresses.length} account(s)...`);
    const result = await helius.zk.getMultipleCompressedAccountProofs({ hashes: addresses });
    handleResult(spinner, result, options, "Multiple Compressed Account Proofs");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkMultipleAccountsCommand(addresses: string[], options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, `Fetching ${addresses.length} compressed account(s)...`);
    const result = await helius.zk.getMultipleCompressedAccounts({ addresses });
    handleResult(spinner, result, options, "Multiple Compressed Accounts");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkAddressProofsCommand(addresses: string[], options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, `Fetching address proofs (V2)...`);
    const result = await helius.zk.getMultipleNewAddressProofsV2(addresses);
    handleResult(spinner, result, options, "Multiple New Address Proofs (V2)");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkSignaturesAccountCommand(account: string, options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching compression signatures for account...");
    const result = await helius.zk.getCompressionSignaturesForAccount({ hash: account });
    handleResult(spinner, result, options, "Compression Signatures for Account");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkSignaturesAddressCommand(address: string, options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching compression signatures for address...");
    const result = await helius.zk.getCompressionSignaturesForAddress({ address });
    handleResult(spinner, result, options, "Compression Signatures for Address");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkSignaturesOwnerCommand(owner: string, options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching compression signatures for owner...");
    const result = await helius.zk.getCompressionSignaturesForOwner({ owner });
    handleResult(spinner, result, options, "Compression Signatures for Owner");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkSignaturesTokenOwnerCommand(owner: string, options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching compression signatures for token owner...");
    const result = await helius.zk.getCompressionSignaturesForTokenOwner({ owner });
    handleResult(spinner, result, options, "Compression Signatures for Token Owner");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkLatestSignaturesCommand(options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching latest compression signatures...");
    const result = await helius.zk.getLatestCompressionSignatures({});
    handleResult(spinner, result, options, "Latest Compression Signatures");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkLatestNonVotingCommand(options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching latest non-voting signatures...");
    const result = await helius.zk.getLatestNonVotingSignatures({});
    handleResult(spinner, result, options, "Latest Non-Voting Signatures");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkTxCommand(signature: string, options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching transaction with compression info...");
    const result = await helius.zk.getTransactionWithCompressionInfo({ signature });
    handleResult(spinner, result, options, "Transaction with Compression Info");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkValidityProofCommand(options: ZkOptions & { hashes?: string; addresses?: string } = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching validity proof...");
    const params: any = {};
    if (options.hashes) params.hashes = options.hashes.split(",").map((s: string) => s.trim());
    if (options.addresses) params.newAddressesWithTrees = options.addresses.split(",").map((s: string) => ({ address: s.trim(), tree: "" }));
    const result = await helius.zk.getValidityProof(params);
    handleResult(spinner, result, options, "Validity Proof");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkIndexerHealthCommand(options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Checking indexer health...");
    const result = await helius.zk.getIndexerHealth();
    handleResult(spinner, result, options, "Indexer Health");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkIndexerSlotCommand(options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching indexer slot...");
    const result = await helius.zk.getIndexerSlot();
    handleResult(spinner, result, options, "Indexer Slot");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}

export async function zkSignaturesForAssetCommand(id: string, options: ZkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    const helius = await setup(spinner, options, "Fetching signatures for asset...");
    const result = await helius.zk.getSignaturesForAsset({ id, page: 1 });
    handleResult(spinner, result, options, "Signatures for Asset");
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}
