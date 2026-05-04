import chalk from "chalk";
import {
  loadKeypairFromFile,
  signAuthMessage,
  getAddress,
} from "../lib/wallet.js";
import {
  walletSignup,
  listProjects,
  getPaymentStatus,
  getPaymentIntent,
  payPaymentLink,
  upgradePlan as sdkUpgradePlan,
  type PaymentLink,
} from "../lib/api.js";
import {
  setJwt,
  getPendingUpgrade,
  setPendingUpgrade,
  updatePendingUpgrade,
  clearPendingUpgrade,
  type PendingUpgrade,
} from "../lib/config.js";
import { keypairExists } from "./keygen.js";
import {
  outputJson,
  exitWithError,
  ExitCode,
  handleCommandError,
  createSpinner,
  type OutputOptions,
} from "../lib/output.js";
import { checkSolBalance, checkUsdcBalance, checkBackendForRefresh } from "../lib/payment.js";
import { validateUpgradePlan, validatePeriod, validateEmail } from "../lib/validation.js";

interface UpgradeOptions extends OutputOptions {
  keypair: string;
  plan?: string;
  period?: string;
  coupon?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  pay?: boolean;
  resume?: boolean;
  restart?: boolean;
}

const CENTS_TO_USDC_RAW = 10_000n;
const SOL_FEE_THRESHOLD = 1_000_000n;
const TX_EXPLORER = "https://orbmarkets.io/tx";

/**
 * Phase 2 — `helius upgrade`. Mirrors `helius signup` with three modes:
 *   - default (link): print payment URL + save pendingUpgrade, exit.
 *   - --pay: autopay USDC + memo from local keypair, poll, surface SUCCESS / PENDING.
 *   - --resume: poll stored pendingUpgrade (no keypair load), provision on SUCCESS.
 */
