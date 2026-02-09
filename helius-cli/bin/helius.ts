#!/usr/bin/env node
import { Command } from "commander";
import { signupCommand } from "../src/commands/signup.js";
import { loginCommand } from "../src/commands/login.js";
import { projectsCommand } from "../src/commands/projects.js";
import { projectCommand } from "../src/commands/project.js";
import { apikeysCommand, createApiKeyCommand } from "../src/commands/apikeys.js";
import { usageCommand } from "../src/commands/usage.js";
import { rpcCommand } from "../src/commands/rpc.js";
import { keygenCommand, getDefaultKeypairPath } from "../src/commands/keygen.js";
import { VERSION } from "../src/constants.js";

const program = new Command();

program
  .name("helius")
  .description("CLI to create free Helius accounts and manage projects")
  .version(VERSION);

program
  .command("keygen")
  .description("Generate a new Solana keypair")
  .option("-o, --output <path>", "Output path for keypair", getDefaultKeypairPath())
  .option("-f, --force", "Overwrite existing keypair")
  .action(keygenCommand);

program
  .command("signup")
  .description("Pay 1 USDC + create account + project")
  .option("-k, --keypair <path>", "Path to Solana keypair file", getDefaultKeypairPath())
  .option("--json", "Output in JSON format")
  .action(signupCommand);

program
  .command("login")
  .description("Authenticate with wallet")
  .option("-k, --keypair <path>", "Path to Solana keypair file", getDefaultKeypairPath())
  .option("--json", "Output in JSON format")
  .action(loginCommand);

program
  .command("projects")
  .description("List all projects")
  .option("--json", "Output in JSON format")
  .action(projectsCommand);

program
  .command("project [id]")
  .description("Get project details")
  .option("--json", "Output in JSON format")
  .action(projectCommand);

// API Keys command with subcommands
const apikeysCmd = program
  .command("apikeys [project-id]")
  .description("List all API keys for project (or use 'apikeys create')")
  .option("--json", "Output in JSON format");

apikeysCmd
  .command("create [project-id]")
  .description("Create new API key for project")
  .option("--json", "Output in JSON format")
  .action(function(projectId) {
    // @ts-ignore - Commander passes options via this
    createApiKeyCommand(projectId, { json: this.opts().json || process.argv.includes("--json") });
  });

// Default action for 'apikeys' (list)
apikeysCmd.action(apikeysCommand);

program
  .command("usage [project-id]")
  .description("Show credits usage for project")
  .option("--json", "Output in JSON format")
  .action(usageCommand);

program
  .command("rpc [project-id]")
  .description("Show RPC endpoints for project")
  .option("--json", "Output in JSON format")
  .action(rpcCommand);

program.parse();
