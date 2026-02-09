import chalk from "chalk";
import ora from "ora";
import { listProjects } from "../lib/api.js";
import { getJwt } from "../lib/config.js";
import { outputJson, exitWithError, ExitCode, type OutputOptions } from "../lib/output.js";

export async function projectsCommand(options: OutputOptions): Promise<void> {
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

    if (options.json) {
      outputJson({
        projects: projects.map(p => ({
          id: p.id,
          name: p.name,
          plan: p.subscription?.plan || null,
          createdAt: p.createdAt,
        })),
      });
      return;
    }

    if (projects.length === 0) {
      console.log(chalk.yellow("No projects found."));
      console.log(chalk.gray("Run `helius signup` to create your first project."));
      return;
    }

    console.log(chalk.bold("\nProjects:\n"));
    console.log(
      chalk.gray("ID".padEnd(40)) +
      chalk.gray("Name".padEnd(25)) +
      chalk.gray("Plan".padEnd(10)) +
      chalk.gray("Created")
    );
    console.log(chalk.gray("-".repeat(95)));

    for (const project of projects) {
      const createdAt = project.createdAt
        ? new Date(project.createdAt).toLocaleDateString()
        : "N/A";
      const plan = project.subscription?.plan || "N/A";

      console.log(
        chalk.cyan(project.id.padEnd(40)) +
        (project.name || "Unnamed").padEnd(25) +
        plan.padEnd(10) +
        createdAt
      );
    }

    console.log(
      `\n${chalk.gray(`Total: ${projects.length} project(s)`)}`
    );

    // Show helpful commands with first project ID
    const firstProjectId = projects[0].id;
    console.log(chalk.gray(`\nRun \`helius apikeys ${firstProjectId}\` to view API keys`));
    console.log(chalk.gray(`Run \`helius rpc ${firstProjectId}\` to view RPC endpoints`));
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
