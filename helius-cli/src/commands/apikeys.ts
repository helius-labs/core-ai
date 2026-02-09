import chalk from "chalk";
import ora from "ora";
import { getProject, listProjects, createApiKey } from "../lib/api.js";
import { getJwt } from "../lib/config.js";
import { outputJson, exitWithError, ExitCode, type OutputOptions } from "../lib/output.js";

async function resolveProjectId(jwt: string, projectId?: string, json?: boolean): Promise<string> {
  if (projectId) {
    return projectId;
  }

  const projects = await listProjects(jwt);

  if (projects.length === 0) {
    if (json) {
      exitWithError("NO_PROJECTS", "No projects found", undefined, true);
    }
    throw new Error("No projects found. Run `helius signup` to create your first project.");
  }

  if (projects.length > 1) {
    if (json) {
      exitWithError("MULTIPLE_PROJECTS", "Multiple projects found, specify project ID", {
        projects: projects.map(p => ({ id: p.id, name: p.name })),
      }, true);
    }
    console.log(
      chalk.yellow("Multiple projects found. Please specify a project ID.")
    );
    console.log("\nAvailable projects:");
    for (const p of projects) {
      console.log(`  ${chalk.cyan(p.id)} - ${p.name || "Unnamed"}`);
    }
    process.exit(ExitCode.MULTIPLE_PROJECTS);
  }

  return projects[0].id;
}

interface ApikeysOptions extends OutputOptions {
}

export async function apikeysCommand(projectId?: string, options: ApikeysOptions = {}): Promise<void> {
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

    spinner?.start("Fetching API keys...");
    const id = await resolveProjectId(jwt, projectId, options.json);
    const project = await getProject(jwt, id);
    spinner?.stop();

    if (options.json) {
      outputJson({
        projectId: id,
        apiKeys: (project.apiKeys || []).map(k => ({
          keyId: k.keyId,
          keyName: k.keyName,
          createdAt: k.createdAt,
        })),
      });
      return;
    }

    if (!project.apiKeys || project.apiKeys.length === 0) {
      console.log(chalk.yellow("No API keys found for this project."));
      return;
    }

    console.log(chalk.bold(`\nAPI Keys for project ${chalk.cyan(id)}:\n`));
    console.log(
      chalk.gray("Key ID".padEnd(40)) +
      chalk.gray("Name".padEnd(20)) +
      chalk.gray("Created")
    );
    console.log(chalk.gray("-".repeat(70)));

    for (const key of project.apiKeys) {
      const createdAt = key.createdAt
        ? new Date(key.createdAt).toLocaleDateString()
        : "N/A";
      console.log(
        chalk.cyan(key.keyId.padEnd(40)) +
        (key.keyName || "Unnamed").padEnd(20) +
        createdAt
      );
    }

    console.log(
      `\n${chalk.gray(`Total: ${project.apiKeys.length} API key(s)`)}`
    );
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

interface CreateApiKeyOptions extends OutputOptions {
}

export async function createApiKeyCommand(projectId?: string, options: CreateApiKeyOptions = {}): Promise<void> {
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

    // Get wallet address from the first project's users (the owner)
    spinner?.start("Resolving project and wallet...");
    const projects = await listProjects(jwt);

    if (projects.length === 0) {
      if (options.json) {
        exitWithError("NO_PROJECTS", "No projects found", undefined, true);
      }
      spinner?.fail("No projects found.");
      process.exit(ExitCode.NO_PROJECTS);
    }

    const id = projectId || projects[0].id;
    const project = projects.find(p => p.id === id);

    if (!project) {
      if (options.json) {
        exitWithError("PROJECT_NOT_FOUND", `Project ${id} not found`, undefined, true);
      }
      spinner?.fail(`Project ${id} not found.`);
      process.exit(ExitCode.PROJECT_NOT_FOUND);
    }

    // Get wallet address from the project users (the owner)
    const owner = project.users?.find(u => u.role === "Owner");
    const walletAddress = owner?.id;

    if (!walletAddress) {
      if (options.json) {
        exitWithError("API_ERROR", "Could not determine wallet address from project", undefined, true);
      }
      spinner?.fail("Could not determine wallet address from project.");
      process.exit(ExitCode.API_ERROR);
    }

    if (spinner) spinner.text = "Creating API key...";
    const apiKey = await createApiKey(jwt, id, walletAddress);
    spinner?.succeed("API key created");

    if (options.json) {
      outputJson({
        projectId: id,
        keyId: apiKey.keyId,
        keyName: apiKey.keyName,
      });
      return;
    }

    console.log(`\nKey ID: ${chalk.cyan(apiKey.keyId)}`);
    if (apiKey.keyName) {
      console.log(`Name:   ${apiKey.keyName}`);
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