export async function upgradeCommand(options: UpgradeOptions): Promise<void> {
  const spinner = createSpinner(options);

  try {
    if (options.resume) {
      await runResume(options, spinner);
      return;
    }

    if (options.plan) {
      const planErr = validateUpgradePlan(options.plan);
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

    if (options.restart) clearPendingUpgrade();

    const stored = getPendingUpgrade();
    if (stored && !options.restart) {
      if (options.pay) {
        await runPayWithStored(stored, options, spinner);
        return;
      }

      // Local expiry past → query backend (source of truth) before
      // reprinting a stale URL. See `checkBackendForRefresh`.
      const localExpired = Date.parse(stored.expiresAt) <= Date.now();
      if (localExpired) {
        const { verdict } = await checkBackendForRefresh(
          stored.jwt,
          stored.paymentIntentId,
          spinner,
        );
        if (verdict === "completed") {
          await pollAndEmit(stored, stored.txSignature, options, spinner);
          return;
        }
        if (verdict === "cleared") {
          clearPendingUpgrade();
          // Fall through to fresh upgrade path. Requires --plan; the existing
          // INVALID_INPUT check below handles the missing-flag case.
        } else {
          emitPaymentRequired(stored, true, options);
          return;
        }
      } else {
        emitPaymentRequired(stored, true, options);
        return;
      }
    }

    if (!options.plan) {
      exitWithError(
        "INVALID_INPUT",
        "--plan is required for upgrade (e.g. --plan business --period yearly).",
        undefined,
        !!options.json,
      );
    }

    if (!keypairExists(options.keypair)) {
      exitWithError(
        "KEYPAIR_NOT_FOUND",
        `Keypair not found at ${options.keypair}`,
        undefined,
        !!options.json,
      );
    }
    spinner?.start("Loading keypair...");
    const keypair = await loadKeypairFromFile(options.keypair);
    const walletAddress = await getAddress(keypair);
    spinner?.succeed(`Wallet: ${walletAddress}`);

    spinner?.start("Authenticating...");
    const { message, signature } = await signAuthMessage(keypair.secretKey);
    const auth = await walletSignup(message, signature, walletAddress);
    setJwt(auth.token);
    spinner?.succeed("Authenticated");

    spinner?.start("Locating project to upgrade...");
    const projects = await listProjects(auth.token);
    if (projects.length === 0) {
      exitWithError("NO_PROJECTS", "No projects found for this wallet.", undefined, !!options.json);
    }
    const project = projects[0];
    spinner?.succeed(`Project: ${project.id}`);

    const period = (options.period as "monthly" | "yearly") || "monthly";
    const targetPlan = options.plan!.toLowerCase() as
      | "agent"
      | "developer"
      | "business"
      | "professional";

    spinner?.start("Creating upgrade payment intent...");
    const result = await sdkUpgradePlan({
      jwt: auth.token,
      projectId: project.id,
      plan: targetPlan,
      period,
      couponCode: options.coupon,
      email: options.email,
      firstName: options.firstName,
      lastName: options.lastName,
    });
    spinner?.succeed("Upgrade ready");

    const pending: PendingUpgrade = {
      paymentIntentId: result.paymentLink.paymentIntentId,
      paymentUrl: result.paymentLink.paymentUrl,
      planName: result.paymentLink.planName,
      amountCents: result.paymentLink.amountCents,
      destinationWallet: result.paymentLink.destinationWallet,
      solanaPayUrl: result.paymentLink.solanaPayUrl,
      memo: result.paymentLink.memo,
      expiresAt: result.paymentLink.expiresAt,
      jwt: auth.token,
      projectId: project.id,
      targetPlan,
      period,
      payerWallet: walletAddress,
      createdAt: new Date().toISOString(),
    };
    setPendingUpgrade(pending);

    if (options.pay) {
      await runPayWithStored(pending, options, spinner, keypair.secretKey);
    } else {
      emitPaymentRequired(pending, false, options);
    }
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// --pay path
// ────────────────────────────────────────────────────────────────────────────

async function runPayWithStored(
  stored: PendingUpgrade,
  options: UpgradeOptions,
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

  if (stored.txSignature) {
    spinner?.start("Resuming poll (USDC already sent)...");
    await pollAndEmit(stored, stored.txSignature, options, spinner);
    return;
  }

  spinner?.start("Checking payment status...");
  let status;
  try {
    status = await getPaymentStatus(stored.jwt, stored.paymentIntentId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("410")) {
      clearPendingUpgrade();
      emitExpired(stored, options);
      return;
    }
    throw error;
  }
  spinner?.succeed(`Status: ${status.phase}`);

  if (status.readyToRedirect) {
    clearPendingUpgrade();
    await emitSuccess(stored, undefined, options);
    return;
  }
  if (status.phase === "expired") {
    clearPendingUpgrade();
    emitExpired(stored, options);
    return;
  }
  if (status.phase === "failed") {
    clearPendingUpgrade();
    emitFailed(stored, status.message, options);
    return;
  }
  if (status.status === "completed" && !status.readyToRedirect) {
    await pollAndEmit(stored, undefined, options, spinner);
    return;
  }

  const secretKey = freshSecretKey ?? (await loadSecretKey(options));
  const keypair = await loadKeypairFromFile(options.keypair);
  const payerAddress = await getAddress(keypair);

  // Guard against keypair rotation between intent creation and --pay.
  // `payerWallet` is undefined for intents stored before this field was
  // introduced; skip the check in that case (one-version migration window).
  if (stored.payerWallet && payerAddress !== stored.payerWallet) {
    exitWithError(
      "INVALID_INPUT",
      `Local keypair wallet (${payerAddress}) does not match the wallet that created this upgrade intent (${stored.payerWallet}). Run \`helius upgrade --restart\` to start over.`,
      undefined,
      !!options.json,
    );
  }

  spinner?.start("Checking wallet balance...");
  const payerSol = await checkSolBalance(payerAddress);
  const payerUsdc = await checkUsdcBalance(payerAddress);
  const required = BigInt(stored.amountCents) * CENTS_TO_USDC_RAW;
  if (payerSol < SOL_FEE_THRESHOLD) {
    spinner?.fail("Insufficient SOL for fees");
    exitWithError(
      "INSUFFICIENT_SOL",
      `Wallet ${payerAddress} needs ~0.001 SOL (have ${(Number(payerSol) / 1e9).toFixed(6)}).`,
      undefined,
      !!options.json,
    );
  }
  if (payerUsdc < required) {
    spinner?.fail("Insufficient USDC");
    exitWithError(
      "INSUFFICIENT_USDC",
      `Wallet ${payerAddress} needs ${stored.amountCents / 100} USDC (have ${(Number(payerUsdc) / 1e6).toFixed(2)}).`,
      undefined,
      !!options.json,
    );
  }
  spinner?.succeed("Balance OK");

  spinner?.start(`Sending ${stored.amountCents / 100} USDC + memo...`);
  const { txSignature } = await payPaymentLink(secretKey, link);
  spinner?.succeed(`Sent: ${txSignature}`);
  updatePendingUpgrade({ txSignature });

  await pollAndEmit(stored, txSignature, options, spinner);
}

async function pollAndEmit(
  stored: PendingUpgrade,
  txSignature: string | undefined,
  options: UpgradeOptions,
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
        clearPendingUpgrade();
        emitExpired(stored, options);
        return;
      }
      throw error;
    }

    if (status.readyToRedirect) {
      spinner?.succeed("Upgraded");
      clearPendingUpgrade();
      await emitSuccess(stored, txSignature, options);
      return;
    }
    if (status.phase === "failed") {
      clearPendingUpgrade();
      emitFailed(stored, status.message, options);
      return;
    }
    if (status.phase === "expired") {
      clearPendingUpgrade();
      emitExpired(stored, options);
      return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }

  spinner?.warn("Activation polling timed out");
  emitPending(stored, txSignature, options);
}

// ────────────────────────────────────────────────────────────────────────────
// --resume path
// ────────────────────────────────────────────────────────────────────────────

async function runResume(
  options: UpgradeOptions,
  spinner: ReturnType<typeof createSpinner>,
): Promise<void> {
  const stored = getPendingUpgrade();
  if (!stored) {
    if (options.json) {
      outputJson({ status: "MISSING_PENDING_UPGRADE" });
      return;
    }
    exitWithError(
      "MISSING_PENDING_UPGRADE",
      "No pending upgrade found in config. Run `helius upgrade --plan ...` first.",
      undefined,
      !!options.json,
    );
  }
  spinner?.start("Polling upgrade status...");
  await pollAndEmit(stored!, stored!.txSignature, options, spinner);
}

// ────────────────────────────────────────────────────────────────────────────
// Output emitters
// ────────────────────────────────────────────────────────────────────────────

function emitPaymentRequired(
  stored: PendingUpgrade,
  reused: boolean,
  options: UpgradeOptions,
): void {
  if (options.json) {
    outputJson({
      status: "PAYMENT_REQUIRED",
      paymentUrl: stored.paymentUrl,
      paymentIntentId: stored.paymentIntentId,
      projectId: stored.projectId,
      targetPlan: stored.targetPlan,
      period: stored.period,
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
    console.log(chalk.gray("(Resuming previous upgrade — re-run with --restart to start over.)"));
  }
  console.log(chalk.bold(`Pay ${stored.amountCents / 100} USDC to upgrade to ${stored.planName}:`));
  console.log();
  console.log(`  ${chalk.cyan(stored.paymentUrl)}`);
  console.log();
  console.log(chalk.gray("Or send USDC directly to:"));
  console.log(chalk.gray(`  Treasury: ${stored.destinationWallet}`));
  console.log(chalk.gray(`  Memo:     ${stored.memo}`));
  console.log();
  console.log(chalk.gray("Once paid, run `helius upgrade --resume` to confirm locally."));
}

async function emitSuccess(
  stored: PendingUpgrade,
  txSignature: string | undefined,
  options: UpgradeOptions,
): Promise<void> {
  // Backfill txSignature from the backend for browser-pay flows where the
  // SDK never saw the on-chain signature.
  let resolvedTxSignature = txSignature;
  if (!resolvedTxSignature) {
    try {
      const intent = await getPaymentIntent(stored.jwt, stored.paymentIntentId);
      resolvedTxSignature = intent.txSignature;
    } catch {
      // Best-effort.
    }
  }

  if (options.json) {
    outputJson({
      status: "SUCCESS",
      projectId: stored.projectId,
      newPlan: stored.targetPlan,
      period: stored.period,
      paymentIntentId: stored.paymentIntentId,
      txSignature: resolvedTxSignature ?? null,
    });
    return;
  }
  console.log("\n" + chalk.green(`Upgraded to ${stored.planName}!`));
  console.log(`\nProject ID: ${chalk.cyan(stored.projectId)}`);
  if (resolvedTxSignature) {
    console.log(`Transaction: ${chalk.blue(`${TX_EXPLORER}/${resolvedTxSignature}`)}`);
  }
}

function emitPending(
  stored: PendingUpgrade,
  txSignature: string | undefined,
  options: UpgradeOptions,
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
  console.log("\n" + chalk.yellow("Upgrade still being confirmed."));
  console.log(`\n  Payment URL: ${chalk.cyan(stored.paymentUrl)}`);
  if (txSignature) {
    console.log(`  Transaction: ${chalk.blue(`${TX_EXPLORER}/${txSignature}`)}`);
  }
  console.log(chalk.gray(`\nRun \`helius upgrade --resume\` again in a moment.`));
}

function emitExpired(stored: PendingUpgrade, options: UpgradeOptions): void {
  if (options.json) {
    outputJson({ status: "EXPIRED", paymentIntentId: stored.paymentIntentId });
    return;
  }
  console.error("\n" + chalk.red("Upgrade payment intent expired."));
  console.error(chalk.gray("Run `helius upgrade --plan ...` to start fresh."));
  process.exit(ExitCode.GENERAL_ERROR);
}

function emitFailed(
  stored: PendingUpgrade,
  reason: string | undefined,
  options: UpgradeOptions,
): void {
  if (options.json) {
    outputJson({
      status: "FAILED",
      paymentIntentId: stored.paymentIntentId,
      ...(reason && { reason }),
    });
    return;
  }
  console.error("\n" + chalk.red("Upgrade payment failed."));
  if (reason) console.error(chalk.gray(reason));
  process.exit(ExitCode.GENERAL_ERROR);
}

async function loadSecretKey(options: UpgradeOptions): Promise<Uint8Array> {
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
