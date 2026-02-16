import chalk from "chalk";
import ora from "ora";
import { loadKeypairFromFile, signAuthMessage, getAddress } from "../lib/wallet.js";
import { signup, listProjects, getProject } from "../lib/api.js";
import { checkSolBalance, MIN_SOL_FOR_TX } from "../lib/payment.js";
import { checkUsdcBalance } from "../lib/payment.js";
import { initializeCheckout, pollCheckoutCompletion } from "../lib/checkout.js";
import { payWithMemo } from "../lib/checkout.js";
import { setJwt, setApiKey, setSharedApiKey, SHARED_CONFIG_PATH } from "../lib/config.js";
import { keypairExists } from "./keygen.js";
import { outputJson, exitWithError, ExitCode, type OutputOptions } from "../lib/output.js";

interface SignupOptions extends OutputOptions {
  keypair: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

    // 1. Load keypair
    spinner?.start("Loading keypair...");
    const keypair = await loadKeypairFromFile(options.keypair);
    const walletAddress = await getAddress(keypair);
    spinner?.succeed(`Wallet: ${chalk.cyan(walletAddress)}`);

    // 2. Authenticate first (no payment yet)
    spinner?.start("Signing authentication message...");
    const { message, signature } = signAuthMessage(keypair.secretKey);
    spinner?.succeed("Message signed");

    spinner?.start("Authenticating...");
    const authResult = await signup(message, signature, walletAddress);
    setJwt(authResult.token);
    spinner?.succeed(authResult.newUser ? "Account created" : "Authenticated");

    // 3. Check existing projects BEFORE payment
    spinner?.start("Checking existing projects...");
    const existingProjects = await listProjects(authResult.token);

    if (existingProjects.length > 0) {
      // User already has projects - no payment needed
      spinner?.succeed("Found existing project(s)");

      // Fetch full details to get API key
      const project = existingProjects[0];
      const projectDetails = await getProject(authResult.token, project.id);
      const apiKey = projectDetails.apiKeys?.[0]?.keyId || null;

      if (apiKey) {
        setApiKey(apiKey);
        setSharedApiKey(apiKey);
      }

      if (options.json) {
        outputJson({
          status: "EXISTING_PROJECT",
          wallet: walletAddress,
          projectId: project.id,
          projectName: project.name,
          apiKey,
          configPath: apiKey ? SHARED_CONFIG_PATH : null,
          endpoints: apiKey ? {
            mainnet: `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
            devnet: `https://devnet.helius-rpc.com/?api-key=${apiKey}`,
          } : null,
          credits: projectDetails.creditsUsage?.remainingCredits || null,
        });
        return;
      }

      console.log("\n" + chalk.yellow("You already have project(s):"));
      for (const p of existingProjects) {
        console.log(`  ${chalk.cyan(p.id)} - ${p.name}`);
        if (p.subscription) {
          console.log(`    Plan: ${p.subscription.plan}`);
        }
      }
      if (apiKey) {
        console.log(chalk.green(`\nAPI key saved to ${SHARED_CONFIG_PATH}`));
      }
      console.log(chalk.gray("\nNo payment required. Use `helius projects` to view details."));
      return;
    }

    spinner?.succeed("No existing projects");

    // 4. Initialize checkout
    spinner?.start("Initializing checkout...");
    const intent = await initializeCheckout(authResult.token, { paymentType: "subscription" });
    spinner?.succeed("Checkout initialized");

    // 5. Check balances against intent amount
    const amountRaw = BigInt(Math.round(intent.amount * 1_000_000));

    spinner?.start("Checking SOL balance...");
    const solBalance = await checkSolBalance(walletAddress);
    if (solBalance < MIN_SOL_FOR_TX) {
      if (options.json) {
        exitWithError("INSUFFICIENT_SOL", "Insufficient SOL for transaction fees", {
          have: Number(solBalance) / 1_000_000_000,
          need: 0.001,
          fundAddress: walletAddress,
        }, true);
      }
      spinner?.fail(`Insufficient SOL for transaction fees`);
      console.error(chalk.red(`Have: ${(Number(solBalance) / 1_000_000_000).toFixed(6)} SOL`));
      console.error(chalk.red(`Need: ~0.001 SOL`));
      console.error(chalk.gray(`\nSend SOL to: ${walletAddress}`));
      process.exit(ExitCode.INSUFFICIENT_SOL);
    }
    spinner?.succeed(`SOL balance: ${chalk.green((Number(solBalance) / 1_000_000_000).toFixed(4))} SOL`);

