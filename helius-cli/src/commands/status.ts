import chalk from "chalk";
import ora from "ora";
import { listProjects, getProject } from "../lib/api.js";
import { getJwt } from "../lib/config.js";
import { formatEnumLabel } from "../lib/formatters.js";
import { outputJson, exitWithError, ExitCode, handleCommandError, type OutputOptions } from "../lib/output.js";

export async function statusCommand(options: OutputOptions = {}): Promise<void> {
  const spinner = options.json ? null : ora();

  try {
    const jwt = getJwt();
    if (!jwt) {
      exitWithError("NOT_LOGGED_IN", "Not logged in. Run `helius login` or `helius signup` first.", undefined, options.json);
    }

    spinner?.start("Fetching account status...");
    const projects = await listProjects(jwt);
    if (projects.length === 0) {
      exitWithError("NO_PROJECTS", "No projects found. Run `helius signup` to create an account.", undefined, options.json);
    }

    const project = projects[0];
    const details = await getProject(jwt, project.id);
    spinner?.stop();

    const plan = details.subscriptionPlanDetails?.currentPlan ?? "unknown";
    const upcomingPlan = details.subscriptionPlanDetails?.upcomingPlan;
    const isUpgrading = details.subscriptionPlanDetails?.isUpgrading ?? false;
    const usage = details.creditsUsage;
    const cycle = details.billingCycle;

    // Compute billing cycle metadata
    let daysLeft: number | null = null;
    let projectedOverage: number | null = null;
    if (cycle) {
      const end = new Date(cycle.end);
      const start = new Date(cycle.start);
      const now = new Date();
      daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (usage && daysLeft > 0) {
        const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        const elapsedDays = totalDays - daysLeft;
        if (elapsedDays > 0) {
          const total = usage.remainingCredits + usage.totalCreditsUsed;
          const projectedTotal = Math.round((usage.totalCreditsUsed / elapsedDays) * totalDays);
          if (projectedTotal > total) {
            projectedOverage = projectedTotal - total;
          }
        }
      }
    }

    if (options.json) {
      const total = usage ? usage.remainingCredits + usage.totalCreditsUsed : null;
      outputJson({
        plan: formatEnumLabel(plan),
        projectId: project.id,
        projectName: project.name || null,
        upcomingPlan: isUpgrading && upcomingPlan && upcomingPlan !== plan ? upcomingPlan : null,
        credits: usage ? {
          total,
          used: usage.totalCreditsUsed,
          remaining: usage.remainingCredits,
          breakdown: {
            api: usage.apiUsage,
            rpc: usage.rpcUsage,
            rpcGpa: usage.rpcGPAUsage,
            webhooks: usage.webhookUsage,
          },
          overage: usage.overageCreditsUsed > 0 ? {
            credits: usage.overageCreditsUsed,
            cost: usage.overageCost,
          } : null,
          prepaid: (usage.remainingPrepaidCredits > 0 || usage.prepaidCreditsUsed > 0) ? {
            remaining: usage.remainingPrepaidCredits,
            used: usage.prepaidCreditsUsed,
          } : null,
        } : null,
        billingCycle: cycle ? {
          start: cycle.start,
          end: cycle.end,
          daysRemaining: daysLeft,
        } : null,
        projectedOverage,
      });
      return;
    }

    // ── Plan ──
    console.log(chalk.bold("\nAccount Status\n"));
    console.log(`${chalk.gray("Plan:")}       ${chalk.cyan(formatEnumLabel(plan))}`);
    console.log(`${chalk.gray("Project:")}    ${chalk.cyan(project.id)}`);
    if (project.name) {
      console.log(`${chalk.gray("Name:")}       ${project.name}`);
    }
    if (isUpgrading && upcomingPlan && upcomingPlan !== plan) {
      console.log(`${chalk.gray("Upcoming:")}   ${chalk.yellow(formatEnumLabel(upcomingPlan))} (next billing cycle)`);
    }

    // ── Credits ──
    if (usage) {
      const total = usage.remainingCredits + usage.totalCreditsUsed;
      const pctRemaining = total > 0 ? ((usage.remainingCredits / total) * 100).toFixed(1) : "100.0";
      const pctUsed = total > 0 ? ((usage.totalCreditsUsed / total) * 100).toFixed(1) : "0.0";

      const cycleLabel = cycle && daysLeft !== null
        ? ` (resets ${cycle.end}, ${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining)`
        : "";

      console.log(chalk.bold(`\nCredits${cycleLabel}:`));
      console.log(`  ${chalk.gray("Remaining:")}  ${chalk.green(usage.remainingCredits.toLocaleString())} / ${total.toLocaleString()}  (${pctRemaining}%)`);
      console.log(`  ${chalk.gray("Used:")}       ${chalk.yellow(usage.totalCreditsUsed.toLocaleString())}  (${pctUsed}%)`);
      console.log(`    ${chalk.gray("API:")}       ${usage.apiUsage.toLocaleString()}`);
      console.log(`    ${chalk.gray("RPC:")}       ${usage.rpcUsage.toLocaleString()}`);
      if (usage.rpcGPAUsage > 0) {
        console.log(`    ${chalk.gray("RPC GPA:")}   ${usage.rpcGPAUsage.toLocaleString()}`);
      }
      console.log(`    ${chalk.gray("Webhooks:")}  ${usage.webhookUsage.toLocaleString()}`);

      if (usage.overageCreditsUsed > 0) {
        console.log(`  ${chalk.gray("Overage:")}   ${chalk.red(usage.overageCreditsUsed.toLocaleString())} credits  ($${usage.overageCost.toFixed(2)})`);
      }

      if (usage.remainingPrepaidCredits > 0 || usage.prepaidCreditsUsed > 0) {
        console.log(`  ${chalk.gray("Prepaid:")}   ${usage.remainingPrepaidCredits.toLocaleString()} remaining  (${usage.prepaidCreditsUsed.toLocaleString()} used)`);
      }

      // Burn-rate warning
      if (projectedOverage !== null) {
        const overageM = (projectedOverage / 1_000_000).toFixed(1);
        console.log(chalk.yellow(`\n  Warning: At current burn rate, projected to exceed limit by ~${overageM}M credits this cycle.`));
      }

      // Low-credit warning
      if (parseFloat(pctRemaining) < 20) {
        console.log(chalk.yellow(`\n  Warning: Less than 20% of credits remaining. Run \`helius upgrade\` to see upgrade options.`));
      }
    }

    // ── Billing Cycle ──
    if (cycle) {
      console.log(chalk.bold("\nBilling Cycle:"));
      console.log(`  ${cycle.start} to ${cycle.end}`);
    }

    console.log();
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}
