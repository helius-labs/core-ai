import chalk from "chalk";
import { address, createKeyPairSignerFromBytes, createNoopSigner, type Address, type KeyPairSigner } from "@solana/kit";
import { setupClient, type ResolveOptions } from "../lib/helius.js";
import { formatSol } from "../lib/formatters.js";
import { outputJson, exitWithError, handleCommandError, createSpinner, withRetry, confirmDestructive, type OutputOptions, type RetryOptions } from "../lib/output.js";
import { validateAddress } from "../lib/validation.js";
import { loadKeypairFromFile } from "../lib/wallet.js";

interface StakeOptions extends OutputOptions, ResolveOptions, RetryOptions {
  yes?: boolean;
}

interface AmountOptions {
  amount?: string;     // --amount <sol> (human-readable, e.g. "1.5")
  rawAmount?: string;  // --raw-amount <lamports> (exact, e.g. "1500000000")
}

/**
 * Resolve an amount to lamports from three possible sources:
 *   - positional SOL (legacy, e.g. "1.5")
 *   - --amount <sol> flag (same format, prevents ambiguity with other positionals)
 *   - --raw-amount <lamports> flag (exact integer, avoids float rounding for programmatic callers)
 *
 * Exactly one source must be provided; otherwise we exit with INVALID_INPUT.
 * The SOL paths share the same parse+round logic so their behavior is identical.
 */
function resolveLamports(
  positional: string | undefined,
  opts: AmountOptions,
  json: boolean,
): bigint {
  const sources = [positional, opts.amount, opts.rawAmount].filter((v): v is string => !!v);
  if (sources.length === 0) {
    exitWithError(
      "INVALID_INPUT",
      "Provide an amount: positional SOL, --amount <sol>, or --raw-amount <lamports>.",
      undefined,
      json,
    );
  }
  if (sources.length > 1) {
    exitWithError(
      "INVALID_INPUT",
      "Conflicting amount inputs. Use exactly one of: positional, --amount, --raw-amount.",
      undefined,
      json,
    );
  }

  if (opts.rawAmount !== undefined) {
    if (!/^\d+$/.test(opts.rawAmount)) {
      exitWithError(
        "INVALID_INPUT",
        `Invalid --raw-amount: ${opts.rawAmount}. Must be a positive integer (lamports).`,
        undefined,
        json,
      );
    }
    const lamports = BigInt(opts.rawAmount);
    if (lamports <= 0n) {
      exitWithError("INVALID_INPUT", "Amount must be greater than 0 lamports.", undefined, json);
    }
    return lamports;
  }

  // Validate format before parseFloat to reject trailing garbage ("1.5abc" → 1.5),
  // scientific notation ("1e9"), leading signs, and other oddities that parseFloat
  // silently accepts or truncates.
  const sol = opts.amount ?? positional!;
  if (!/^\d+(\.\d+)?$/.test(sol)) {
    exitWithError(
      "INVALID_INPUT",
      `Invalid SOL amount: ${sol}. Must be a positive decimal number (e.g. 1.5).`,
      undefined,
      json,
    );
  }
  const parsed = parseFloat(sol);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    exitWithError(
      "INVALID_INPUT",
      `Invalid SOL amount: ${sol}. Must be a positive number.`,
      undefined,
      json,
    );
  }
  const lamports = BigInt(Math.round(parsed * 1e9));
  if (lamports <= 0n) {
    exitWithError("INVALID_INPUT", "Amount must be greater than 0 lamports.", undefined, json);
  }
  return lamports;
}

/** The SDK returns stake transactions already signed, with a fresh blockhash. */
const SIGNED_TX_NOTE = "Signed with your keypair and ready to send: run `helius send broadcast <serializedTx>` within about a minute, before its blockhash expires. After that, run this command again.";

/** Load the --keypair file as the signer the SDK's stake transaction builders take first. */
async function loadSigner(keypairPath: string, json: boolean): Promise<KeyPairSigner> {
  try {
    const keypair = await loadKeypairFromFile(keypairPath);
    return await createKeyPairSignerFromBytes(keypair.secretKey);
  } catch (e) {
    return exitWithError("KEYPAIR_NOT_FOUND", (e as Error).message, undefined, json);
  }
}

