import chalk from "chalk";
import { setupClient, resolveNetwork, type ResolveOptions } from "../lib/helius.js";
import { outputJson, handleCommandError, createSpinner, withRetry, type OutputOptions, type RetryOptions } from "../lib/output.js";

interface NetworkOptions extends OutputOptions, ResolveOptions, RetryOptions {}

export async function networkStatusCommand(options: NetworkOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const helius = await setupClient(spinner, options, "Fetching network status...");
    const [epochInfo, version, blockHeight] = await withRetry(() => Promise.all([
      helius.raw.getEpochInfo(),
      helius.raw.getVersion(),
      helius.raw.getBlockHeight(),
    ]), options, spinner);
    spinner?.stop();

    if (options.json) {
      outputJson({ network: resolveNetwork(options), epochInfo, version, blockHeight });
      return;
    }

    console.log(chalk.bold(`\nSolana Network Status (${chalk.cyan(resolveNetwork(options))}):\n`));
    console.log(`  ${chalk.gray("Cluster version:")} ${(version as any)["solana-core"] || JSON.stringify(version)}`);
    console.log(`  ${chalk.gray("Block height:")}    ${Number(blockHeight).toLocaleString()}`);
    console.log(`  ${chalk.gray("Current epoch:")}   ${epochInfo.epoch}`);
    console.log(`  ${chalk.gray("Current slot:")}    ${Number(epochInfo.absoluteSlot).toLocaleString()}`);
    console.log(`  ${chalk.gray("Slot index:")}      ${Number(epochInfo.slotIndex).toLocaleString()} / ${Number(epochInfo.slotsInEpoch).toLocaleString()}`);

    const progress = (Number(epochInfo.slotIndex) / Number(epochInfo.slotsInEpoch) * 100).toFixed(1);
    console.log(`  ${chalk.gray("Epoch progress:")} ${progress}%`);
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}
