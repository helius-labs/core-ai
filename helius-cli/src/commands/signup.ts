import chalk from "chalk";
import { loadKeypairFromFile, getAddress } from "../lib/wallet.js";
import {
  signup as sdkSignup,
  payPaymentLink,
  getPaymentStatus,
  getPaymentIntent,
  listProjects,
  getProject,
  createApiKey,
  type PaymentLink,
} from "../lib/api.js";
import {
  setJwt,
  setApiKey,
  setSharedApiKey,
  setProjectId,
  getPendingSignup,
  setPendingSignup,
  updatePendingSignup,
  clearPendingSignup,
  SHARED_CONFIG_PATH,
  type PendingSignup,
} from "../lib/config.js";
import { keypairExists, keygenCommand } from "./keygen.js";
import {
  outputJson,
  exitWithError,
  ExitCode,
  handleCommandError,
  createSpinner,
  type OutputOptions,
} from "../lib/output.js";
import { checkSolBalance, checkUsdcBalance } from "../lib/payment.js";
import { sendDiscoveryEvent } from "../lib/feedback.js";
import {
  validateSignupPlan,
  validatePeriod,
  validateEmail,
} from "../lib/validation.js";

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
  pay?: boolean;
  resume?: boolean;
  restart?: boolean;
}

/** USDC has 6 decimals; intent.amount is in cents. cents × 10_000 = raw. */
const CENTS_TO_USDC_RAW = 10_000n;
const SOL_FEE_THRESHOLD = 1_000_000n; // ~0.001 SOL
const TX_EXPLORER = "https://orbmarkets.io/tx";

const buildEndpoints = (apiKey: string) => ({
  mainnet: `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
  devnet: `https://devnet.helius-rpc.com/?api-key=${apiKey}`,
});

/**
 * Phase 1 signup. Three modes:
 *  - Default (link mode): print payment URL, save full pendingSignup, exit.
 *  - --pay: send USDC + memo from local keypair, poll, provision API key.
 *  - --resume: poll the stored intent (no keypair load, no contact args).
 *
 * Pending-intent reuse: if config has a non-expired pendingSignup and the user
 * does not pass --restart, the default and --pay paths reuse it instead of
 * creating a new intent.
 *
 * Local expiresAt does NOT auto-clear pendingSignup. Cleanup only on:
 * backend-reported expired/failed, successful provisioning, or --restart.
 */
