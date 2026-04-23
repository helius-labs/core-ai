import chalk from "chalk";
import { setupClient, type ResolveOptions } from "../lib/helius.js";
import { formatSol } from "../lib/formatters.js";
import { outputJson, exitWithError, handleCommandError, createSpinner, withRetry, type OutputOptions, type RetryOptions } from "../lib/output.js";
import { validateAddress } from "../lib/validation.js";

interface StakeOptions extends OutputOptions, ResolveOptions, RetryOptions {}

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

export async function stakeInstructionsCommand(
  amount: string | undefined,
  options: StakeOptions & AmountOptions = {},
): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const lamports = resolveLamports(amount, options, !!options.json);
    const helius = await setupClient(spinner, options, "Getting stake instructions...");
    const result = await withRetry(() => helius.stake.getStakeInstructions(lamports), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    console.log(chalk.bold(`\nStake Instructions for ${formatSol(lamports)}:\n`));
    console.log(chalk.gray(JSON.stringify(result, null, 2)));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function stakeUnstakeInstructionCommand(stakeAccount: string, options: StakeOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(stakeAccount);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Getting unstake instruction...");
    const result = await withRetry(() => helius.stake.getUnstakeInstruction(stakeAccount as any), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    console.log(chalk.bold(`\nUnstake Instruction for ${chalk.cyan(stakeAccount)}:\n`));
    console.log(chalk.gray(JSON.stringify(result, null, 2)));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function stakeWithdrawInstructionCommand(stakeAccount: string, options: StakeOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(stakeAccount);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Getting withdraw instruction...");
    const result = await withRetry(() => helius.stake.getWithdrawInstruction(stakeAccount as any), options, spinner);
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
    const helius = await setupClient(spinner, options, "Creating stake transaction...");
    const result = await withRetry(() => helius.stake.createStakeTransaction(lamports), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    console.log(chalk.bold(`\nStake Transaction Created (${formatSol(lamports)}):\n`));
    console.log(chalk.gray("Transaction needs to be signed and sent with your keypair."));
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
    const helius = await setupClient(spinner, options, "Creating unstake transaction...");
    const result = await withRetry(() => helius.stake.createUnstakeTransaction(stakeAccount as any), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    console.log(chalk.bold("\nUnstake Transaction Created:\n"));
    console.log(chalk.gray(JSON.stringify(result, null, 2)));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function stakeWithdrawCommand(stakeAccount: string, options: StakeOptions & { keypair?: string } = {}): Promise<void> {
  const spinner = createSpinner(options);
  if (!options.keypair) {
    exitWithError("KEYPAIR_NOT_FOUND", "Missing --keypair flag", undefined, !!options.json);
  }
  try {
    const addrErr = validateAddress(stakeAccount);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Creating withdraw transaction...");
    const result = await withRetry(() => helius.stake.createWithdrawTransaction(stakeAccount as any), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    console.log(chalk.bold("\nWithdraw Transaction Created:\n"));
    console.log(chalk.gray(JSON.stringify(result, null, 2)));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}
