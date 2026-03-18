import chalk from "chalk";
import { resolveApiKey, resolveNetwork, getClient, type ResolveOptions } from "../lib/helius.js";
import { outputJson, handleCommandError, createSpinner, type OutputOptions } from "../lib/output.js";

interface SendOptions extends OutputOptions, ResolveOptions {}

export async function sendBroadcastCommand(base64Tx: string, options: SendOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start("Broadcasting transaction...");
    const signature = await helius.tx.broadcastTransaction(base64Tx);
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
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start("Sending transaction...");
    const signature = await helius.tx.sendTransaction({ base64: base64Tx });
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
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    const region = (options.region || "Default") as any;
    spinner?.start(`Sending via Helius Sender (${region})...`);
    const signature = await helius.tx.sendTransaction({
      base64: base64Tx,
      sendOptions: { region },
    } as any);
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
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start("Polling for confirmation...");
    const result = await helius.tx.pollTransactionConfirmation(signature as any);
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
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start("Simulating for compute units...");
    const result = await helius.tx.getComputeUnits(base64Tx as any);
    spinner?.stop();

    if (options.json) { outputJson({ computeUnits: result }); return; }
    console.log(chalk.bold("\nCompute Unit Estimate:\n"));
    console.log(`  ${chalk.cyan(String(result))} CU`);
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}
