import chalk from "chalk";
import ora from "ora";
import { resolveApiKey, resolveNetwork, getClient, type ResolveOptions } from "../lib/helius.js";
import { formatEnumLabel } from "../lib/formatters.js";
import { outputJson, exitWithError, handleCommandError, type OutputOptions } from "../lib/output.js";
import { validateSolanaAddresses } from "../lib/validation.js";

interface WebhookOptions extends OutputOptions, ResolveOptions {}

export async function webhookListCommand(options: WebhookOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const helius = getClient(apiKey, resolveNetwork(options));

    spinner?.start("Fetching webhooks...");
    const result = await helius.webhooks.getAll();
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
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const helius = getClient(apiKey, resolveNetwork(options));

    spinner?.start("Fetching webhook...");
    const result = await helius.webhooks.get(webhookId);
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
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const helius = getClient(apiKey, resolveNetwork(options));

    // Validate addresses before sending to API
    const addrErr = validateSolanaAddresses(options.accounts);
    if (addrErr) exitWithError("INVALID_INPUT", addrErr, undefined, options.json);

    const accountAddresses = options.accounts.split(",").map((s: string) => s.trim()).filter(Boolean);
    const transactionTypes = options.types.split(",").map((s: string) => s.trim()).filter(Boolean);
    const webhookType = (options.webhookType || "enhanced") as any;

    spinner?.start("Creating webhook...");
    const result = await helius.webhooks.create({
      webhookURL: options.url,
      accountAddresses,
      transactionTypes: transactionTypes as any,
      webhookType,
    });
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
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const helius = getClient(apiKey, resolveNetwork(options));

    const params: any = {};
    // Validate addresses if provided
    if (options.accounts) {
      const addrErr = validateSolanaAddresses(options.accounts);
      if (addrErr) exitWithError("INVALID_INPUT", addrErr, undefined, options.json);
    }
    if (options.url) params.webhookURL = options.url;
    if (options.accounts) params.accountAddresses = options.accounts.split(",").map((s: string) => s.trim()).filter(Boolean);
    if (options.types) params.transactionTypes = options.types.split(",").map((s: string) => s.trim()).filter(Boolean);

    spinner?.start("Updating webhook...");
    const result = await helius.webhooks.update(webhookId, params);
    spinner?.stop();

    if (options.json) { outputJson(result); return; }

    console.log(chalk.green(`\nWebhook ${webhookId} updated successfully!`));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function webhookDeleteCommand(webhookId: string, options: WebhookOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();
  try {
    spinner?.start("Resolving API key...");
    const apiKey = await resolveApiKey(options);
    const helius = getClient(apiKey, resolveNetwork(options));

    spinner?.start("Deleting webhook...");
    await helius.webhooks.delete(webhookId);
    spinner?.stop();

    if (options.json) { outputJson({ success: true, webhookID: webhookId }); return; }

    console.log(chalk.green(`\nWebhook ${webhookId} deleted successfully.`));
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}
