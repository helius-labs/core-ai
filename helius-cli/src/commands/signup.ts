import chalk from "chalk";
import ora from "ora";
import { loadKeypair, signAuthMessage, getAddress } from "../lib/wallet.js";
import { signup, createProject, listProjects, getProject, type Project } from "../lib/api.js";
import { payUSDC, checkUsdcBalance, checkSolBalance, MIN_SOL_FOR_TX } from "../lib/payment.js";
import { setJwt } from "../lib/config.js";
import { PAYMENT_AMOUNT } from "../constants.js";
import { keypairExists } from "./keygen.js";
import { outputJson, exitWithError, ExitCode, type OutputOptions } from "../lib/output.js";

interface SignupOptions extends OutputOptions {
  keypair: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function createProjectWithRetry(
  jwt: string,
  maxRetries = 3,
  delayMs = 2000
): Promise<Project> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await createProject(jwt);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (i < maxRetries - 1) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
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

    // 1. Load keypair
    spinner?.start("Loading keypair...");
    const keypair = await loadKeypair(options.keypair);
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

      if (options.json) {
        // Fetch full details for comprehensive output
        const project = existingProjects[0];
        const projectDetails = await getProject(authResult.token, project.id);
        const apiKey = projectDetails.apiKeys?.[0]?.keyId || null;

        outputJson({
          status: "EXISTING_PROJECT",
          wallet: walletAddress,
          projectId: project.id,
          projectName: project.name,
          apiKey,
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
      console.log(chalk.gray("\nNo payment required. Use `helius projects` to view details."));
      return;
    }

    spinner?.succeed("No existing projects");

    // 4. Check SOL balance for transaction fees
    spinner?.start("Checking SOL balance...");
    const solBalance = await checkSolBalance(keypair);
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

    // 5. Check USDC balance
    spinner?.start("Checking USDC balance...");
    const usdcBalance = await checkUsdcBalance(keypair);
    if (usdcBalance < PAYMENT_AMOUNT) {
      if (options.json) {
        exitWithError("INSUFFICIENT_USDC", "Insufficient USDC", {
          have: Number(usdcBalance) / 1_000_000,
          need: 1,
          fundAddress: walletAddress,
        }, true);
      }
      spinner?.fail(`Insufficient USDC`);
      console.error(chalk.red(`Have: ${(Number(usdcBalance) / 1_000_000).toFixed(2)} USDC`));
      console.error(chalk.red(`Need: 1 USDC`));
      console.error(chalk.gray(`\nSend USDC to: ${walletAddress}`));
      process.exit(ExitCode.INSUFFICIENT_USDC);
    }
    spinner?.succeed(`USDC balance: ${chalk.green((Number(usdcBalance) / 1_000_000).toFixed(2))} USDC`);

    spinner?.start("Sending 1 USDC payment...");
    const txSignature = await payUSDC(keypair);
    spinner?.succeed(`Payment sent: ${chalk.cyan(txSignature)}`);

    // 6. Create project (with retry - backend needs time to verify payment)
    spinner?.start("Creating project...");
    const project = await createProjectWithRetry(authResult.token, 3, 2000);
    spinner?.succeed("Project created");

    // Get full project details for comprehensive output
    const projectDetails = await getProject(authResult.token, project.id);
    const apiKey = projectDetails.apiKeys?.[0]?.keyId || project.apiKeys?.[0]?.keyId || null;

    if (options.json) {
      outputJson({
        status: "SUCCESS",
        wallet: walletAddress,
        projectId: project.id,
        projectName: project.name,
        apiKey,
        endpoints: apiKey ? {
          mainnet: `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
          devnet: `https://devnet.helius-rpc.com/?api-key=${apiKey}`,
        } : null,
        credits: projectDetails.creditsUsage?.remainingCredits || 1000000,
        transaction: txSignature,
      });
      return;
    }

    console.log("\n" + chalk.green("✓ Signup complete!"));
    console.log(`\nProject ID: ${chalk.cyan(project.id)}`);
    if (apiKey) {
      console.log(`API Key: ${chalk.cyan(apiKey)}`);
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