export async function stakeAccountsCommand(wallet: string, options: StakeOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(wallet);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Fetching Helius stake accounts...");
    const result = await withRetry(() => helius.stake.getHeliusStakeAccounts(wallet as any), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    const accounts = Array.isArray(result) ? result : [];
    console.log(chalk.bold(`\nHelius Stake Accounts for ${chalk.cyan(wallet)}:\n`));
    if (accounts.length === 0) {
      console.log(chalk.yellow("  No stake accounts found."));
      return;
    }
    for (const a of accounts) {
      console.log(`  ${chalk.cyan(typeof a === "string" ? a : JSON.stringify(a))}`);
    }
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function stakeWithdrawableCommand(stakeAccount: string, options: StakeOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(stakeAccount);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Checking withdrawable amount...");
    const result = await withRetry(() => helius.stake.getWithdrawableAmount(stakeAccount as any), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson({ stakeAccount, withdrawable: result }); return; }

    console.log(chalk.bold(`\nWithdrawable Amount for ${chalk.cyan(stakeAccount)}:\n`));
    console.log(`  ${chalk.green(typeof result === "number" || typeof result === "bigint" ? formatSol(result) : JSON.stringify(result))}`);
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

/** Validate an address flag, exiting with INVALID_ADDRESS (or INVALID_INPUT when it is missing). */
function requireAddress(value: string | undefined, flag: string, json: boolean): Address {
  if (!value) return exitWithError("INVALID_INPUT", `Missing ${flag} <address>.`, undefined, json);
  const err = validateAddress(value);
  if (err) exitWithError("INVALID_ADDRESS", `${flag}: ${err}`, undefined, json);
  return address(value);
}

/**
 * The owner as a no-op signer, so the instruction marks it as a required signer
 * (a bare address comes out read-only). Whoever submits it signs with the real key.
 * helius-sdk's public types say Address for this parameter, but the
 * implementation takes `TransactionSigner | Address`, hence the cast.
 */
function ownerSigner(owner: Address): Address {
  return createNoopSigner(owner) as unknown as Address;
}

/**
 * Lamports to withdraw: --amount or --raw-amount when given, otherwise the stake
 * account's whole balance including the rent-exempt reserve, which closes it.
 * Exits when there is nothing to withdraw yet.
 */
async function resolveWithdrawLamports(
  helius: Awaited<ReturnType<typeof setupClient>>,
  stakeAccount: Address,
  options: StakeOptions & AmountOptions,
  spinner: ReturnType<typeof createSpinner>,
): Promise<bigint> {
  const json = !!options.json;
  const lamports = options.amount || options.rawAmount
    ? resolveLamports(undefined, options, json)
    : BigInt(await withRetry(() => helius.stake.getWithdrawableAmount(stakeAccount, true), options, spinner));
  if (lamports === 0n) {
    exitWithError(
      "INVALID_INPUT",
      `Nothing to withdraw from ${stakeAccount}: the stake is still active or cooling down. Run \`helius stake withdrawable ${stakeAccount}\` to check.`,
      undefined,
      json,
    );
  }
  return lamports;
}

export async function stakeUnstakeInstructionCommand(stakeAccount: string, options: StakeOptions & { owner?: string } = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const json = !!options.json;
    const stake = requireAddress(stakeAccount, "stake account", json);
    const owner = requireAddress(options.owner, "--owner", json);
    const helius = await setupClient(spinner, options, "Getting unstake instruction...");
    // Typed as synchronous, but the SDK loads helius.stake lazily, so the first
    // call on a fresh client returns a Promise. Awaiting covers both.
    const result = await helius.stake.getUnstakeInstruction(ownerSigner(owner), stake);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    console.log(chalk.bold(`\nUnstake Instruction for ${chalk.cyan(stakeAccount)}:\n`));
    console.log(chalk.gray(JSON.stringify(result, null, 2)));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function stakeWithdrawInstructionCommand(
  stakeAccount: string,
  options: StakeOptions & AmountOptions & { owner?: string; destination?: string } = {},
): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const json = !!options.json;
    const stake = requireAddress(stakeAccount, "stake account", json);
    const owner = requireAddress(options.owner, "--owner", json);
    const destination = options.destination ? requireAddress(options.destination, "--destination", json) : owner;
    const helius = await setupClient(spinner, options, "Getting withdraw instruction...");
    const lamports = await resolveWithdrawLamports(helius, stake, options, spinner);
    // Awaited for the same reason as getUnstakeInstruction above
    const result = await helius.stake.getWithdrawInstruction(ownerSigner(owner), stake, destination, lamports);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    console.log(chalk.bold(`\nWithdraw Instruction for ${chalk.cyan(stakeAccount)}:\n`));
    console.log(chalk.gray(JSON.stringify(result, null, 2)));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function stakeCreateCommand(
  amount: string | undefined,
  options: StakeOptions & AmountOptions & { keypair?: string } = {},
): Promise<void> {
  const spinner = createSpinner(options);
  if (!options.keypair) {
    exitWithError("KEYPAIR_NOT_FOUND", "Missing --keypair flag", undefined, !!options.json);
  }
  try {
    const lamports = resolveLamports(amount, options, !!options.json);
    const signer = await loadSigner(options.keypair!, !!options.json);
    const helius = await setupClient(spinner, options, "Creating stake transaction...");
    // The SDK takes (owner signer, amount in SOL) and converts back with Math.round(amountSol * 1e9)
    const amountSol = Number(lamports) / 1e9;
    const result = await withRetry(() => helius.stake.createStakeTransaction(signer, amountSol), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    console.log(chalk.bold(`\nStake Transaction Created (${formatSol(lamports)}):\n`));
    console.log(chalk.gray(SIGNED_TX_NOTE));
    console.log(chalk.gray(JSON.stringify(result, null, 2)));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function stakeUnstakeCommand(stakeAccount: string, options: StakeOptions & { keypair?: string } = {}): Promise<void> {
  const spinner = createSpinner(options);
  if (!options.keypair) {
    exitWithError("KEYPAIR_NOT_FOUND", "Missing --keypair flag", undefined, !!options.json);
  }
  try {
    const addrErr = validateAddress(stakeAccount);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    // Load the keypair before asking, so a bad --keypair path fails without a prompt
    const signer = await loadSigner(options.keypair!, !!options.json);
    if (!(await confirmDestructive(
      chalk.yellow(`\n  Sign an unstake (deactivate) transaction for ${stakeAccount} with this keypair? (y/N) `),
      options,
    ))) {
      console.log(chalk.gray("  Cancelled."));
      return;
    }
    const helius = await setupClient(spinner, options, "Creating unstake transaction...");
    const result = await withRetry(() => helius.stake.createUnstakeTransaction(signer, address(stakeAccount)), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    console.log(chalk.bold("\nUnstake Transaction Created:\n"));
    console.log(chalk.gray(SIGNED_TX_NOTE));
    console.log(chalk.gray(JSON.stringify(result, null, 2)));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function stakeWithdrawCommand(
  stakeAccount: string,
  options: StakeOptions & AmountOptions & { keypair?: string; destination?: string } = {},
): Promise<void> {
  const spinner = createSpinner(options);
  if (!options.keypair) {
    exitWithError("KEYPAIR_NOT_FOUND", "Missing --keypair flag", undefined, !!options.json);
  }
  try {
    const json = !!options.json;
    const stake = requireAddress(stakeAccount, "stake account", json);
    const requestedDestination = options.destination ? requireAddress(options.destination, "--destination", json) : undefined;
    // Load the keypair before asking, so a bad --keypair path fails without a prompt
    const signer = await loadSigner(options.keypair!, json);
    const destination = requestedDestination ?? signer.address;
    if (!(await confirmDestructive(
      chalk.yellow(`\n  Sign a withdraw transaction from ${stakeAccount} to ${destination} with this keypair? (y/N) `),
      options,
    ))) {
      console.log(chalk.gray("  Cancelled."));
      return;
    }
    const helius = await setupClient(spinner, options, "Creating withdraw transaction...");
    const lamports = await resolveWithdrawLamports(helius, stake, options, spinner);
    const result = await withRetry(
      () => helius.stake.createWithdrawTransaction(signer, stake, destination, lamports),
      options,
      spinner,
    );
    spinner?.stop();

    if (options.json) { outputJson({ ...result, destination, lamports: Number(lamports) }); return; }

    console.log(chalk.bold(`\nWithdraw Transaction Created (${formatSol(lamports)} to ${destination}):\n`));
    console.log(chalk.gray(SIGNED_TX_NOTE));
    console.log(chalk.gray(JSON.stringify(result, null, 2)));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}
