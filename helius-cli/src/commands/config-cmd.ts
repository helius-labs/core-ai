import chalk from "chalk";
import { formatEnumLabel } from "../lib/formatters.js";
import { load, setApiKey, setNetwork, setProjectId, clearConfig } from "../lib/config.js";
import { outputJson, ExitCode, type OutputOptions } from "../lib/output.js";

export function configShowCommand(options: OutputOptions = {}): void {
  const config = load();
  if (options.json) {
    outputJson({
      apiKey: config.apiKey ? config.apiKey.slice(0, 8) + "..." : null,
      network: config.network || "mainnet",
      projectId: config.projectId || null,
      loggedIn: !!config.jwt,
    });
    return;
  }

  console.log(chalk.bold("\nHelius CLI Configuration:\n"));
  console.log(`  ${chalk.gray("API Key:")}     ${config.apiKey ? chalk.cyan(config.apiKey.slice(0, 8) + "...") : chalk.yellow("not set")}`);
  console.log(`  ${chalk.gray("Network:")}     ${chalk.cyan(formatEnumLabel(config.network || "mainnet"))}`);
  console.log(`  ${chalk.gray("Project ID:")}  ${config.projectId ? chalk.cyan(config.projectId) : chalk.yellow("not set")}`);
  console.log(`  ${chalk.gray("Logged in:")}   ${config.jwt ? chalk.green("yes") : chalk.yellow("no")}`);
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
    console.error(chalk.red(`Invalid network: ${network}. Use "mainnet" or "devnet".`));
    process.exit(ExitCode.GENERAL_ERROR);
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