export async function signupCommand(options: SignupOptions): Promise<void> {
  const spinner = createSpinner(options);

  try {
    if (options.resume) {
      await runResume(options, spinner);
      return;
    }

    // ── Validation (skipped on --resume, runs for default + --pay) ──

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

    // ── Pending-intent reuse runs first ──

    if (options.restart) {
      clearPendingSignup();
    }

    let stored = getPendingSignup();
    if (stored && !options.restart) {
      // --pay: idempotent reuse path (handles its own status check).
      if (options.pay) {
        await runPayWithStored(stored, options, spinner);
        return;
      }

      // Default link mode. If the local `expiresAt` is past, the link in
      // config might be stale — but local clocks lie, and a user could pay
      // just before backend expiry yet return after. Source of truth is the
      // backend; query it before deciding.
      const now = Date.now();
      const localExpired = Date.parse(stored.expiresAt) <= now;
      if (localExpired) {
        const refreshed = await refreshStoredFromBackend(stored, spinner, options);
        if (refreshed === "cleared") {
          // Backend says expired/failed (or 410). Stored intent has been
          // cleared. Fall through to the fresh signup path below.
          stored = undefined;
        } else if (refreshed === "provisioned") {
          // Backend reported activation already complete; provisioning
          // completed inside refreshStoredFromBackend. Done.
          return;
        } else {
          // Still payable on the backend. Re-print the link.
          emitPaymentRequired(stored, true, options);
          return;
        }
      } else {
        emitPaymentRequired(stored, true, options);
        return;
      }
    }

    // ── Fresh signup path ──
    //
    // Contact-info validation lives in the SDK's no-project branch — that
    // way already_subscribed / upgrade_required short-circuits don't demand
    // --email/--first-name/--last-name when they're not needed.

    const plan = (options.plan?.toLowerCase() || "agent") as
      | "agent"
      | "developer"
      | "business"
      | "professional";

    // Auto-generate keypair if none exists (skipped in JSON mode)
    if (!keypairExists(options.keypair)) {
      if (options.json) {
        exitWithError(
          "KEYPAIR_NOT_FOUND",
          `Keypair not found at ${options.keypair}`,
          undefined,
          !!options.json,
        );
      }
      console.log(chalk.yellow("No keypair found. Generating one automatically...\n"));
      await keygenCommand({ output: options.keypair });
      console.log();
    }

    spinner?.start("Loading keypair...");
    const keypair = await loadKeypairFromFile(options.keypair);
    const walletAddress = await getAddress(keypair);
    spinner?.succeed(`Wallet loaded: ${walletAddress}`);

    spinner?.start("Authenticating + creating payment intent...");
    const result = await sdkSignup({
      secretKey: keypair.secretKey,
      plan,
      period: (options.period as "monthly" | "yearly") || undefined,
      email: options.email,
      firstName: options.firstName,
      lastName: options.lastName,
      couponCode: options.coupon,
    });
    spinner?.succeed("Signup ready");

    // Top-level JWT is set so subsequent commands (helius login, etc.) reuse it,
    // but pendingSignup carries its own JWT to survive top-level rotations.
    setJwt(result.jwt);

    if (options.discoveryPath || options.frictionPoints) {
      sendDiscoveryEvent({
        discoveryPath: options.discoveryPath,
        frictionPoints: options.frictionPoints,
      });
    }

    switch (result.kind) {
      case "already_subscribed": {
        // Persist the existing API key so other commands can use it.
        setApiKey(result.apiKey);
        setSharedApiKey(result.apiKey);
        setProjectId(result.projectId);
        emitAlreadySubscribed(result, options);
        return;
      }
      case "upgrade_required": {
        emitUpgradeRequired(result, options);
        return;
      }
      case "payment_required": {
        const pending: PendingSignup = {
          paymentIntentId: result.paymentLink.paymentIntentId,
          paymentUrl: result.paymentLink.paymentUrl,
          planName: result.paymentLink.planName,
          amountCents: result.paymentLink.amountCents,
          destinationWallet: result.paymentLink.destinationWallet,
          solanaPayUrl: result.paymentLink.solanaPayUrl,
          memo: result.paymentLink.memo,
          expiresAt: result.paymentLink.expiresAt,
          walletAddress: result.walletAddress,
          refId: result.refId,
          jwt: result.jwt,
          createdAt: new Date().toISOString(),
        };
        // CRITICAL: write pendingSignup BEFORE attempting any USDC transfer so
        // a crash mid-send is recoverable via --resume.
        setPendingSignup(pending);

        if (options.pay) {
          await runPayWithStored(pending, options, spinner, keypair.secretKey);
        } else {
          emitPaymentRequired(pending, false, options);
        }
        return;
      }
    }
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// --pay path
// ────────────────────────────────────────────────────────────────────────────

/**
 * Pay against a stored pending signup. Idempotent:
 *   1. If pendingSignup.txSignature is already set → skip the send, just poll.
 *   2. Else fetch backend status:
 *        - readyToRedirect → skip send, provision.
 *        - completed && !readyToRedirect → skip send, poll until ready.
 *        - pending → send USDC, then poll.
 *        - expired/failed → clear and exit with the matching status.
 */
async function runPayWithStored(
  stored: PendingSignup,
  options: SignupOptions,
  spinner: ReturnType<typeof createSpinner>,
  freshSecretKey?: Uint8Array,
): Promise<void> {
  const link: PaymentLink = {
    kind: "payment_required",
    paymentIntentId: stored.paymentIntentId,
    amountCents: stored.amountCents,
    destinationWallet: stored.destinationWallet,
    memo: stored.memo,
    expiresAt: stored.expiresAt,
    paymentUrl: stored.paymentUrl,
    solanaPayUrl: stored.solanaPayUrl,
    planName: stored.planName,
  };

  // 1. Already-paid short-circuit.
  if (stored.txSignature) {
    spinner?.start("Resuming payment polling (USDC already sent)...");
    await pollAndProvision(stored, stored.txSignature, options, spinner);
    return;
  }

  // 2. Check backend status before sending.
  spinner?.start("Checking payment status...");
  let status;
  try {
    status = await getPaymentStatus(stored.jwt, stored.paymentIntentId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("410")) {
      clearPendingSignup();
      emitExpired(stored, options);
      return;
    }
    throw error;
  }
  spinner?.succeed(`Status: ${status.phase}`);

  if (status.readyToRedirect) {
    await provisionAndEmit(stored, undefined, options, spinner);
    return;
  }
  if (status.phase === "expired") {
    clearPendingSignup();
    emitExpired(stored, options);
    return;
  }
  if (status.phase === "failed") {
    clearPendingSignup();
    emitFailed(stored, status.message, options);
    return;
  }
  if (status.status === "completed" && !status.readyToRedirect) {
    // Payment already settled; just keep polling.
    await pollAndProvision(stored, undefined, options, spinner);
    return;
  }

  // 3. status === "pending" → send USDC.
  const secretKey = freshSecretKey ?? (await loadSecretKey(options));
  const walletAddress = stored.walletAddress;

  spinner?.start("Checking wallet balance...");
  const solBalance = await checkSolBalance(walletAddress);
  const usdcBalance = await checkUsdcBalance(walletAddress);
  const requiredUsdcRaw = BigInt(stored.amountCents) * CENTS_TO_USDC_RAW;
  if (solBalance < SOL_FEE_THRESHOLD) {
    spinner?.fail("Insufficient SOL for transaction fees");
    exitWithError(
      "INSUFFICIENT_SOL",
      `Wallet ${walletAddress} needs ~0.001 SOL for fees (have ${(Number(solBalance) / 1e9).toFixed(6)}).`,
      undefined,
      !!options.json,
    );
  }
  if (usdcBalance < requiredUsdcRaw) {
    spinner?.fail("Insufficient USDC");
    exitWithError(
      "INSUFFICIENT_USDC",
      `Wallet ${walletAddress} needs ${stored.amountCents / 100} USDC (have ${(Number(usdcBalance) / 1e6).toFixed(2)}).`,
      undefined,
      !!options.json,
    );
  }
  spinner?.succeed("Balance OK");

  spinner?.start(`Sending ${stored.amountCents / 100} USDC + memo...`);
  const { txSignature } = await payPaymentLink(secretKey, link);
  spinner?.succeed(`Sent: ${txSignature}`);

  // Persist txSignature before activation polling so a crash here doesn't lose it.
  updatePendingSignup({ txSignature });

  await pollAndProvision(stored, txSignature, options, spinner);
}

async function pollAndProvision(
  stored: PendingSignup,
  txSignature: string | undefined,
  options: SignupOptions,
  spinner: ReturnType<typeof createSpinner>,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  spinner?.start("Waiting for activation...");

  while (Date.now() < deadline) {
    let status;
    try {
      status = await getPaymentStatus(stored.jwt, stored.paymentIntentId);
    } catch (error) {
      if (error instanceof Error && error.message.includes("410")) {
        clearPendingSignup();
        emitExpired(stored, options);
        return;
      }
      throw error;
    }

    if (status.readyToRedirect) {
      spinner?.succeed("Activated");
      await provisionAndEmit(stored, txSignature, options, spinner);
      return;
    }
    if (status.phase === "failed") {
      clearPendingSignup();
      emitFailed(stored, status.message, options);
      return;
    }
    if (status.phase === "expired") {
      clearPendingSignup();
      emitExpired(stored, options);
      return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }

  spinner?.warn("Activation polling timed out");
  emitPending(stored, txSignature, options);
}

// ────────────────────────────────────────────────────────────────────────────
// --resume path — never loads the keypair, never accepts contact args
// ────────────────────────────────────────────────────────────────────────────

async function runResume(
  options: SignupOptions,
  spinner: ReturnType<typeof createSpinner>,
): Promise<void> {
  const stored = getPendingSignup();
  if (!stored) {
    if (options.json) {
      outputJson({ status: "MISSING_PENDING_INTENT" });
      return;
    }
    exitWithError(
      "MISSING_PENDING_INTENT",
      "No pending signup found in config. Run `helius signup` first.",
      undefined,
      !!options.json,
    );
  }

  spinner?.start("Polling payment status...");
  await pollAndProvision(stored!, stored!.txSignature, options, spinner);
}

/**
 * Default link-mode helper for the case where the locally-stored intent's
 * `expiresAt` is already past. Queries the backend (the only source of
 * truth) and reacts:
 *
 * - `expired` / `failed` / 410 Gone → clear stored intent, return "cleared"
 *   so the caller can fall through to the fresh-signup path.
 * - `completed` (whether or not `readyToRedirect` is true yet) → drive the
 *   normal poll-and-provision flow; return "provisioned" so the caller
 *   doesn't also re-print a link.
 * - `pending` → return "still_payable"; the caller re-prints the existing
 *   link (the backend is happy to accept payment despite the local clock).
 */
async function refreshStoredFromBackend(
  stored: PendingSignup,
  spinner: ReturnType<typeof createSpinner>,
  options: SignupOptions,
): Promise<"cleared" | "provisioned" | "still_payable"> {
  spinner?.start("Stored payment link is past its local expiry — checking backend...");
  let status;
  try {
    status = await getPaymentStatus(stored.jwt, stored.paymentIntentId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("410")) {
      clearPendingSignup();
      spinner?.succeed("Stored intent expired on the backend; starting fresh");
      return "cleared";
    }
    throw error;
  }
  spinner?.succeed(`Backend status: ${status.phase}`);

  if (status.phase === "expired" || status.phase === "failed") {
    clearPendingSignup();
    return "cleared";
  }
  if (status.status === "completed" || status.readyToRedirect) {
    await pollAndProvision(stored, stored.txSignature, options, spinner);
    return "provisioned";
  }
  return "still_payable";
}

// ────────────────────────────────────────────────────────────────────────────
// Provisioning + output emitters
// ────────────────────────────────────────────────────────────────────────────

async function provisionAndEmit(
  stored: PendingSignup,
  txSignature: string | undefined,
  options: SignupOptions,
  spinner: ReturnType<typeof createSpinner>,
): Promise<void> {
  spinner?.start("Provisioning API key...");
  const projects = await listProjects(stored.jwt);
  if (projects.length === 0) {
    spinner?.fail("No project provisioned yet — re-run --resume in a moment.");
    emitPending(stored, txSignature, options);
    return;
  }
  const projectId = projects[0].id;
  const details = await getProject(stored.jwt, projectId);
  let apiKey = details.apiKeys?.[0]?.keyId;
  if (!apiKey) {
    apiKey = (await createApiKey(stored.jwt, projectId, stored.walletAddress)).keyId;
  }
  spinner?.succeed("Provisioned");

  setApiKey(apiKey);
  setSharedApiKey(apiKey);
  setProjectId(projectId);

  // Backfill txSignature from the backend for browser-pay flows where the
  // SDK never saw the on-chain signature (the user paid via wallet-connect
  // in the hosted page). The backend persists txSignature on the intent
  // when payment-service confirms the memo'd transfer.
  let resolvedTxSignature = txSignature ?? undefined;
  if (!resolvedTxSignature) {
    try {
      const intent = await getPaymentIntent(stored.jwt, stored.paymentIntentId);
      resolvedTxSignature = intent.txSignature;
    } catch {
      // Best-effort — don't block SUCCESS on this lookup.
    }
  }

  clearPendingSignup();

  const endpoints = buildEndpoints(apiKey);

  if (options.json) {
    outputJson({
      status: "SUCCESS",
      walletAddress: stored.walletAddress,
      projectId,
      apiKey,
      endpoints,
      paymentIntentId: stored.paymentIntentId,
      txSignature: resolvedTxSignature ?? null,
    });
    return;
  }

  console.log("\n" + chalk.green("Signup complete!"));
  console.log(`\nProject ID: ${chalk.cyan(projectId)}`);
  console.log(`API Key: ${chalk.cyan(apiKey)}`);
  console.log(chalk.green(`Saved to ${SHARED_CONFIG_PATH}`));
  console.log(chalk.bold("\nRPC Endpoints:"));
  console.log(`  Mainnet: ${chalk.blue(endpoints.mainnet)}`);
  console.log(`  Devnet:  ${chalk.blue(endpoints.devnet)}`);
  if (txSignature) {
    console.log(`\nTransaction: ${chalk.blue(`${TX_EXPLORER}/${txSignature}`)}`);
  }
}

function emitPaymentRequired(
  stored: PendingSignup,
  reused: boolean,
  options: SignupOptions,
): void {
  if (options.json) {
    outputJson({
      status: "PAYMENT_REQUIRED",
      paymentUrl: stored.paymentUrl,
      paymentIntentId: stored.paymentIntentId,
      walletAddress: stored.walletAddress,
      refId: stored.refId,
      expiresAt: stored.expiresAt,
      amountCents: stored.amountCents,
      planName: stored.planName,
      destinationWallet: stored.destinationWallet,
      memo: stored.memo,
      solanaPayUrl: stored.solanaPayUrl,
      ...(reused && { reused: true }),
    });
    return;
  }

  console.log();
  if (reused) {
    console.log(chalk.gray("(Resuming previous signup — re-run with --restart to start over.)"));
  }
  console.log(chalk.bold(`Pay ${stored.amountCents / 100} USDC to activate ${stored.planName}:`));
  console.log();
  console.log(`  ${chalk.cyan(stored.paymentUrl)}`);
  console.log();
  console.log(chalk.gray("Or send USDC directly to:"));
  console.log(chalk.gray(`  Treasury: ${stored.destinationWallet}`));
  console.log(chalk.gray(`  Memo:     ${stored.memo}`));
  console.log();
  console.log(chalk.gray(`Once paid, run \`helius signup --resume\` to finish setup.`));
}

function emitAlreadySubscribed(
  result: Extract<
    Awaited<ReturnType<typeof sdkSignup>>,
    { kind: "already_subscribed" }
  >,
  options: SignupOptions,
): void {
  if (options.json) {
    outputJson({
      status: "ALREADY_SUBSCRIBED",
      walletAddress: result.walletAddress,
      projectId: result.projectId,
      apiKey: result.apiKey,
      endpoints: result.endpoints,
    });
    return;
  }
  console.log("\n" + chalk.green("Wallet already has a project on this plan."));
  console.log(`\nProject ID: ${chalk.cyan(result.projectId)}`);
  console.log(`API Key: ${chalk.cyan(result.apiKey)}`);
  console.log(chalk.green(`Saved to ${SHARED_CONFIG_PATH}`));
  console.log(chalk.bold("\nRPC Endpoints:"));
  console.log(`  Mainnet: ${chalk.blue(result.endpoints.mainnet)}`);
  console.log(`  Devnet:  ${chalk.blue(result.endpoints.devnet)}`);
}

function emitUpgradeRequired(
  result: Extract<
    Awaited<ReturnType<typeof sdkSignup>>,
    { kind: "upgrade_required" }
  >,
  options: SignupOptions,
): void {
  const message = `Wallet is already on plan "${result.currentPlan}". Plan changes go through \`helius upgrade\`.`;
  if (options.json) {
    outputJson({
      status: "UPGRADE_REQUIRED",
      walletAddress: result.walletAddress,
      currentPlan: result.currentPlan,
      requestedPlan: result.requestedPlan,
      message,
    });
    return;
  }
  console.error("\n" + chalk.yellow(message));
  process.exit(ExitCode.GENERAL_ERROR);
}

function emitPending(
  stored: PendingSignup,
  txSignature: string | undefined,
  options: SignupOptions,
): void {
  if (options.json) {
    outputJson({
      status: "PENDING",
      paymentIntentId: stored.paymentIntentId,
      paymentUrl: stored.paymentUrl,
      expiresAt: stored.expiresAt,
      ...(txSignature && { txSignature }),
    });
    return;
  }
  console.log();
  console.log(chalk.yellow("Payment is still being confirmed."));
  console.log(`\n  Payment URL: ${chalk.cyan(stored.paymentUrl)}`);
  if (txSignature) {
    console.log(`  Transaction: ${chalk.blue(`${TX_EXPLORER}/${txSignature}`)}`);
  }
  console.log(chalk.gray(`\nRun \`helius signup --resume\` again in a moment.`));
}

function emitExpired(stored: PendingSignup, options: SignupOptions): void {
  if (options.json) {
    outputJson({ status: "EXPIRED", paymentIntentId: stored.paymentIntentId });
    return;
  }
  console.error("\n" + chalk.red("Payment intent expired."));
  console.error(chalk.gray("Run `helius signup` to start a fresh signup."));
  process.exit(ExitCode.GENERAL_ERROR);
}

function emitFailed(
  stored: PendingSignup,
  reason: string | undefined,
  options: SignupOptions,
): void {
  if (options.json) {
    outputJson({
      status: "FAILED",
      paymentIntentId: stored.paymentIntentId,
      ...(reason && { reason }),
    });
    return;
  }
  console.error("\n" + chalk.red("Payment failed."));
  if (reason) console.error(chalk.gray(reason));
  process.exit(ExitCode.GENERAL_ERROR);
}

async function loadSecretKey(options: SignupOptions): Promise<Uint8Array> {
  if (!keypairExists(options.keypair)) {
    exitWithError(
      "KEYPAIR_NOT_FOUND",
      `Keypair not found at ${options.keypair}`,
      undefined,
      !!options.json,
    );
  }
  const keypair = await loadKeypairFromFile(options.keypair);
  return keypair.secretKey;
}
