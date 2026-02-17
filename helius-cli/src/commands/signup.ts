import chalk from "chalk";
import ora from "ora";
import { loadKeypairFromFile, signAuthMessage, getAddress } from "../lib/wallet.js";
import { signup, listProjects, getProject } from "../lib/api.js";
import { executeCheckout, DEFAULT_DEVELOPER_MONTHLY_PRICE_ID } from "../lib/checkout.js";
import { setJwt, setApiKey, setSharedApiKey, SHARED_CONFIG_PATH } from "../lib/config.js";
import { keypairExists } from "./keygen.js";
import { outputJson, exitWithError, ExitCode, type OutputOptions } from "../lib/output.js";

interface SignupOptions extends OutputOptions {
  keypair: string;
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
    const keypair = await loadKeypairFromFile(options.keypair);
    const walletAddress = await getAddress(keypair);
    spinner?.succeed(`Wallet: ${chalk.cyan(walletAddress)}`);

    // 2. Authenticate first (no payment yet)
    spinner?.start("Signing authentication message...");
    const { message, signature } = await signAuthMessage(keypair.secretKey);
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

    // 4. Execute checkout (SDK handles init → balance check → pay → poll → project)
    spinner?.start("Processing signup payment...");
    const checkoutResult = await executeCheckout(
      keypair.secretKey,
      authResult.token,
      { priceId: DEFAULT_DEVELOPER_MONTHLY_PRICE_ID, refId: authResult.refId },
    );

    if (checkoutResult.status !== "completed") {
      throw new Error(
        `Checkout ${checkoutResult.status}${checkoutResult.txSignature ? `. TX: ${checkoutResult.txSignature}` : ""}`
      );
    }
    spinner?.succeed("Payment confirmed");

    const projectId = checkoutResult.projectId;
    const apiKey = checkoutResult.apiKey || null;
    const txSignature = checkoutResult.txSignature;

    if (apiKey) {
      setApiKey(apiKey);
      setSharedApiKey(apiKey);
    }

    // Fetch project for display details
    let projectName: string | undefined;
    let dnsRecords: Array<{ dns: string; network: string; usageType: string }> = [];
    if (projectId) {
      try {
        const projects = await listProjects(authResult.token);
        const proj = projects.find(p => p.id === projectId);
        if (proj) {
          projectName = proj.name;
          dnsRecords = proj.dnsRecords || [];
        }
      } catch {
        // Non-critical — display proceeds without project name
      }
    }

    if (options.json) {
      outputJson({
        status: "SUCCESS",
        wallet: walletAddress,
        projectId,
        projectName: projectName || null,
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
    if (projectId) {
      console.log(`\nProject ID: ${chalk.cyan(projectId)}`);
    }
    if (apiKey) {
      console.log(`API Key: ${chalk.cyan(apiKey)}`);
      console.log(chalk.green(`API key saved to ${SHARED_CONFIG_PATH}`));
    }

    // Show RPC endpoints if available
    if (dnsRecords.length > 0) {
      console.log(chalk.bold("\nRPC Endpoints:"));
      for (const record of dnsRecords) {
        if (record.usageType === "rpc") {
          console.log(`  ${record.network}: ${chalk.blue("https://" + record.dns)}`);
        }
      }
    }

    if (txSignature) {
      console.log(
        `\nView transaction: ${chalk.blue(`https://solscan.io/tx/${txSignature}`)}`
      );
    }
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
