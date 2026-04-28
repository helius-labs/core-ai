import chalk from "chalk";
import { loadKeypairFromFile, getAddress } from "../lib/wallet.js";
import { agenticSignup, listProjects, getProject } from "../lib/api.js";
import { setJwt, setApiKey, setSharedApiKey, setProjectId, getSharedApiKey, SHARED_CONFIG_PATH } from "../lib/config.js";
import { keypairExists, keygenCommand } from "./keygen.js";
import { printSolanaPayQR, buildSolanaPayUri } from "../lib/qr.js";
import { formatEnumLabel } from "../lib/formatters.js";
import { outputJson, exitWithError, ExitCode, handleCommandError, createSpinner, type OutputOptions } from "../lib/output.js";
import { checkUsdcBalance } from "../lib/payment.js";
import { getSignupQuote } from "../lib/checkout.js";
import { sendDiscoveryEvent } from "../lib/feedback.js";
import { validateSignupPlan, validatePeriod, validateEmail } from "../lib/validation.js";
import { signAuthMessage } from "helius-sdk/auth/signAuthMessage";
import { walletSignup } from "helius-sdk/auth/walletSignup";
import { PLAN_TO_USAGE_PLAN } from "helius-sdk/auth/constants";
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
}

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes

interface FundingResult {
  funded: boolean;
}

/**
 * Polls USDC balance until funded. SOL fees are sponsored by Helius.
 */
async function waitForFunding(
  walletAddress: string,
  requiredUsdcRaw: bigint,
  spinner?: { start(text: string): void; succeed(text: string): void } | null,
): Promise<FundingResult> {
  const start = Date.now();
  let usdcFunded = false;

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    spinner?.start(`Waiting for USDC...`);

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    try {
      const usdcBalance = await checkUsdcBalance(walletAddress);
      if (usdcBalance >= requiredUsdcRaw) {
        usdcFunded = true;
        spinner?.succeed(`USDC received (${(Number(usdcBalance) / 1_000_000).toFixed(2)} USDC)`);
      }
    } catch {
      // Network blip — keep polling, don't abort the wait
    }

    if (usdcFunded) {
      return { funded: true };
    }
  }

  console.error(chalk.red("\nTimed out waiting for funds (5 minutes). Please fund and run `helius signup --wait` again."));
  return { funded: false };
}

