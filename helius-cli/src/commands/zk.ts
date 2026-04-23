import chalk from "chalk";
import { setupClient, type ResolveOptions } from "../lib/helius.js";
import { outputJson, exitWithError, handleCommandError, createSpinner, withRetry, type OutputOptions, type RetryOptions } from "../lib/output.js";
import { validateAddress, validateAddresses, validateSignature } from "../lib/validation.js";

interface ZkOptions extends OutputOptions, ResolveOptions, RetryOptions {}

function handleResult(spinner: any, result: any, options: ZkOptions, label: string): void {
  spinner?.stop();
  if (options.json) { outputJson(result); return; }
  console.log(chalk.bold(`\n${label}:\n`));
  console.log(chalk.gray(JSON.stringify(result, null, 2)));
}

export async function zkAccountCommand(addressOrHash: string, options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(addressOrHash);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching compressed account...");
    const result = await withRetry(() => helius.zk.getCompressedAccount({ address: addressOrHash }), options, spinner);
    handleResult(spinner, result, options, "Compressed Account");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkAccountsByOwnerCommand(owner: string, options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(owner);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching compressed accounts by owner...");
    const result = await withRetry(() => helius.zk.getCompressedAccountsByOwner({ owner }), options, spinner);
    handleResult(spinner, result, options, "Compressed Accounts by Owner");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkBalanceCommand(addressOrHash: string, options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(addressOrHash);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching compressed balance...");
    const result = await withRetry(() => helius.zk.getCompressedBalance({ address: addressOrHash }), options, spinner);
    handleResult(spinner, result, options, "Compressed Balance");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkBalanceByOwnerCommand(owner: string, options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(owner);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching compressed balance by owner...");
    const result = await withRetry(() => helius.zk.getCompressedBalanceByOwner({ owner }), options, spinner);
    handleResult(spinner, result, options, "Compressed Balance by Owner");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkTokenHoldersCommand(mint: string, options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(mint);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching compressed token holders...");
    const result = await withRetry(() => helius.zk.getCompressedMintTokenHolders({ mint }), options, spinner);
    handleResult(spinner, result, options, "Compressed Token Holders");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkTokenBalanceCommand(account: string, options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(account);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching compressed token account balance...");
    const result = await withRetry(() => helius.zk.getCompressedTokenAccountBalance({ address: account }), options, spinner);
    handleResult(spinner, result, options, "Compressed Token Account Balance");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkTokenAccountsByOwnerCommand(owner: string, options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(owner);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching compressed token accounts by owner...");
    const result = await withRetry(() => helius.zk.getCompressedTokenAccountsByOwner({ owner }), options, spinner);
    handleResult(spinner, result, options, "Compressed Token Accounts by Owner");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkTokenAccountsByDelegateCommand(delegate: string, options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(delegate);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching compressed token accounts by delegate...");
    const result = await withRetry(() => helius.zk.getCompressedTokenAccountsByDelegate({ delegate }), options, spinner);
    handleResult(spinner, result, options, "Compressed Token Accounts by Delegate");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkTokenBalancesByOwnerCommand(owner: string, options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(owner);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching compressed token balances by owner (V2)...");
    const result = await withRetry(() => helius.zk.getCompressedTokenBalancesByOwnerV2({ owner }), options, spinner);
    handleResult(spinner, result, options, "Compressed Token Balances by Owner (V2)");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkProofCommand(addressOrHash: string, options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(addressOrHash);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching compressed account proof...");
    const result = await withRetry(() => helius.zk.getCompressedAccountProof({ hash: addressOrHash }), options, spinner);
    handleResult(spinner, result, options, "Compressed Account Proof");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkProofsCommand(addresses: string[], options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddresses(addresses);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, `Fetching proofs for ${addresses.length} account(s)...`);
    const result = await withRetry(() => helius.zk.getMultipleCompressedAccountProofs({ hashes: addresses }), options, spinner);
    handleResult(spinner, result, options, "Multiple Compressed Account Proofs");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkMultipleAccountsCommand(addresses: string[], options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddresses(addresses);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, `Fetching ${addresses.length} compressed account(s)...`);
    const result = await withRetry(() => helius.zk.getMultipleCompressedAccounts({ addresses }), options, spinner);
    handleResult(spinner, result, options, "Multiple Compressed Accounts");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkAddressProofsCommand(addresses: string[], options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddresses(addresses);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, `Fetching address proofs (V2)...`);
    const result = await withRetry(() => helius.zk.getMultipleNewAddressProofsV2(addresses), options, spinner);
    handleResult(spinner, result, options, "Multiple New Address Proofs (V2)");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkSignaturesAccountCommand(account: string, options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(account);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching compression signatures for account...");
    const result = await withRetry(() => helius.zk.getCompressionSignaturesForAccount({ hash: account }), options, spinner);
    handleResult(spinner, result, options, "Compression Signatures for Account");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkSignaturesAddressCommand(address: string, options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(address);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching compression signatures for address...");
    const result = await withRetry(() => helius.zk.getCompressionSignaturesForAddress({ address }), options, spinner);
    handleResult(spinner, result, options, "Compression Signatures for Address");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkSignaturesOwnerCommand(owner: string, options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(owner);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching compression signatures for owner...");
    const result = await withRetry(() => helius.zk.getCompressionSignaturesForOwner({ owner }), options, spinner);
    handleResult(spinner, result, options, "Compression Signatures for Owner");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkSignaturesTokenOwnerCommand(owner: string, options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(owner);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching compression signatures for token owner...");
    const result = await withRetry(() => helius.zk.getCompressionSignaturesForTokenOwner({ owner }), options, spinner);
    handleResult(spinner, result, options, "Compression Signatures for Token Owner");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkLatestSignaturesCommand(options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const helius = await setupClient(spinner, options, "Fetching latest compression signatures...");
    const result = await withRetry(() => helius.zk.getLatestCompressionSignatures({}), options, spinner);
    handleResult(spinner, result, options, "Latest Compression Signatures");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkLatestNonVotingCommand(options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const helius = await setupClient(spinner, options, "Fetching latest non-voting signatures...");
    const result = await withRetry(() => helius.zk.getLatestNonVotingSignatures({}), options, spinner);
    handleResult(spinner, result, options, "Latest Non-Voting Signatures");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkTxCommand(signature: string, options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const sigErr = validateSignature(signature);
    if (sigErr) exitWithError("INVALID_INPUT", sigErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching transaction with compression info...");
    const result = await withRetry(() => helius.zk.getTransactionWithCompressionInfo({ signature }), options, spinner);
    handleResult(spinner, result, options, "Transaction with Compression Info");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkValidityProofCommand(options: ZkOptions & { hashes?: string; addresses?: string } = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const helius = await setupClient(spinner, options, "Fetching validity proof...");
    const params: any = {};
    if (options.hashes) params.hashes = options.hashes.split(",").map((s: string) => s.trim());
    if (options.addresses) params.newAddressesWithTrees = options.addresses.split(",").map((s: string) => ({ address: s.trim(), tree: "" }));
    const result = await withRetry(() => helius.zk.getValidityProof(params), options, spinner);
    handleResult(spinner, result, options, "Validity Proof");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkIndexerHealthCommand(options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const helius = await setupClient(spinner, options, "Checking indexer health...");
    const result = await withRetry(() => helius.zk.getIndexerHealth(), options, spinner);
    handleResult(spinner, result, options, "Indexer Health");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkIndexerSlotCommand(options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const helius = await setupClient(spinner, options, "Fetching indexer slot...");
    const result = await withRetry(() => helius.zk.getIndexerSlot(), options, spinner);
    handleResult(spinner, result, options, "Indexer Slot");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function zkSignaturesForAssetCommand(id: string, options: ZkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(id);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching signatures for asset...");
    const result = await withRetry(() => helius.zk.getSignaturesForAsset({ id, page: 1 }), options, spinner);
    handleResult(spinner, result, options, "Signatures for Asset");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}
