import chalk from "chalk";
import ora from "ora";
import { resolveApiKey, resolveNetwork, getClient, type ResolveOptions } from "../lib/helius.js";
import { outputJson, ExitCode, type OutputOptions } from "../lib/output.js";

interface NetworkOptions extends OutputOptions, ResolveOptions {}

export async function networkStatusCommand(options: NetworkOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start("Fetching network status...");
    const [epochInfo, version, blockHeight] = await Promise.all([
      helius.raw.getEpochInfo(),
      helius.raw.getVersion(),
      helius.raw.getBlockHeight(),
    ]);
    spinner?.stop();

    if (options.json) {
      outputJson({ network, epochInfo, version, blockHeight });
      return;
    }

    console.log(chalk.bold(`\nSolana Network Status (${chalk.cyan(network)}):\n`));
    console.log(`  ${chalk.gray("Cluster version:")} ${(version as any)["solana-core"] || JSON.stringify(version)}`);
    console.log(`  ${chalk.gray("Block height:")}    ${Number(blockHeight).toLocaleString()}`);
    console.log(`  ${chalk.gray("Current epoch:")}   ${epochInfo.epoch}`);
    console.log(`  ${chalk.gray("Current slot:")}    ${Number(epochInfo.absoluteSlot).toLocaleString()}`);
    console.log(`  ${chalk.gray("Slot index:")}      ${Number(epochInfo.slotIndex).toLocaleString()} / ${Number(epochInfo.slotsInEpoch).toLocaleString()}`);

    const progress = (Number(epochInfo.slotIndex) / Number(epochInfo.slotsInEpoch) * 100).toFixed(1);
    console.log(`  ${chalk.gray("Epoch progress:")} ${progress}%`);
  } catch (error) {
    spinner?.fail(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ExitCode.SDK_ERROR);
  }
}
