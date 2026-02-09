import chalk from "chalk";
import ora from "ora";
import { getProject, listProjects } from "../lib/api.js";
import { getJwt } from "../lib/config.js";
import { outputJson, exitWithError, ExitCode, type OutputOptions } from "../lib/output.js";

export async function usageCommand(projectId?: string, options: OutputOptions = {}): Promise<void> {
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

    // If no project ID provided, try to get the only project
    let id = projectId;
    if (!id) {
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

      id = projects[0].id;
    }

    spinner?.start("Fetching usage data...");
    const project = await getProject(jwt, id);
    spinner?.stop();

    if (options.json) {
      outputJson({
        projectId: id,
        creditsUsage: project.creditsUsage || null,
        billingCycle: project.billingCycle || null,
      });
      return;
    }

    console.log(chalk.bold(`\nCredits Usage for project ${chalk.cyan(id)}:\n`));

    if (!project.creditsUsage) {
      console.log(chalk.yellow("No usage data available."));
      return;
    }

    const usage = project.creditsUsage;

    // Calculate total (remaining + used)
    const total = usage.remainingCredits + usage.totalCreditsUsed;
    const percentUsed = total > 0 ? ((usage.totalCreditsUsed / total) * 100).toFixed(1) : "0";

    console.log(`${chalk.gray("Total Credits:")}      ${chalk.cyan(total.toLocaleString())}`);
    console.log(`${chalk.gray("Used:")}               ${chalk.yellow(usage.totalCreditsUsed.toLocaleString())} (${percentUsed}%)`);
    console.log(`${chalk.gray("Remaining:")}          ${chalk.green(usage.remainingCredits.toLocaleString())}`);

    console.log(chalk.bold("\nBreakdown:"));
    console.log(`  ${chalk.gray("API:")}         ${usage.apiUsage.toLocaleString()}`);
    console.log(`  ${chalk.gray("RPC:")}         ${usage.rpcUsage.toLocaleString()}`);
    console.log(`  ${chalk.gray("RPC GPA:")}     ${usage.rpcGPAUsage.toLocaleString()}`);
    console.log(`  ${chalk.gray("Webhook:")}     ${usage.webhookUsage.toLocaleString()}`);

    if (usage.prepaidCreditsUsed > 0 || usage.remainingPrepaidCredits > 0) {
      console.log(chalk.bold("\nPrepaid Credits:"));
      console.log(`  ${chalk.gray("Used:")}       ${usage.prepaidCreditsUsed.toLocaleString()}`);
      console.log(`  ${chalk.gray("Remaining:")} ${usage.remainingPrepaidCredits.toLocaleString()}`);
    }

    if (usage.overageCreditsUsed > 0) {
      console.log(chalk.bold("\nOverage:"));
      console.log(`  ${chalk.gray("Credits Used:")} ${usage.overageCreditsUsed.toLocaleString()}`);
      console.log(`  ${chalk.gray("Cost:")}         $${usage.overageCost.toFixed(2)}`);
    }

    // Billing cycle
    if (project.billingCycle) {
      console.log(chalk.bold("\nBilling Cycle:"));
      console.log(`  ${project.billingCycle.start} to ${project.billingCycle.end}`);
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
