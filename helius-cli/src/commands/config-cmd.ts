import chalk from "chalk";
import { formatEnumLabel } from "../lib/formatters.js";
import { load, setApiKey, setNetwork, setProjectId, clearConfig } from "../lib/config.js";
import { outputJson, exitWithError, type OutputOptions } from "../lib/output.js";

interface ConfigShowOptions extends OutputOptions {
  reveal?: boolean;
}

export function configShowCommand(options: ConfigShowOptions = {}): void {
  const config = load();
  const displayKey = config.apiKey
    ? (options.reveal ? config.apiKey : config.apiKey.slice(0, 8) + "...")
    : null;

  if (options.json) {
    outputJson({
      apiKey: displayKey,
      network: config.network || "mainnet",
      projectId: config.projectId || null,
      loggedIn: !!config.jwt,
    });
    return;
  }

  console.log(chalk.bold("\nHelius CLI Configuration:\n"));
  console.log(`  ${chalk.gray("API Key:")}     ${displayKey ? chalk.cyan(displayKey) : chalk.yellow("not set")}`);
  console.log(`  ${chalk.gray("Network:")}     ${chalk.cyan(formatEnumLabel(config.network || "mainnet"))}`);
  console.log(`  ${chalk.gray("Project ID:")}  ${config.projectId ? chalk.cyan(config.projectId) : chalk.yellow("not set")}`);
  console.log(`  ${chalk.gray("Logged in:")}   ${config.jwt ? chalk.green("yes") : chalk.yellow("no")}`);
  if (config.apiKey && !options.reveal) {
    console.log(chalk.gray("\n  Use --reveal to show the full API key."));
  }
  console.log();
}

export function configSetApiKeyCommand(key: string, options: OutputOptions = {}): void {
  setApiKey(key);
  if (options.json) {
    outputJson({ success: true, apiKey: key.slice(0, 8) + "..." });
    return;
  }
  console.log(chalk.green(`API key set: ${key.slice(0, 8)}...`));
}

export function configSetNetworkCommand(network: string, options: OutputOptions = {}): void {
  if (network !== "mainnet" && network !== "devnet") {
    exitWithError("INVALID_INPUT", `Invalid network: ${network}. Use "mainnet" or "devnet".`, undefined, options.json);
  }
  const resolved = network as "mainnet" | "devnet";
  setNetwork(resolved);
  if (options.json) {
    outputJson({ success: true, network: resolved });
    return;
  }
  console.log(chalk.green(`Network set to: ${resolved}`));
}

export function configSetProjectCommand(projectId: string, options: OutputOptions = {}): void {
  setProjectId(projectId);
  if (options.json) {
    outputJson({ success: true, projectId });
    return;
  }
  console.log(chalk.green(`Project ID set to: ${projectId}`));
}

export function configClearCommand(options: OutputOptions = {}): void {
  clearConfig();
  if (options.json) {
    outputJson({ success: true });
    return;
  }
  console.log(chalk.green("Configuration cleared."));
}
