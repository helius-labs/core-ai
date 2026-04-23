import chalk from "chalk";
import { setupClient, type ResolveOptions } from "../lib/helius.js";
import { formatTimestamp } from "../lib/formatters.js";
import { outputJson, exitWithError, handleCommandError, createSpinner, withRetry, type OutputOptions, type RetryOptions } from "../lib/output.js";
import { validateSlot } from "../lib/validation.js";

interface BlockOptions extends OutputOptions, ResolveOptions, RetryOptions {}

export async function blockCommand(slot: string, options: BlockOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const slotErr = validateSlot(slot);
    if (slotErr) exitWithError("INVALID_INPUT", slotErr, undefined, !!options.json);
    const helius = await setupClient(spinner, options, `Fetching block at slot ${slot}...`);
    const slotNum = BigInt(slot);
    const result = await withRetry(() => helius.raw.getBlock(slotNum, {
      maxSupportedTransactionVersion: 0,
      transactionDetails: "signatures",
    }), options, spinner);
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