export async function signupCommand(options: SignupOptions): Promise<void> {
  const spinner = createSpinner(options);

  try {
    // Validate plan and period upfront
    if (options.plan) {
      const planErr = validateSignupPlan(options.plan);
      if (planErr) exitWithError("INVALID_INPUT", planErr, undefined, !!options.json);
    }
    if (options.period) {
      const periodErr = validatePeriod(options.period);
      if (periodErr) exitWithError("INVALID_INPUT", periodErr, undefined, !!options.json);
    }
    if (options.email) {
      const emailErr = validateEmail(options.email);
      if (emailErr) exitWithError("INVALID_INPUT", emailErr, undefined, !!options.json);
    }

    // Auto-generate keypair if none exists
    if (!keypairExists(options.keypair)) {
      if (options.json) {
        // In JSON mode, don't do interactive keygen — just error
        exitWithError("KEYPAIR_NOT_FOUND", `Keypair not found at ${options.keypair}`, undefined, !!options.json);
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

    // Early wallet auth to get JWT + refId for exact pricing. The same
    // (jwt, refId) pair is forwarded into agenticSignup below so the SDK
    // skips its internal re-authentication — one /wallet-signup round trip
    // per signup instead of two.
    spinner?.start("Authenticating...");
    const { message, signature } = await signAuthMessage(keypair.secretKey);
    const auth = await walletSignup(message, signature, walletAddress, CLI_USER_AGENT);
    const jwt = auth.token;
    const refId = auth.refId;
    spinner?.succeed("Authenticated");

    // Recovery fast-path: if the wallet already has a project on the
    // requested plan, hand back the existing API key instead of charging
    // again. Without --plan we treat any existing project as a match
    // (default behavior). With --plan=<X> we only short-circuit when the
    // existing project is already on that plan; mismatches fall through
    // so the user can upgrade.
    {
      const requestedUsagePlan = options.plan
        ? PLAN_TO_USAGE_PLAN[options.plan.toLowerCase()]
        : null;
      const allProjects = await listProjects(jwt);
      const matchedProject = !options.plan
        ? allProjects[0]
        : allProjects.find((p) => p.subscription?.plan === requestedUsagePlan);
      if (matchedProject) {
        // Surface the matched project first so the existing render keys off it.
        const existing = [matchedProject, ...allProjects.filter((p) => p.id !== matchedProject.id)];
        const project = existing[0];
        const projectDetails = await getProject(jwt, project.id);
        const apiKey = projectDetails.apiKeys?.[0]?.keyId || null;
        const hadLocalApiKey = !!getSharedApiKey();
        const isRecovery = !hadLocalApiKey;

        if (apiKey) {
          setJwt(jwt);
          setApiKey(apiKey);
          setSharedApiKey(apiKey);
          setProjectId(project.id);
        }

        if (options.json) {
          outputJson({
            status: isRecovery ? "RECOVERED" : "EXISTING_PROJECT",
            wallet: walletAddress,
            projectId: project.id,
            apiKey,
            configPath: apiKey ? SHARED_CONFIG_PATH : null,
            endpoints: apiKey
              ? {
                  mainnet: `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
                  devnet: `https://devnet.helius-rpc.com/?api-key=${apiKey}`,
                }
              : null,
            credits: projectDetails.creditsUsage?.remainingCredits ?? null,
            projects: existing.map((p) => ({ id: p.id, name: p.name })),
          });
          return;
        }

        if (isRecovery) {
          console.log(chalk.green("Resuming previous signup — your account was already created."));
        } else {
          console.log(chalk.yellow("You already have project(s):"));
        }
        for (const p of existing) {
          console.log(`  ${chalk.cyan(p.id)} - ${p.name}`);
          if (p.subscription) {
            console.log(`    Plan: ${formatEnumLabel(p.subscription.plan)}`);
          }
        }
        if (apiKey) {
          console.log(`\nAPI Key: ${chalk.cyan(apiKey)}`);
          console.log(chalk.green(`Saved to ${SHARED_CONFIG_PATH}`));
          console.log(chalk.bold("\nRPC Endpoints:"));
          console.log(`  Mainnet: ${chalk.blue(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`)}`);
          console.log(`  Devnet:  ${chalk.blue(`https://devnet.helius-rpc.com/?api-key=${apiKey}`)}`);
        }
        if (!isRecovery) {
          console.log(chalk.gray("\nPass --plan=<plan> to upgrade, or use `helius projects` to view details."));
        }
        return;
      }
    }

    // Default plan is `agent` (10 USDC one-time, ships with 1,000,000
    // starting credits). `basic` is no longer supported by the SDK — the
    // validator above rejects it before we get here.
    const plan = options.plan?.toLowerCase() || "agent";
    const period = (options.period?.toLowerCase() as "monthly" | "yearly") || "monthly";

    spinner?.start("Getting pricing...");
    const quote = await getSignupQuote(jwt, {
      plan,
      period,
      refId,
      couponCode: options.coupon,
    });
    const requiredUsdcAmount = quote.dueTodayCents / 100;
    const requiredUsdcRaw = BigInt(quote.dueTodayCents) * 10_000n; // cents → 6-decimal raw
    const requiredUsdcLabel = `${requiredUsdcAmount} USDC`;
    spinner?.succeed(
      quote.discountCents > 0
        ? `${quote.plan} plan: $${(quote.dueTodayCents / 100).toFixed(2)} (was $${(quote.baseAmountCents / 100).toFixed(2)})`
        : `${quote.plan} plan: $${(quote.dueTodayCents / 100).toFixed(2)}`
    );

    // Check USDC balance (SOL fees sponsored by Helius)
    spinner?.start("Checking wallet balance...");
    const usdcBalance = await checkUsdcBalance(walletAddress);
    const usdcAmountHave = Number(usdcBalance) / 1_000_000;
    const usdcOk = usdcBalance >= requiredUsdcRaw;

    if (!usdcOk) {
      spinner?.fail("Insufficient USDC");
      const missing = `${requiredUsdcLabel} (have ${usdcAmountHave.toFixed(2)})`;

      if (!options.wait) {
        if (options.json) {
          exitWithError("INSUFFICIENT_FUNDS", `Need more funds: ${missing}`, {
            wallet: walletAddress,
            required: { usdc: requiredUsdcLabel },
          }, !!options.json);
        }
        console.error(chalk.red(`\nInsufficient USDC. Send the following to ${chalk.cyan(walletAddress)}:`));
        console.error(`  • ${missing}`);
        console.error(chalk.gray("  SOL fees are sponsored by Helius — only USDC is required."));
        if (options.qr !== false) {
          const qrUri = buildSolanaPayUri(walletAddress, requiredUsdcAmount);
          await printSolanaPayQR(qrUri);
        }
        console.error(chalk.gray("\nThen run `helius signup` again, or use `helius signup --wait` to poll until funded."));
        process.exit(ExitCode.INSUFFICIENT_USDC);
      }

      // --wait: poll until wallet is funded
      console.error(chalk.red(`\nInsufficient USDC. Send the following to ${chalk.cyan(walletAddress)}:`));
      console.error(`  • ${missing}`);
      console.error(chalk.gray("  SOL fees are sponsored by Helius — only USDC is required."));
      if (options.qr !== false) {
        const qrUri = buildSolanaPayUri(walletAddress, requiredUsdcAmount);
        await printSolanaPayQR(qrUri);
      }
      console.log(chalk.gray("\nWaiting for funds... (Ctrl+C to cancel)\n"));
      const result = await waitForFunding(walletAddress, requiredUsdcRaw, spinner);
      if (!result.funded) {
        process.exit(ExitCode.INSUFFICIENT_USDC);
      }
    } else {
      spinner?.succeed(`Balance OK: ${usdcAmountHave.toFixed(2)} USDC (SOL fees sponsored by Helius)`);
    }

    // Snapshot local config state before signup — used to detect recovery vs. duplicate
    const hadLocalApiKey = !!getSharedApiKey();

    // Run agenticSignup (handles all plan paths including checkout).
    // We forward `jwt` + `refId` so the SDK reuses the session from our
    // earlier walletSignup call instead of re-authenticating (dedup).
    const planLabel = options.plan || "agent";
    spinner?.start(`Signing up (${planLabel} plan)...`);

    const result = await agenticSignup({
      secretKey: keypair.secretKey,
      plan,
      period: period === "monthly" ? undefined : period,
      couponCode: options.coupon,
      email: options.email,
      firstName: options.firstName,
      lastName: options.lastName,
      jwt,
      refId,
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

    // Handle result statuses (SDK returns "success" for new signups and
    // "upgraded" for existing-user upgrades — the prior "existing_project"
    // recovery status is handled in the pre-signup fast-path above).
    void hadLocalApiKey;

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
    if (plan === "agent") {
      console.log(
        chalk.gray("\nYour agent plan includes 1,000,000 starting credits."),
      );
      console.log(chalk.gray("Run `helius credits buy --tier=10_USDC` when you need more."));
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
