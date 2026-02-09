import chalk from "chalk";
import ora from "ora";
import { listProjects, getProject } from "../lib/api.js";
import { getJwt } from "../lib/config.js";
import { outputJson, exitWithError, ExitCode, type OutputOptions } from "../lib/output.js";

export async function rpcCommand(projectId?: string, options: OutputOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();

  try {
    const jwt = getJwt();
    if (!jwt) {
      if (options.json) {
        exitWithError("NOT_LOGGED_IN", "Not logged in", undefined, true);
      }
      console.log(
        chalk.red("Not logged in. Run `helius login` to authenticate, or `helius signup` to create a new account.")
      );
      process.exit(ExitCode.NOT_LOGGED_IN);
    }

    spinner?.start("Fetching projects...");
    const projects = await listProjects(jwt);
    spinner?.stop();

    if (projects.length === 0) {
      if (options.json) {
        exitWithError("NO_PROJECTS", "No projects found", undefined, true);
      }
      console.log(chalk.yellow("No projects found."));
      console.log(chalk.gray("Run `helius signup` to create your first project."));
      process.exit(ExitCode.NO_PROJECTS);
    }

    // If no project ID provided, try to get the only project
    let project;
    if (!projectId) {
      if (projects.length > 1) {
        if (options.json) {
          exitWithError("MULTIPLE_PROJECTS", "Multiple projects found, specify project ID", {
            projects: projects.map(p => ({ id: p.id, name: p.name })),
          }, true);
        }
        console.log(
          chalk.yellow(
            "Multiple projects found. Please specify a project ID."
          )
        );
        console.log("\nAvailable projects:");
        for (const p of projects) {
          console.log(`  ${chalk.cyan(p.id)} - ${p.name || "Unnamed"}`);
        }
        process.exit(ExitCode.MULTIPLE_PROJECTS);
      }
      project = projects[0];
    } else {
      project = projects.find(p => p.id === projectId);
      if (!project) {
        if (options.json) {
          exitWithError("PROJECT_NOT_FOUND", `Project ${projectId} not found`, undefined, true);
        }
        console.log(chalk.red(`Project ${projectId} not found.`));
        process.exit(ExitCode.PROJECT_NOT_FOUND);
      }
    }

    // Filter RPC records and group by network
    const rpcRecords = project.dnsRecords?.filter(r => r.usageType === "rpc") || [];

    // If no DNS records, show standard RPC URLs with API key
    if (rpcRecords.length === 0) {
      spinner?.start("Fetching API keys...");
      const fullProject = await getProject(jwt, project.id);
      spinner?.stop();

      if (!fullProject.apiKeys || fullProject.apiKeys.length === 0) {
        if (options.json) {
          exitWithError("NO_API_KEYS", "No API keys found", undefined, true);
        }
        console.log(chalk.yellow("No API keys found. Create one with `helius apikeys create`."));
        return;
      }

      const apiKey = fullProject.apiKeys[0].keyId;
      const endpoints = {
        mainnet: `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
        devnet: `https://devnet.helius-rpc.com/?api-key=${apiKey}`,
      };

      if (options.json) {
        outputJson({
          projectId: project.id,
          apiKey,
          endpoints,
        });
        return;
      }

      console.log(chalk.bold(`\nRPC Endpoints for project ${chalk.cyan(project.id)}:\n`));
      console.log(chalk.bold("Mainnet:"));
      console.log(`  ${chalk.blue(endpoints.mainnet)}`);
      console.log();
      console.log(chalk.bold("Devnet:"));
      console.log(`  ${chalk.blue(endpoints.devnet)}`);

      if (fullProject.apiKeys.length > 1) {
        console.log(chalk.gray(`\n(Using first API key. You have ${fullProject.apiKeys.length} keys available.)`));
      }
      return;
    }

    const mainnetRecords = rpcRecords.filter(r => r.network === "mainnet");
    const devnetRecords = rpcRecords.filter(r => r.network === "devnet");

    if (options.json) {
      const endpoints: Record<string, string[]> = {};
      if (mainnetRecords.length > 0) {
        endpoints.mainnet = mainnetRecords.map(r => "https://" + r.dns);
      }
      if (devnetRecords.length > 0) {
        endpoints.devnet = devnetRecords.map(r => "https://" + r.dns);
      }
      const otherRecords = rpcRecords.filter(r => r.network !== "mainnet" && r.network !== "devnet");
      for (const record of otherRecords) {
        if (!endpoints[record.network]) endpoints[record.network] = [];
        endpoints[record.network].push("https://" + record.dns);
      }
      outputJson({ projectId: project.id, endpoints });
      return;
    }

    console.log(chalk.bold(`\nRPC Endpoints for project ${chalk.cyan(project.id)}:\n`));

    if (mainnetRecords.length > 0) {
      console.log(chalk.bold("Mainnet:"));
      for (const record of mainnetRecords) {
        console.log(`  ${chalk.blue("https://" + record.dns)}`);
      }
    }

    if (devnetRecords.length > 0) {
      if (mainnetRecords.length > 0) console.log();
      console.log(chalk.bold("Devnet:"));
      for (const record of devnetRecords) {
        console.log(`  ${chalk.blue("https://" + record.dns)}`);
      }
    }

    // Show any other networks
    const otherRecords = rpcRecords.filter(r => r.network !== "mainnet" && r.network !== "devnet");
    for (const record of otherRecords) {
      console.log(chalk.bold(`\n${record.network}:`));
      console.log(`  ${chalk.blue("https://" + record.dns)}`);
    }
  } catch (error) {
    if (options.json) {
      exitWithError("API_ERROR", error instanceof Error ? error.message : String(error), undefined, true);
    }
    spinner?.fail(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(ExitCode.API_ERROR);
  }
}
