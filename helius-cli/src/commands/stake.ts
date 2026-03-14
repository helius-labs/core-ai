import chalk from "chalk";
import { resolveApiKey, resolveNetwork, getClient, type ResolveOptions } from "../lib/helius.js";
import { formatSol } from "../lib/formatters.js";
import { outputJson, exitWithError, handleCommandError, createSpinner, type OutputOptions } from "../lib/output.js";

interface StakeOptions extends OutputOptions, ResolveOptions {}

export async function stakeAccountsCommand(wallet: string, options: StakeOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start("Fetching Helius stake accounts...");
    const result = await helius.stake.getHeliusStakeAccounts(wallet as any);
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
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start("Checking withdrawable amount...");
    const result = await helius.stake.getWithdrawableAmount(stakeAccount as any);
    spinner?.stop();

    if (options.json) { outputJson({ stakeAccount, withdrawable: result }); return; }

    console.log(chalk.bold(`\nWithdrawable Amount for ${chalk.cyan(stakeAccount)}:\n`));
    console.log(`  ${chalk.green(typeof result === "number" || typeof result === "bigint" ? formatSol(result) : JSON.stringify(result))}`);
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function stakeInstructionsCommand(amount: string, options: StakeOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start("Getting stake instructions...");
    const lamports = BigInt(Math.round(parseFloat(amount) * 1e9));
    const result = await helius.stake.getStakeInstructions(lamports);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    console.log(chalk.bold(`\nStake Instructions for ${amount} SOL:\n`));
    console.log(chalk.gray(JSON.stringify(result, null, 2)));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function stakeUnstakeInstructionCommand(stakeAccount: string, options: StakeOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start("Getting unstake instruction...");
    const result = await helius.stake.getUnstakeInstruction(stakeAccount as any);
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
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start("Getting withdraw instruction...");
    const result = await helius.stake.getWithdrawInstruction(stakeAccount as any);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    console.log(chalk.bold(`\nWithdraw Instruction for ${chalk.cyan(stakeAccount)}:\n`));
    console.log(chalk.gray(JSON.stringify(result, null, 2)));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function stakeCreateCommand(amount: string, options: StakeOptions & { keypair?: string } = {}): Promise<void> {
  const spinner = createSpinner(options);
  if (!options.keypair) {
    exitWithError("KEYPAIR_NOT_FOUND", "Missing --keypair flag", undefined, options.json);
  }
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start("Creating stake transaction...");
    const lamports = BigInt(Math.round(parseFloat(amount) * 1e9));
    const result = await helius.stake.createStakeTransaction(lamports);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    console.log(chalk.bold("\nStake Transaction Created:\n"));
    console.log(chalk.gray("Transaction needs to be signed and sent with your keypair."));
    console.log(chalk.gray(JSON.stringify(result, null, 2)));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function stakeUnstakeCommand(stakeAccount: string, options: StakeOptions & { keypair?: string } = {}): Promise<void> {
  const spinner = createSpinner(options);
  if (!options.keypair) {
    exitWithError("KEYPAIR_NOT_FOUND", "Missing --keypair flag", undefined, options.json);
  }
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start("Creating unstake transaction...");
    const result = await helius.stake.createUnstakeTransaction(stakeAccount as any);
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
    exitWithError("KEYPAIR_NOT_FOUND", "Missing --keypair flag", undefined, options.json);
  }
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start("Creating withdraw transaction...");
    const result = await helius.stake.createWithdrawTransaction(stakeAccount as any);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    console.log(chalk.bold("\nWithdraw Transaction Created:\n"));
    console.log(chalk.gray(JSON.stringify(result, null, 2)));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}
