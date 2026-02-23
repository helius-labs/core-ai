import chalk from "chalk";
import ora from "ora";
import { loadKeypairFromFile } from "../lib/wallet.js";
import { agenticSignup, listProjects } from "../lib/api.js";
import { setJwt, setApiKey, setSharedApiKey, SHARED_CONFIG_PATH } from "../lib/config.js";
import { keypairExists } from "./keygen.js";
import { outputJson, exitWithError, ExitCode, type OutputOptions } from "../lib/output.js";

interface SignupOptions extends OutputOptions {
  keypair: string;
  plan?: string;
  period?: string;
  coupon?: string;
}

function mapErrorToExitCode(message: string): number {
  if (message.includes("Insufficient SOL")) return ExitCode.INSUFFICIENT_SOL;
  if (message.includes("Insufficient USDC")) return ExitCode.INSUFFICIENT_USDC;
  if (
    message.includes("Checkout failed") ||
    message.includes("Checkout expired") ||
    message.includes("Checkout timeout")
  ) return ExitCode.PAYMENT_FAILED;
  return ExitCode.GENERAL_ERROR;
}

export async function signupCommand(options: SignupOptions): Promise<void> {
  const spinner = options.json ? null : ora();

  try {
    // Check keypair exists
    if (!keypairExists(options.keypair)) {
      if (options.json) {
        exitWithError("KEYPAIR_NOT_FOUND", `Keypair not found at ${options.keypair}`, undefined, true);
      }
      console.error(chalk.red(`Error: Keypair not found at ${options.keypair}`));
      console.error(chalk.gray("Run `helius keygen` to generate a keypair first."));
      process.exit(ExitCode.KEYPAIR_NOT_FOUND);
    }

    // Load keypair
    spinner?.start("Loading keypair...");
    const keypair = await loadKeypairFromFile(options.keypair);
    spinner?.succeed("Wallet loaded");

    // Run agenticSignup (handles all plan paths)
    const planLabel = options.plan || "basic";
    spinner?.start(`Signing up (${planLabel} plan)...`);

    const result = await agenticSignup({
      secretKey: keypair.secretKey,
      plan: options.plan,
      period: (options.period as "monthly" | "yearly") || undefined,
      couponCode: options.coupon,
    });

    spinner?.succeed("Signup complete");

    // Save config
    if (result.jwt) {
      setJwt(result.jwt);
    }
    if (result.apiKey) {
      setApiKey(result.apiKey);
      setSharedApiKey(result.apiKey);
    }

    // Handle result statuses
    if (result.status === "existing_project") {
      // Show all projects for existing users
      const allProjects = await listProjects(result.jwt);

      if (options.json) {
        outputJson({
          status: "EXISTING_PROJECT",
          wallet: result.walletAddress,
          projectId: result.projectId,
          apiKey: result.apiKey,
          configPath: result.apiKey ? SHARED_CONFIG_PATH : null,
          endpoints: result.endpoints,
          credits: result.credits,
          projects: allProjects.map((p) => ({ id: p.id, name: p.name })),
        });
        return;
      }

      console.log("\n" + chalk.yellow("You already have project(s):"));
      for (const p of allProjects) {
        console.log(`  ${chalk.cyan(p.id)} - ${p.name}`);
        if (p.subscription) {
          console.log(`    Plan: ${p.subscription.plan}`);
        }
      }
      if (result.apiKey) {
        console.log(chalk.green(`\nAPI key saved to ${SHARED_CONFIG_PATH}`));
      }
      console.log(chalk.gray("\nNo payment required. Use `helius projects` to view details."));
      return;
    }

    if (result.status === "upgraded") {
      if (options.json) {
        outputJson({
          status: "UPGRADED",
          wallet: result.walletAddress,
          projectId: result.projectId,
          apiKey: result.apiKey,
          plan: planLabel,
          transaction: result.txSignature || null,
        });
        return;
      }

      console.log("\n" + chalk.green(`Plan upgraded to ${planLabel}!`));
      console.log(`\nProject ID: ${chalk.cyan(result.projectId)}`);
      if (result.txSignature) {
        console.log(
          `Transaction: ${chalk.blue(`https://solscan.io/tx/${result.txSignature}`)}`
        );
      }
      return;
    }

    // status === "success"
    if (options.json) {
      outputJson({
        status: "SUCCESS",
        wallet: result.walletAddress,
        projectId: result.projectId,
        apiKey: result.apiKey,
        configPath: result.apiKey ? SHARED_CONFIG_PATH : null,
        endpoints: result.endpoints,
        credits: result.credits,
        transaction: result.txSignature || null,
      });
      return;
    }

    console.log("\n" + chalk.green("Signup complete!"));
    console.log(`\nProject ID: ${chalk.cyan(result.projectId)}`);
    if (result.apiKey) {
      console.log(`API Key: ${chalk.cyan(result.apiKey)}`);
      console.log(chalk.green(`API key saved to ${SHARED_CONFIG_PATH}`));
    }
    if (result.endpoints) {
      console.log(chalk.bold("\nRPC Endpoints:"));
      console.log(`  Mainnet: ${chalk.blue(result.endpoints.mainnet)}`);
      console.log(`  Devnet:  ${chalk.blue(result.endpoints.devnet)}`);
    }
    if (result.txSignature) {
      console.log(
        `\nView transaction: ${chalk.blue(`https://solscan.io/tx/${result.txSignature}`)}`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exitCode = mapErrorToExitCode(message);

    if (options.json) {
      exitWithError("SIGNUP_FAILED", message, undefined, true);
    }
    spinner?.fail(`Error: ${message}`);
    process.exit(exitCode);
  }
}
