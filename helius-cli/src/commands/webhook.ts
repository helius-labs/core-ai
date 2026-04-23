import chalk from "chalk";
import { setupClient, type ResolveOptions } from "../lib/helius.js";
import { formatEnumLabel } from "../lib/formatters.js";
import { outputJson, exitWithError, handleCommandError, createSpinner, withRetry, type OutputOptions, type RetryOptions } from "../lib/output.js";
import { validateSolanaAddresses } from "../lib/validation.js";

interface WebhookOptions extends OutputOptions, ResolveOptions, RetryOptions {
  dryRun?: boolean;
}

export async function webhookListCommand(options: WebhookOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const helius = await setupClient(spinner, options, "Fetching webhooks...");
    const result = await withRetry(() => helius.webhooks.getAll(), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    const webhooks = Array.isArray(result) ? result : [];
    if (webhooks.length === 0) {
      console.log(chalk.yellow("\nNo webhooks found."));
      return;
    }

    console.log(chalk.bold(`\nWebhooks (${webhooks.length}):\n`));
    for (const wh of webhooks) {
      console.log(`  ${chalk.cyan(wh.webhookID)}`);
      console.log(`    ${chalk.gray("URL:")}   ${wh.webhookURL || "N/A"}`);
      console.log(`    ${chalk.gray("Type:")}  ${wh.webhookType ? formatEnumLabel(wh.webhookType) : "N/A"}`);
      console.log(`    ${chalk.gray("Addrs:")} ${(wh.accountAddresses || []).length} address(es)`);
      console.log(`    ${chalk.gray("Types:")} ${(wh.transactionTypes || []).map(formatEnumLabel).join(", ") || "ANY"}`);
      console.log();
    }
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function webhookGetCommand(webhookId: string, options: WebhookOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const helius = await setupClient(spinner, options, "Fetching webhook...");
    const result = await withRetry(() => helius.webhooks.get(webhookId), options, spinner) as any;
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    console.log(chalk.bold(`\nWebhook ${chalk.cyan(webhookId)}:\n`));
    console.log(`  ${chalk.gray("URL:")}      ${result.webhookURL || "N/A"}`);
    console.log(`  ${chalk.gray("Type:")}     ${result.webhookType ? formatEnumLabel(result.webhookType) : "N/A"}`);
    console.log(`  ${chalk.gray("Addresses:")}`);
    for (const addr of (result.accountAddresses || []).slice(0, 10)) {
      console.log(`    ${addr}`);
    }
    if ((result.accountAddresses || []).length > 10) {
      console.log(chalk.gray(`    ... and ${result.accountAddresses!.length - 10} more`));
    }
    console.log(`  ${chalk.gray("Tx Types:")} ${(result.transactionTypes || []).map(formatEnumLabel).join(", ") || "ANY"}`);
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function webhookCreateCommand(options: WebhookOptions & {
  url: string; accounts: string; types: string; webhookType?: string;
}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    // Validate addresses before sending to API
    const addrErr = validateSolanaAddresses(options.accounts);
    if (addrErr) exitWithError("INVALID_INPUT", addrErr, undefined, !!options.json);

    const accountAddresses = options.accounts.split(",").map((s: string) => s.trim()).filter(Boolean);
    const transactionTypes = options.types.split(",").map((s: string) => s.trim()).filter(Boolean);
    const webhookType = (options.webhookType || "enhanced") as any;

    if (options.dryRun) {
      spinner?.succeed("Dry run — webhook not created");
      const preview = { webhookURL: options.url, accountAddresses, transactionTypes, webhookType: options.webhookType || "enhanced" };
      if (options.json) { outputJson({ dryRun: true, ...preview }); return; }
      console.log(chalk.yellow("\n  Dry run — webhook would be created with:"));
      console.log(`    ${chalk.gray("URL:")}      ${preview.webhookURL}`);
      console.log(`    ${chalk.gray("Accounts:")} ${accountAddresses.length} address(es)`);
      console.log(`    ${chalk.gray("Types:")}    ${transactionTypes.join(", ")}`);
      console.log(`    ${chalk.gray("Type:")}     ${formatEnumLabel(preview.webhookType)}`);
      return;
    }

    const helius = await setupClient(spinner, options, "Creating webhook...");
    const result = await withRetry(() => helius.webhooks.create({
      webhookURL: options.url,
      accountAddresses,
      transactionTypes: transactionTypes as any,
      webhookType,
    }), options, spinner) as any;
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    console.log(chalk.green("\nWebhook created successfully!\n"));
    console.log(`  ${chalk.gray("ID:")}   ${chalk.cyan(result.webhookID)}`);
    console.log(`  ${chalk.gray("URL:")}  ${result.webhookURL}`);
    console.log(`  ${chalk.gray("Type:")} ${result.webhookType ? formatEnumLabel(result.webhookType) : "N/A"}`);
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function webhookUpdateCommand(webhookId: string, options: WebhookOptions & {
  url?: string; accounts?: string; types?: string;
}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const params: any = {};
    // Validate addresses if provided
    if (options.accounts) {
      const addrErr = validateSolanaAddresses(options.accounts);
      if (addrErr) exitWithError("INVALID_INPUT", addrErr, undefined, !!options.json);
    }
    if (options.url) params.webhookURL = options.url;
    if (options.accounts) params.accountAddresses = options.accounts.split(",").map((s: string) => s.trim()).filter(Boolean);
    if (options.types) params.transactionTypes = options.types.split(",").map((s: string) => s.trim()).filter(Boolean);

    if (options.dryRun) {
      spinner?.succeed("Dry run — webhook not updated");
      if (options.json) { outputJson({ dryRun: true, webhookID: webhookId, changes: params }); return; }
      console.log(chalk.yellow(`\n  Dry run — webhook ${webhookId} would be updated with:`));
      if (params.webhookURL) console.log(`    ${chalk.gray("URL:")}      ${params.webhookURL}`);
      if (params.accountAddresses) console.log(`    ${chalk.gray("Accounts:")} ${params.accountAddresses.length} address(es)`);
      if (params.transactionTypes) console.log(`    ${chalk.gray("Types:")}    ${params.transactionTypes.join(", ")}`);
      return;
    }

    const helius = await setupClient(spinner, options, "Updating webhook...");
    const result = await withRetry(() => helius.webhooks.update(webhookId, params), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    console.log(chalk.green(`\nWebhook ${webhookId} updated successfully!`));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function webhookDeleteCommand(webhookId: string, options: WebhookOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    if (options.dryRun) {
      spinner?.succeed("Dry run — webhook not deleted");
      if (options.json) { outputJson({ dryRun: true, webhookID: webhookId }); return; }
      console.log(chalk.yellow(`\n  Dry run — webhook ${webhookId} would be deleted.`));
      return;
    }

    const helius = await setupClient(spinner, options, "Deleting webhook...");
    await withRetry(() => helius.webhooks.delete(webhookId), options, spinner);
    spinner?.stop();

    if (options.json) { outputJson({ success: true, webhookID: webhookId }); return; }

    console.log(chalk.green(`\nWebhook ${webhookId} deleted successfully.`));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}