    spinner?.start("Checking USDC balance...");
    const usdcBalance = await checkUsdcBalance(walletAddress);
    if (usdcBalance < amountRaw) {
      if (options.json) {
        exitWithError("INSUFFICIENT_USDC", "Insufficient USDC", {
          have: Number(usdcBalance) / 1_000_000,
          need: intent.amount,
          fundAddress: walletAddress,
        }, true);
      }
      spinner?.fail(`Insufficient USDC`);
      console.error(chalk.red(`Have: ${(Number(usdcBalance) / 1_000_000).toFixed(2)} USDC`));
      console.error(chalk.red(`Need: ${intent.amount} USDC`));
      console.error(chalk.gray(`\nSend USDC to: ${walletAddress}`));
      process.exit(ExitCode.INSUFFICIENT_USDC);
    }
    spinner?.succeed(`USDC balance: ${chalk.green((Number(usdcBalance) / 1_000_000).toFixed(2))} USDC`);

    // 6. Send payment with memo
    spinner?.start(`Sending ${intent.amount} USDC payment...`);
    const txSignature = await payWithMemo(keypair.secretKey, intent.treasuryWallet, amountRaw, intent.memo);
    spinner?.succeed(`Payment sent: ${chalk.cyan(txSignature)}`);

    // 7. Wait for payment confirmation
    spinner?.start("Waiting for payment confirmation...");
    const status = await pollCheckoutCompletion(authResult.token, intent.paymentIntentId);
    if (status.status !== "completed") {
      throw new Error(`Payment ${status.status}. TX: ${txSignature}`);
    }
    spinner?.succeed("Payment confirmed");

    // 8. Wait for project creation
    spinner?.start("Setting up project...");
    let project = null;
    let apiKey: string | null = null;
    for (let i = 0; i < 15; i++) {
      const projects = await listProjects(authResult.token);
      if (projects.length > 0) {
        project = projects[0];
        const details = await getProject(authResult.token, project.id);
        apiKey = details.apiKeys?.[0]?.keyId || null;
        break;
      }
      await sleep(2000);
    }
    if (!project) {
      throw new Error("Project creation timed out. Payment successful — contact support.");
    }
    spinner?.succeed("Project created");

    if (apiKey) {
      setApiKey(apiKey);
      setSharedApiKey(apiKey);
    }

    if (options.json) {
      outputJson({
        status: "SUCCESS",
        wallet: walletAddress,
        projectId: project.id,
        projectName: project.name,
        apiKey,
        configPath: apiKey ? SHARED_CONFIG_PATH : null,
        endpoints: apiKey ? {
          mainnet: `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
          devnet: `https://devnet.helius-rpc.com/?api-key=${apiKey}`,
        } : null,
        credits: null,
        transaction: txSignature,
      });
      return;
    }

    console.log("\n" + chalk.green("✓ Signup complete!"));
    console.log(`\nProject ID: ${chalk.cyan(project.id)}`);
    if (apiKey) {
      console.log(`API Key: ${chalk.cyan(apiKey)}`);
      console.log(chalk.green(`API key saved to ${SHARED_CONFIG_PATH}`));
    }

    // Show RPC endpoints if available
    if (project.dnsRecords && project.dnsRecords.length > 0) {
      console.log(chalk.bold("\nRPC Endpoints:"));
      for (const record of project.dnsRecords) {
        if (record.usageType === "rpc") {
          console.log(`  ${record.network}: ${chalk.blue("https://" + record.dns)}`);
        }
      }
    }

    console.log(
      `\nView transaction: ${chalk.blue(`https://solscan.io/tx/${txSignature}`)}`
    );
  } catch (error) {
    if (options.json) {
      exitWithError("SIGNUP_FAILED", error instanceof Error ? error.message : String(error), undefined, true);
    }
    spinner?.fail(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(ExitCode.GENERAL_ERROR);
  }
}
