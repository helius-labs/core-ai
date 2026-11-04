import chalk from "chalk";
import {
  decompileTransactionMessageFetchingLookupTables,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  isSolanaError,
  SOLANA_ERROR__TRANSACTION__FAILED_WHEN_SIMULATING_TO_ESTIMATE_COMPUTE_LIMIT,
  type CompiledTransactionMessage,
  type CompiledTransactionMessageWithLifetime,
} from "@solana/kit";
import { setupClient, type ResolveOptions } from "../lib/helius.js";
import { outputJson, exitWithError, handleCommandError, createSpinner, withRetry, confirmDestructive, type OutputOptions, type RetryOptions } from "../lib/output.js";
import { validateBase64Transaction, validateSignature } from "../lib/validation.js";

interface SendOptions extends OutputOptions, ResolveOptions, RetryOptions {
  dryRun?: boolean;
  yes?: boolean;
}

export async function sendBroadcastCommand(base64Tx: string, options: SendOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const txErr = validateBase64Transaction(base64Tx);
    if (txErr) exitWithError("INVALID_INPUT", txErr, undefined, !!options.json);
    const trimmedTx = base64Tx.trim();

    if (options.dryRun) {
      spinner?.succeed("Dry run — transaction not submitted");
      if (options.json) { outputJson({ dryRun: true, transaction: trimmedTx }); return; }
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
    const signature = await withRetry(() => helius.tx.broadcastTransaction(trimmedTx), options, spinner);
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
    const txErr = validateBase64Transaction(base64Tx);
    if (txErr) exitWithError("INVALID_INPUT", txErr, undefined, !!options.json);
    const trimmedTx = base64Tx.trim();

    if (options.dryRun) {
      spinner?.succeed("Dry run — transaction not submitted");
      if (options.json) { outputJson({ dryRun: true, transaction: trimmedTx }); return; }
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
    const signature = await withRetry(() => helius.tx.sendTransaction({ base64: trimmedTx }), options, spinner);
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
    const txErr = validateBase64Transaction(base64Tx);
    if (txErr) exitWithError("INVALID_INPUT", txErr, undefined, !!options.json);
    const trimmedTx = base64Tx.trim();

    if (options.dryRun) {
      const region = options.region || "Default";
      spinner?.succeed("Dry run — transaction not submitted");
      if (options.json) { outputJson({ dryRun: true, transaction: trimmedTx, region }); return; }
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
      base64: trimmedTx,
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

function decodeTransactionMessage(base64Tx: string, json: boolean): CompiledTransactionMessage & CompiledTransactionMessageWithLifetime {
  try {
    const { messageBytes } = getTransactionDecoder().decode(getBase64Encoder().encode(base64Tx));
    return getCompiledTransactionMessageDecoder().decode(messageBytes);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    exitWithError("INVALID_INPUT", "The input does not decode to a serialized Solana transaction.", { reason }, json);
  }
}

export async function sendComputeUnitsCommand(base64Tx: string, options: SendOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const txErr = validateBase64Transaction(base64Tx);
    if (txErr) exitWithError("INVALID_INPUT", txErr, undefined, !!options.json);
    const trimmedTx = base64Tx.trim();

    const compiled = decodeTransactionMessage(trimmedTx, !!options.json);
    const helius = await setupClient(spinner, options, "Simulating for compute units...");
    // Rebuilding the message fetches any address lookup tables a v0 transaction uses
    const message = await withRetry(() => decompileTransactionMessageFetchingLookupTables(compiled, helius.kitRpc), options, spinner);
    const computeUnits = await withRetry<number>(() => helius.tx.getComputeUnits(message), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson({ computeUnits }); return; }
    console.log(chalk.bold("\nCompute Unit Estimate:\n"));
    console.log(`  ${chalk.cyan(computeUnits.toLocaleString())} CU`);
    console.log(chalk.gray("\n  Simulated usage plus a 10% margin, at least 1,000 CU. Set it as the transaction's compute unit limit."));
  } catch (error) {
    if (isSolanaError(error, SOLANA_ERROR__TRANSACTION__FAILED_WHEN_SIMULATING_TO_ESTIMATE_COMPUTE_LIMIT)) {
      spinner?.stop();
      const reason = error.cause instanceof Error ? error.cause.message : "unknown error";
      const logs = error.context.logs ?? [];
      if (!options.json && logs.length > 0) {
        console.error(chalk.gray(`\n  Program logs:\n${logs.map((line) => `    ${line}`).join("\n")}\n`));
      }
      exitWithError(
        "INVALID_INPUT",
        `The transaction fails in simulation (${reason}), so it has no compute unit estimate.`,
        { unitsConsumed: Number(error.context.unitsConsumed), logs },
        !!options.json,
      );
    }
    handleCommandError(error, options, spinner);
  }
}
