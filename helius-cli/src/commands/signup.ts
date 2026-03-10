import chalk from "chalk";
import ora from "ora";
import { loadKeypairFromFile, getAddress } from "../lib/wallet.js";
import { agenticSignup, listProjects } from "../lib/api.js";
import { setJwt, setApiKey, setSharedApiKey, setProjectId, getSharedApiKey, SHARED_CONFIG_PATH } from "../lib/config.js";
import { keypairExists, keygenCommand } from "./keygen.js";
import { formatEnumLabel } from "../lib/formatters.js";
import { outputJson, exitWithError, ExitCode, handleCommandError, type OutputOptions } from "../lib/output.js";
import { checkSolBalance, checkUsdcBalance } from "../lib/payment.js";
import { PLAN_CATALOG } from "../lib/checkout.js";
import { sendDiscoveryEvent } from "../lib/feedback.js";
import { validateSignupPlan, validatePeriod, validateEmail } from "../lib/validation.js";

interface SignupOptions extends OutputOptions {
  keypair: string;
  plan?: string;
  period?: string;
  coupon?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  discoveryPath?: string;
  frictionPoints?: string;
  wait?: boolean;
}

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes

interface FundingResult {
  funded: boolean;
  solFunded: boolean;
  usdcFunded: boolean;
}

/**
 * Polls SOL and USDC balances until both meet the required thresholds.
 * Returns which assets were funded so the caller can report accurate timeout status.
 */
async function waitForFunding(
  walletAddress: string,
  requiredUsdcRaw: bigint,
  spinner?: { start(text: string): void; succeed(text: string): void } | null,
): Promise<FundingResult> {
  const start = Date.now();
  let solFunded = false;
  let usdcFunded = false;

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const waiting = [!solFunded && "SOL", !usdcFunded && "USDC"].filter(Boolean).join(" + ");
    spinner?.start(`Waiting for ${waiting}...`);

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    try {
      if (!solFunded) {
        const solBalance = await checkSolBalance(walletAddress);
        if (solBalance >= 1_000_000n) {
          solFunded = true;
          spinner?.succeed(`SOL received (${(Number(solBalance) / 1_000_000_000).toFixed(4)} SOL)`);
        }
      }

      if (!usdcFunded) {
        const usdcBalance = await checkUsdcBalance(walletAddress);
        if (usdcBalance >= requiredUsdcRaw) {
          usdcFunded = true;
          spinner?.succeed(`USDC received (${(Number(usdcBalance) / 1_000_000).toFixed(2)} USDC)`);
        }
      }
    } catch {
      // Network blip — keep polling, don't abort the wait
    }

    if (solFunded && usdcFunded) {
      return { funded: true, solFunded, usdcFunded };
    }
  }

  console.error(chalk.red("\nTimed out waiting for funds (5 minutes). Please fund and run `helius signup --wait` again."));
  return { funded: false, solFunded, usdcFunded };
}

export async function signupCommand(options: SignupOptions): Promise<void> {
  const spinner = options.json ? null : ora();

  try {
    // Validate plan and period upfront
    if (options.plan) {
      const planErr = validateSignupPlan(options.plan);
      if (planErr) exitWithError("INVALID_INPUT", planErr, undefined, options.json);
    }
    if (options.period) {
      const periodErr = validatePeriod(options.period);
      if (periodErr) exitWithError("INVALID_INPUT", periodErr, undefined, options.json);
    }
    if (options.email) {
      const emailErr = validateEmail(options.email);
      if (emailErr) exitWithError("INVALID_INPUT", emailErr, undefined, options.json);
    }

    // Auto-generate keypair if none exists
    if (!keypairExists(options.keypair)) {
      if (options.json) {
        // In JSON mode, don't do interactive keygen — just error
        exitWithError("KEYPAIR_NOT_FOUND", `Keypair not found at ${options.keypair}`, undefined, options.json);
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

    // Compute required USDC based on selected plan
    const planKey = options.plan?.toLowerCase();
    const catalogEntry = planKey ? PLAN_CATALOG[planKey] : null;
    let requiredUsdcRaw: bigint;
    let requiredUsdcLabel: string;
    if (catalogEntry) {
      const period = options.period?.toLowerCase();
      const priceInCents = period === "yearly" ? catalogEntry.yearlyPrice : catalogEntry.monthlyPrice;
      requiredUsdcRaw = BigInt(priceInCents) * 10_000n; // cents → USDC raw (6 decimals)
      requiredUsdcLabel = `${priceInCents / 100} USDC`;
    } else {
      requiredUsdcRaw = 1_000_000n; // $1 basic plan
      requiredUsdcLabel = "1 USDC";
    }
    const usdcOk = usdcBalance >= requiredUsdcRaw;

    if (!solOk || !usdcOk) {
      spinner?.fail("Insufficient balance");
      const missing: string[] = [];
      if (!solOk) missing.push(`~0.001 SOL (have ${solAmount.toFixed(6)})`);
      if (!usdcOk) missing.push(`${requiredUsdcLabel} (have ${usdcAmount.toFixed(2)})`);

      if (!options.wait) {
        // No polling — exit immediately
        if (options.json) {
          exitWithError("INSUFFICIENT_FUNDS", `Need more funds: ${missing.join(", ")}`, {
            wallet: walletAddress,
            required: { sol: solOk ? undefined : "~0.001 SOL", usdc: usdcOk ? undefined : requiredUsdcLabel },
          }, options.json);
        }
        console.error(chalk.red(`\nInsufficient funds. Send the following to ${chalk.cyan(walletAddress)}:`));
        for (const m of missing) {
          console.error(`  • ${m}`);
        }
        console.error(chalk.gray("\nThen run `helius signup` again, or use `helius signup --wait` to poll until funded."));
        process.exit(!solOk ? ExitCode.INSUFFICIENT_SOL : ExitCode.INSUFFICIENT_USDC);
      }

      // --wait: poll until wallet is funded
      console.error(chalk.red(`\nInsufficient funds. Send the following to ${chalk.cyan(walletAddress)}:`));
      for (const m of missing) {
        console.error(`  • ${m}`);
      }
      console.log(chalk.gray("\nWaiting for funds... (Ctrl+C to cancel)\n"));
      const result = await waitForFunding(walletAddress, requiredUsdcRaw, spinner);
      if (!result.funded) {
        process.exit(!result.solFunded ? ExitCode.INSUFFICIENT_SOL : ExitCode.INSUFFICIENT_USDC);
      }
    } else {
      spinner?.succeed(`Balance OK: ${solAmount.toFixed(4)} SOL, ${usdcAmount.toFixed(2)} USDC`);
    }

    // Snapshot local config state before signup — used to detect recovery vs. duplicate
    const hadLocalApiKey = !!getSharedApiKey();

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

    if (options.discoveryPath || options.frictionPoints) {
      sendDiscoveryEvent({
        discoveryPath: options.discoveryPath,
        frictionPoints: options.frictionPoints,
      });
    }

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
      // No prior local key = interrupted signup being recovered; otherwise a genuine re-run
      const isRecovery = !hadLocalApiKey;
      const allProjects = await listProjects(result.jwt);

      if (options.json) {
        outputJson({
          status: isRecovery ? "RECOVERED" : "EXISTING_PROJECT",
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

      if (isRecovery) {
        console.log("\n" + chalk.green("Resuming previous signup — your account was already created."));
      } else {
        console.log("\n" + chalk.yellow("You already have project(s):"));
      }
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
      if (!isRecovery) {
        console.log(chalk.gray("\nNo payment required. Use `helius projects` to view details."));
      }
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
    handleCommandError(error, options, spinner);
  }
}
