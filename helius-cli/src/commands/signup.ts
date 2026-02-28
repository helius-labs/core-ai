import chalk from "chalk";
import ora from "ora";
import { loadKeypairFromFile, getAddress } from "../lib/wallet.js";
import { agenticSignup, listProjects } from "../lib/api.js";
import { setJwt, setApiKey, setSharedApiKey, setProjectId, SHARED_CONFIG_PATH } from "../lib/config.js";
import { keypairExists, keygenCommand } from "./keygen.js";
import { formatEnumLabel } from "../lib/formatters.js";
import { outputJson, exitWithError, ExitCode, type OutputOptions } from "../lib/output.js";
import { checkSolBalance, checkUsdcBalance } from "helius-sdk/auth/checkBalances";

interface SignupOptions extends OutputOptions {
  keypair: string;
  plan?: string;
  period?: string;
  coupon?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
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
    // Auto-generate keypair if none exists
    if (!keypairExists(options.keypair)) {
      if (options.json) {
        // In JSON mode, don't do interactive keygen — just error
        exitWithError("KEYPAIR_NOT_FOUND", `Keypair not found at ${options.keypair}`, undefined, true);
      }
      console.log(chalk.yellow("No keypair found. Generating one automatically...\n"));
      await keygenCommand({ output: options.keypair });
      console.log();
    }

    // Load keypair
    spinner?.start("Loading keypair...");
    const keypair = await loadKeypairFromFile(options.keypair);
    const walletAddress = await getAddress(keypair);
    spinner?.succeed(`Wallet loaded: ${walletAddress}`);

    // Check balance before attempting payment
    spinner?.start("Checking wallet balance...");
    const solBalance = await checkSolBalance(walletAddress);
    const usdcBalance = await checkUsdcBalance(walletAddress);
    const solAmount = Number(solBalance) / 1_000_000_000;
    const usdcAmount = Number(usdcBalance) / 1_000_000;
    const solOk = solBalance >= 1_000_000n;    // ~0.001 SOL
    const usdcOk = usdcBalance >= 1_000_000n;  // 1 USDC minimum

    if (!solOk || !usdcOk) {
      spinner?.fail("Insufficient balance");
      const missing: string[] = [];
      if (!solOk) missing.push(`~0.001 SOL (have ${solAmount.toFixed(6)})`);
      if (!usdcOk) missing.push(`1 USDC (have ${usdcAmount.toFixed(2)})`);

      if (options.json) {
        exitWithError("INSUFFICIENT_FUNDS", `Need more funds: ${missing.join(", ")}`, undefined, true);
      }
      console.error(chalk.red(`\nInsufficient funds. Send the following to ${chalk.cyan(walletAddress)}:`));
      for (const m of missing) {
        console.error(`  • ${m}`);
      }
      console.error(chalk.gray("\nThen run `helius signup` again."));
      process.exit(!solOk ? ExitCode.INSUFFICIENT_SOL : ExitCode.INSUFFICIENT_USDC);
    }
    spinner?.succeed(`Balance OK: ${solAmount.toFixed(4)} SOL, ${usdcAmount.toFixed(2)} USDC`);

    // Run agenticSignup (handles all plan paths)
    const planLabel = options.plan || "basic";
    spinner?.start(`Signing up (${planLabel} plan)...`);

    const result = await agenticSignup({
      secretKey: keypair.secretKey,
      plan: options.plan,
      period: (options.period as "monthly" | "yearly") || undefined,
      couponCode: options.coupon,
      email: options.email,
      firstName: options.firstName,
      lastName: options.lastName,
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
    if (result.projectId) {
      setProjectId(result.projectId);
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
          console.log(`    Plan: ${formatEnumLabel(p.subscription.plan)}`);
        }
      }
      if (result.apiKey) {
        console.log(`\nAPI Key: ${chalk.cyan(result.apiKey)}`);
        console.log(chalk.green(`Saved to ${SHARED_CONFIG_PATH}`));
      }
      if (result.endpoints) {
        console.log(chalk.bold("\nRPC Endpoints:"));
        console.log(`  Mainnet: ${chalk.blue(result.endpoints.mainnet)}`);
        console.log(`  Devnet:  ${chalk.blue(result.endpoints.devnet)}`);
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
          `Transaction: ${chalk.blue(`https://orbmarkets.io/tx/${result.txSignature}`)}`
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
        `\nView transaction: ${chalk.blue(`https://orbmarkets.io/tx/${result.txSignature}`)}`
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
