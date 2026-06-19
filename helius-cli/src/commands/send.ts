import chalk from "chalk";
import { setupClient, type ResolveOptions } from "../lib/helius.js";
import { outputJson, exitWithError, handleCommandError, createSpinner, withRetry, confirmDestructive, type OutputOptions, type RetryOptions } from "../lib/output.js";
import { validateSignature } from "../lib/validation.js";

interface SendOptions extends OutputOptions, ResolveOptions, RetryOptions {
  dryRun?: boolean;
  yes?: boolean;
}

export async function sendBroadcastCommand(base64Tx: string, options: SendOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    if (options.dryRun) {
      spinner?.succeed("Dry run — transaction not submitted");
      if (options.json) { outputJson({ dryRun: true, transaction: base64Tx }); return; }
      console.log(chalk.yellow("\n  Dry run — transaction would be broadcast but was not submitted."));
      return;
    }

    if (!(await confirmDestructive(
      chalk.yellow("\n  Broadcast this transaction to the network? (y/N) "),
      options,
    ))) {
      console.log(chalk.gray("  Cancelled."));
      return;
    }

    const helius = await setupClient(spinner, options, "Broadcasting transaction...");
    const signature = await withRetry(() => helius.tx.broadcastTransaction(base64Tx), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson({ signature }); return; }
    console.log(chalk.green("\nTransaction broadcast successfully!"));
    console.log(`  ${chalk.gray("Signature:")} ${chalk.cyan(signature)}`);
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function sendRawCommand(base64Tx: string, options: SendOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    if (options.dryRun) {
      spinner?.succeed("Dry run — transaction not submitted");
      if (options.json) { outputJson({ dryRun: true, transaction: base64Tx }); return; }
      console.log(chalk.yellow("\n  Dry run — transaction would be sent but was not submitted."));
      return;
    }

    if (!(await confirmDestructive(
      chalk.yellow("\n  Send this transaction to the network? (y/N) "),
      options,
    ))) {
      console.log(chalk.gray("  Cancelled."));
      return;
    }

    const helius = await setupClient(spinner, options, "Sending transaction...");
    const signature = await withRetry(() => helius.tx.sendTransaction({ base64: base64Tx }), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson({ signature: String(signature) }); return; }
    console.log(chalk.green("\nTransaction sent!"));
    console.log(`  ${chalk.gray("Signature:")} ${chalk.cyan(String(signature))}`);
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function sendSenderCommand(base64Tx: string, options: SendOptions & { region?: string } = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    if (options.dryRun) {
      const region = options.region || "Default";
      spinner?.succeed("Dry run — transaction not submitted");
      if (options.json) { outputJson({ dryRun: true, transaction: base64Tx, region }); return; }
      console.log(chalk.yellow(`\n  Dry run — transaction would be sent via Helius Sender (${region}) but was not submitted.`));
      return;
    }

    if (!(await confirmDestructive(
      chalk.yellow(`\n  Send this transaction via Helius Sender (${options.region || "Default"})? (y/N) `),
      options,
    ))) {
      console.log(chalk.gray("  Cancelled."));
      return;
    }

    const helius = await setupClient(spinner, options, "Resolving API key...");

    const region = (options.region || "Default") as any;
    spinner?.start(`Sending via Helius Sender (${region})...`);
    const signature = await withRetry(() => helius.tx.sendTransaction({
      base64: base64Tx,
      sendOptions: { region },
    } as any), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson({ signature }); return; }
    console.log(chalk.green("\nTransaction sent via Helius Sender!"));
    console.log(`  ${chalk.gray("Signature:")} ${chalk.cyan(signature)}`);
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function sendPollCommand(signature: string, options: SendOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const sigErr = validateSignature(signature);
    if (sigErr) exitWithError("INVALID_INPUT", sigErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, "Polling for confirmation...");
    const result = await withRetry(() => helius.tx.pollTransactionConfirmation(signature as any), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson({ signature: String(result), confirmed: true }); return; }
    console.log(chalk.green("\nTransaction confirmed!"));
    console.log(`  ${chalk.gray("Signature:")} ${chalk.cyan(String(result))}`);
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function sendComputeUnitsCommand(base64Tx: string, options: SendOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const helius = await setupClient(spinner, options, "Simulating for compute units...");
    const result = await withRetry(() => helius.tx.getComputeUnits(base64Tx as any), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson({ computeUnits: result }); return; }
    console.log(chalk.bold("\nCompute Unit Estimate:\n"));
    console.log(`  ${chalk.cyan(String(result))} CU`);
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}
