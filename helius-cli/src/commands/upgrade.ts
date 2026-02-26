import chalk from "chalk";
import ora from "ora";
import { loadKeypairFromFile, signAuthMessage, getAddress } from "../lib/wallet.js";
import { signup, listProjects, getProject } from "../lib/api.js";
import { getCheckoutPreview, executeCheckout, PLAN_CATALOG } from "../lib/checkout.js";
import { setJwt } from "../lib/config.js";
import { keypairExists, getDefaultKeypairPath } from "./keygen.js";
import { outputJson, exitWithError, ExitCode, type OutputOptions } from "../lib/output.js";
import readline from "readline";

interface UpgradeOptions extends OutputOptions {
  keypair: string;
  plan: string;
  period: "monthly" | "yearly";
  coupon?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  yes?: boolean;
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

export async function upgradeCommand(options: UpgradeOptions): Promise<void> {
  const spinner = options.json ? null : ora();

  try {
    // Validate plan name
    const planKey = options.plan.toLowerCase();
    if (!PLAN_CATALOG[planKey]) {
      const available = Object.keys(PLAN_CATALOG).join(", ");
      if (options.json) {
        exitWithError("API_ERROR", `Unknown plan: ${options.plan}. Available: ${available}`, undefined, true);
      }
      console.error(chalk.red(`Unknown plan: ${options.plan}`));
      console.error(chalk.gray(`Available plans: ${available}`));
      process.exit(ExitCode.GENERAL_ERROR);
    }

    // All-or-none customer info validation
    const hasAnyCustomerInfo = options.email || options.firstName || options.lastName;
    if (hasAnyCustomerInfo && (!options.email || !options.firstName || !options.lastName)) {
      const missing = [
        !options.email && "email",
        !options.firstName && "firstName",
        !options.lastName && "lastName",
      ].filter(Boolean);
      const msg = `Partial customer info provided. If any of --email/--first-name/--last-name is given, all three are required. Missing: ${missing.join(", ")}`;
      if (options.json) {
        exitWithError("VALIDATION_ERROR", msg, undefined, true);
      }
      console.error(chalk.red(msg));
      process.exit(ExitCode.GENERAL_ERROR);
    }

    // Basic email format validation
    if (options.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.email)) {
      const msg = `Invalid email format: ${options.email}`;
      if (options.json) {
        exitWithError("VALIDATION_ERROR", msg, undefined, true);
      }
      console.error(chalk.red(msg));
      process.exit(ExitCode.GENERAL_ERROR);
    }

    // Check keypair exists
    if (!keypairExists(options.keypair)) {
      if (options.json) {
        exitWithError("KEYPAIR_NOT_FOUND", `Keypair not found at ${options.keypair}`, undefined, true);
      }
      console.error(chalk.red(`Error: Keypair not found at ${options.keypair}`));
      console.error(chalk.gray("Run `helius keygen` to generate a keypair first."));
      process.exit(ExitCode.KEYPAIR_NOT_FOUND);
    }

    // 1. Load keypair and authenticate
    spinner?.start("Loading keypair...");
    const keypair = await loadKeypairFromFile(options.keypair);
    const walletAddress = await getAddress(keypair);
    spinner?.succeed(`Wallet: ${chalk.cyan(walletAddress)}`);

    spinner?.start("Authenticating...");
    const { message, signature } = await signAuthMessage(keypair.secretKey);
    const authResult = await signup(message, signature, walletAddress);
    setJwt(authResult.token);
    spinner?.succeed("Authenticated");

    // 2. Get project
    spinner?.start("Fetching project...");
    const projects = await listProjects(authResult.token);
    if (projects.length === 0) {
      if (options.json) {
        exitWithError("NO_PROJECTS", "No projects found. Run `helius signup` first.", undefined, true);
      }
      spinner?.fail("No projects found");
      console.error(chalk.gray("Run `helius signup` to create an account first."));
      process.exit(ExitCode.NO_PROJECTS);
    }
    const project = projects[0];
    const projectDetails = await getProject(authResult.token, project.id);
    const currentPlan = projectDetails.subscriptionPlanDetails?.currentPlan || "unknown";
    spinner?.succeed(`Project: ${chalk.cyan(project.id)}`);

    // 3. Preview pricing
    spinner?.start("Fetching upgrade pricing...");
    const preview = await getCheckoutPreview(authResult.token, planKey, options.period, project.id, options.coupon);
    spinner?.succeed("Pricing loaded");

    if (options.json && !options.yes) {
      outputJson({
        action: "preview",
        currentPlan,
        targetPlan: preview.planName,
        period: preview.period,
        baseAmount: preview.baseAmount,
        subtotal: preview.subtotal,
        appliedCredits: preview.appliedCredits,
        proratedCredits: preview.proratedCredits,
        discounts: preview.discounts,
        dueToday: preview.dueToday,
        coupon: preview.coupon,
      });
      return;
    }

    // 4. Show pricing and confirm
    if (!options.json) {
      console.log("");
      console.log(`  Current plan:     ${chalk.yellow(currentPlan)}`);
      console.log(`  Upgrade to:       ${chalk.green(preview.planName)} (${preview.period})`);
      console.log("");
      console.log(`  Subtotal:         $${(preview.subtotal / 100).toFixed(2)}`);
      if (preview.proratedCredits > 0) {
        console.log(`  Prorated credit:  ${chalk.green(`-$${(preview.proratedCredits / 100).toFixed(2)}`)}`);
      }
      if (preview.appliedCredits > 0) {
        console.log(`  Applied credits:  ${chalk.green(`-$${(preview.appliedCredits / 100).toFixed(2)}`)}`);
      }
      if (preview.discounts > 0) {
        console.log(`  Discounts:        ${chalk.green(`-$${(preview.discounts / 100).toFixed(2)}`)}`);
      }
      if (preview.coupon?.valid) {
        console.log(`  Coupon:           ${chalk.green(preview.coupon.description || preview.coupon.code)}`);
      }
      console.log(`  ${chalk.bold(`Due today:        $${(preview.dueToday / 100).toFixed(2)}`)}`);
      console.log("");
    }

    if (!options.yes) {
      const ok = await confirm("  Proceed with upgrade? (y/N) ");
      if (!ok) {
        console.log(chalk.gray("  Cancelled."));
        return;
      }
    }

    // 5. Execute upgrade
    spinner?.start("Processing upgrade payment...");
    const result = await executeCheckout(
      keypair.secretKey,
      authResult.token,
      {
        plan: planKey,
        period: options.period,
        refId: project.id,
        couponCode: options.coupon,
        email: options.email,
        firstName: options.firstName,
        lastName: options.lastName,
      },
      { skipProjectPolling: true },
    );

    if (result.status !== "completed") {
      throw new Error(
        `Upgrade ${result.status}${result.txSignature ? `. TX: ${result.txSignature}` : ""}`
      );
    }
    spinner?.succeed("Upgrade complete");

    if (options.json) {
      outputJson({
        status: "SUCCESS",
        previousPlan: currentPlan,
        newPlan: preview.planName,
        period: preview.period,
        amountPaid: preview.dueToday,
        transaction: result.txSignature,
        projectId: project.id,
      });
      return;
    }

    console.log("\n" + chalk.green(`✓ Upgraded to ${preview.planName}!`));
    if (result.txSignature) {
      console.log(`\nView transaction: ${chalk.blue(`https://orbmarkets.io/tx/${result.txSignature}`)}`);
    }
  } catch (error) {
    if (options.json) {
      exitWithError("PAYMENT_FAILED", error instanceof Error ? error.message : String(error), undefined, true);
    }
    spinner?.fail(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(ExitCode.GENERAL_ERROR);
  }
}
