import chalk from "chalk";
import { loadKeypairFromFile, getAddress } from "../lib/wallet.js";
import { agenticSignup, listProjects } from "../lib/api.js";
import { setJwt, setApiKey, setSharedApiKey, setProjectId, getSharedApiKey, SHARED_CONFIG_PATH } from "../lib/config.js";
import { keypairExists, keygenCommand } from "./keygen.js";
import { printSolanaPayQR, buildSolanaPayUri } from "../lib/qr.js";
import { formatEnumLabel } from "../lib/formatters.js";
import { outputJson, exitWithError, ExitCode, handleCommandError, createSpinner, type OutputOptions } from "../lib/output.js";
import { checkSolBalance, checkUsdcBalance } from "../lib/payment.js";
import { getSignupQuote, type PaymentMode } from "../lib/checkout.js";
import { sendDiscoveryEvent } from "../lib/feedback.js";
import { validateSignupPlan, validatePeriod, validateEmail } from "../lib/validation.js";
import { signAuthMessage } from "helius-sdk/auth/signAuthMessage";
import { walletSignup } from "helius-sdk/auth/walletSignup";
import { CLI_USER_AGENT } from "../constants.js";

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
  qr?: boolean;
  sponsored?: boolean;
}

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes

interface FundingResult {
  funded: boolean;
  solFunded: boolean;
  usdcFunded: boolean;
}

/**
 * Polls balances until funded. In sponsored mode, only polls USDC.
 */
async function waitForFunding(
  walletAddress: string,
  requiredUsdcRaw: bigint,
  sponsored: boolean,
  spinner?: { start(text: string): void; succeed(text: string): void } | null,
): Promise<FundingResult> {
  const start = Date.now();
  let solFunded = sponsored; // SOL not needed in sponsored mode
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
  const spinner = createSpinner(options);
  const paymentMode: PaymentMode = options.sponsored ? "sponsored" : "self_funded";

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
        exitWithError("KEYPAIR_NOT_FOUND", `Keypair not found at ${options.keypair}`, undefined, options.json);
      }
      console.log(chalk.yellow("No keypair found. Generating one automatically...\n"));
      await keygenCommand({ output: options.keypair, qr: options.qr });
      console.log();
    }

    // Load keypair
    spinner?.start("Loading keypair...");
    const keypair = await loadKeypairFromFile(options.keypair);
    const walletAddress = await getAddress(keypair);
    spinner?.succeed(`Wallet loaded: ${walletAddress}`);

    // Early wallet auth to get JWT + refId for exact pricing
    spinner?.start("Authenticating...");
    const { message, signature } = await signAuthMessage(keypair.secretKey);
    const auth = await walletSignup(message, signature, walletAddress, CLI_USER_AGENT);
    const jwt = auth.token;
    const refId = auth.refId;
    spinner?.succeed("Authenticated");

    // Get exact pricing from backend (replaces local PLAN_CATALOG math)
    const plan = options.plan?.toLowerCase() || "basic";
    const period = (options.period?.toLowerCase() as "monthly" | "yearly") || "monthly";

    spinner?.start("Getting pricing...");
    const quote = await getSignupQuote(jwt, {
      plan,
      period,
      refId,
      couponCode: options.coupon,
    });
    spinner?.succeed(
      quote.discountCents > 0
        ? `${quote.plan} plan: $${(quote.dueTodayCents / 100).toFixed(2)} (was $${(quote.baseAmountCents / 100).toFixed(2)})`
        : `${quote.plan} plan: $${(quote.dueTodayCents / 100).toFixed(2)}`
    );

    const requiredUsdcAmount = quote.dueTodayCents / 100; // token units
    const requiredUsdcRaw = BigInt(quote.dueTodayCents) * 10_000n; // cents → 6-decimal raw
    const requiredUsdcLabel = `${requiredUsdcAmount} USDC`;

    // Check balance (skip SOL in sponsored mode)
    spinner?.start("Checking wallet balance...");
    const usdcBalance = await checkUsdcBalance(walletAddress);
    const usdcAmountHave = Number(usdcBalance) / 1_000_000;
    const usdcOk = usdcBalance >= requiredUsdcRaw;

    let solOk = true;
    let solAmountHave = 0;
    if (paymentMode !== "sponsored") {
      const solBalance = await checkSolBalance(walletAddress);
      solAmountHave = Number(solBalance) / 1_000_000_000;
      solOk = solBalance >= 1_000_000n;
    }

    if (!solOk || !usdcOk) {
      spinner?.fail("Insufficient balance");
      const missing: string[] = [];
      if (!solOk) missing.push(`~0.001 SOL (have ${solAmountHave.toFixed(6)})`);
      if (!usdcOk) missing.push(`${requiredUsdcLabel} (have ${usdcAmountHave.toFixed(2)})`);

      if (!options.wait) {
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
        if (options.qr !== false) {
          const qrUri = buildSolanaPayUri(walletAddress, requiredUsdcAmount);
          await printSolanaPayQR(qrUri);
        }
        console.error(chalk.gray("\nThen run `helius signup` again, or use `helius signup --wait` to poll until funded."));
        process.exit(!solOk ? ExitCode.INSUFFICIENT_SOL : ExitCode.INSUFFICIENT_USDC);
      }

      // --wait: poll until wallet is funded
      console.error(chalk.red(`\nInsufficient funds. Send the following to ${chalk.cyan(walletAddress)}:`));
      for (const m of missing) {
        console.error(`  • ${m}`);
      }
      if (options.qr !== false) {
        const qrUri = buildSolanaPayUri(walletAddress, requiredUsdcAmount);
        await printSolanaPayQR(qrUri);
      }
      console.log(chalk.gray("\nWaiting for funds... (Ctrl+C to cancel)\n"));
      const result = await waitForFunding(walletAddress, requiredUsdcRaw, paymentMode === "sponsored", spinner);
      if (!result.funded) {
        process.exit(!result.solFunded ? ExitCode.INSUFFICIENT_SOL : ExitCode.INSUFFICIENT_USDC);
      }
    } else {
      const balanceMsg = paymentMode === "sponsored"
        ? `Balance OK: ${usdcAmountHave.toFixed(2)} USDC (SOL sponsored)`
        : `Balance OK: ${solAmountHave.toFixed(4)} SOL, ${usdcAmountHave.toFixed(2)} USDC`;
      spinner?.succeed(balanceMsg);
    }

    // Snapshot local config state before signup — used to detect recovery vs. duplicate
    const hadLocalApiKey = !!getSharedApiKey();

    // Run agenticSignup (handles all plan paths including checkout + sponsored)
    const planLabel = options.plan || "basic";
    spinner?.start(`Signing up (${planLabel} plan)...`);

    const result = await agenticSignup({
      secretKey: keypair.secretKey,
      plan: options.plan,
      period: period === "monthly" ? undefined : period,
      couponCode: options.coupon,
      email: options.email,
      firstName: options.firstName,
      lastName: options.lastName,
      paymentMode,
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
