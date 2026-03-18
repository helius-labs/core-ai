import chalk from "chalk";
import { resolveApiKey, resolveNetwork, getClient, type ResolveOptions } from "../lib/helius.js";
import { formatTimestamp } from "../lib/formatters.js";
import { outputJson, handleCommandError, createSpinner, type OutputOptions } from "../lib/output.js";

interface BlockOptions extends OutputOptions, ResolveOptions {}

export async function blockCommand(slot: string, options: BlockOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);

    spinner?.start(`Fetching block at slot ${slot}...`);
    const slotNum = BigInt(slot);
    const result = await helius.raw.getBlock(slotNum, {
      maxSupportedTransactionVersion: 0,
      transactionDetails: "signatures",
    });
    spinner?.stop();

    if (options.json) {
      outputJson(result);
      return;
    }

    if (!result) {
      console.log(chalk.yellow(`\nBlock at slot ${slot} not found.`));
      return;
    }

    const block = result as any;
    console.log(chalk.bold(`\nBlock at slot ${chalk.cyan(slot)}:\n`));
    console.log(`  ${chalk.gray("Blockhash:")}       ${block.blockhash || "N/A"}`);
    console.log(`  ${chalk.gray("Parent slot:")}     ${block.parentSlot ?? "N/A"}`);
    console.log(`  ${chalk.gray("Block time:")}      ${block.blockTime ? formatTimestamp(Number(block.blockTime)) : "N/A"}`);
    console.log(`  ${chalk.gray("Block height:")}    ${block.blockHeight != null ? Number(block.blockHeight).toLocaleString() : "N/A"}`);

    const txCount = block.signatures?.length ?? block.transactions?.length ?? "N/A";
    console.log(`  ${chalk.gray("Transactions:")}    ${txCount}`);

    if (block.rewards?.length) {
      const totalRewards = block.rewards.reduce((sum: number, r: any) => sum + Number(r.lamports || 0), 0);
      console.log(`  ${chalk.gray("Total rewards:")}   ${(totalRewards / 1e9).toFixed(4)} SOL`);
    }
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}
