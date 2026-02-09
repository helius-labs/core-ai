import chalk from "chalk";
import ora from "ora";
import { getProject, listProjects } from "../lib/api.js";
import { getJwt } from "../lib/config.js";
import { outputJson, exitWithError, ExitCode, type OutputOptions } from "../lib/output.js";

export async function projectCommand(projectId?: string, options: OutputOptions = {}): Promise<void> {
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
    let projectListItem;
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
      projectListItem = projects[0];
    } else {
      // Get list item for metadata
      spinner?.start("Fetching projects...");
      const projects = await listProjects(jwt);
      projectListItem = projects.find(p => p.id === id);
      spinner?.stop();
    }

    spinner?.start("Fetching project details...");
    const projectDetails = await getProject(jwt, id);
    spinner?.stop();

    if (options.json) {
      // Build RPC endpoints
      const rpcRecords = projectListItem?.dnsRecords?.filter(r => r.usageType === "rpc") || [];
      const endpoints: Record<string, string> = {};

      if (rpcRecords.length === 0 && projectDetails.apiKeys && projectDetails.apiKeys.length > 0) {
        const apiKey = projectDetails.apiKeys[0].keyId;
        endpoints.mainnet = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
        endpoints.devnet = `https://devnet.helius-rpc.com/?api-key=${apiKey}`;
      } else {
        for (const record of rpcRecords) {
          endpoints[record.network] = "https://" + record.dns;
        }
      }

      outputJson({
        id,
        name: projectListItem?.name || null,
        createdAt: projectListItem?.createdAt || null,
        subscription: projectListItem?.subscription ? {
          plan: projectListItem.subscription.plan,
          billingPeriodStart: projectListItem.subscription.billingPeriodStart,
          billingPeriodEnd: projectListItem.subscription.billingPeriodEnd,
        } : null,
        apiKeys: (projectDetails.apiKeys || []).map(k => ({
          keyId: k.keyId,
          keyName: k.keyName,
          usagePlan: k.usagePlan,
        })),
        creditsUsage: projectDetails.creditsUsage || null,
        billingCycle: projectDetails.billingCycle || null,
        endpoints,
      });
      return;
    }

    console.log(chalk.bold("\nProject Details:\n"));
    console.log(`${chalk.gray("ID:")}          ${chalk.cyan(id)}`);
    console.log(`${chalk.gray("Name:")}        ${projectListItem?.name || "Unnamed"}`);
    console.log(`${chalk.gray("Created:")}     ${projectListItem?.createdAt ? new Date(projectListItem.createdAt).toLocaleString() : "N/A"}`);

    // Subscription info
    if (projectListItem?.subscription) {
      console.log(chalk.bold("\nSubscription:"));
      console.log(`  ${chalk.gray("Plan:")}        ${projectListItem.subscription.plan}`);
      console.log(`  ${chalk.gray("Period:")}      ${projectListItem.subscription.billingPeriodStart?.split('T')[0] || 'N/A'} - ${projectListItem.subscription.billingPeriodEnd?.split('T')[0] || 'N/A'}`);
    }

    // API Keys
    if (projectDetails.apiKeys && projectDetails.apiKeys.length > 0) {
      console.log(chalk.bold("\nAPI Keys:"));
      for (const key of projectDetails.apiKeys) {
        console.log(`  ${chalk.cyan(key.keyId)} - ${key.keyName || "Unnamed"} (${key.usagePlan})`);
      }
    }

    // Credits Usage
    if (projectDetails.creditsUsage) {
      const usage = projectDetails.creditsUsage;
      console.log(chalk.bold("\nCredits Usage:"));
      console.log(`  ${chalk.gray("Total Used:")}        ${chalk.yellow(usage.totalCreditsUsed.toLocaleString())}`);
      console.log(`  ${chalk.gray("Remaining:")}         ${chalk.green(usage.remainingCredits.toLocaleString())}`);
      console.log(`  ${chalk.gray("API Usage:")}         ${usage.apiUsage.toLocaleString()}`);
      console.log(`  ${chalk.gray("RPC Usage:")}         ${usage.rpcUsage.toLocaleString()}`);
      console.log(`  ${chalk.gray("Webhook Usage:")}     ${usage.webhookUsage.toLocaleString()}`);
    }

    // Billing Cycle
    if (projectDetails.billingCycle) {
      console.log(chalk.bold("\nBilling Cycle:"));
      console.log(`  ${projectDetails.billingCycle.start} to ${projectDetails.billingCycle.end}`);
    }

    // RPC Endpoints from dnsRecords
    if (projectListItem?.dnsRecords && projectListItem.dnsRecords.length > 0) {
      console.log(chalk.bold("\nRPC Endpoints:"));
      for (const record of projectListItem.dnsRecords) {
        if (record.usageType === "rpc") {
          console.log(`  ${chalk.gray(record.network + ":")}  ${chalk.blue("https://" + record.dns)}`);
        }
      }
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
