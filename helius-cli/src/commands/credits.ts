import chalk from "chalk";
import {
  loadKeypairFromFile,
  signAuthMessage,
  getAddress,
} from "../lib/wallet.js";
import {
  walletSignup,
  listProjects,
  purchaseCredits as sdkPurchaseCredits,
  payPaymentLink,
  getPaymentStatus,
  getPaymentIntent,
  type PaymentLink,
} from "../lib/api.js";
import {
  setJwt,
  getPendingCredits,
  setPendingCredits,
  updatePendingCredits,
  clearPendingCredits,
  type PendingCredits,
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

interface CreditsOptions extends OutputOptions {
  keypair: string;
  qty?: string;
  coupon?: string;
  pay?: boolean;
  resume?: boolean;
  restart?: boolean;
}

const CENTS_TO_USDC_RAW = 10_000n;
const SOL_FEE_THRESHOLD = 1_000_000n;
const TX_EXPLORER = "https://orbmarkets.io/tx";

/**
 * Phase 2 — `helius credits` to top up prepaid credits on an agent-plan
 * project. Mirrors signup/upgrade with three modes (default / --pay / --resume).
 *
 * Each unit of `--qty` grants 1,000,000 credits ($10 USDC each).
 */
export async function creditsCommand(options: CreditsOptions): Promise<void> {
  const spinner = createSpinner(options);

  try {
    if (options.resume) {
      await runResume(options, spinner);
      return;
    }

    const qty = parseQty(options.qty);

    if (options.restart) clearPendingCredits();

    const stored = getPendingCredits();
    if (stored && !options.restart) {
      if (options.pay) {
        await runPayWithStored(stored, options, spinner);
        return;
      }

      // Local expiry past → query backend before reprinting a stale URL.
      // `qty` is already validated above and stays in scope for the
      // fall-through-to-fresh path on `cleared`.
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
          clearPendingCredits();
          // Fall through to fresh credits path.
        } else {
          emitPaymentRequired(stored, true, options);
          return;
        }
      } else {
        emitPaymentRequired(stored, true, options);
        return;
      }
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

    spinner?.start("Locating project...");
    const projects = await listProjects(auth.token);
    if (projects.length === 0) {
      exitWithError("NO_PROJECTS", "No projects found.", undefined, !!options.json);
    }
    const project = projects[0];
    spinner?.succeed(`Project: ${project.id}`);

    spinner?.start("Creating credits payment intent...");
    const result = await sdkPurchaseCredits({
      jwt: auth.token,
      projectId: project.id,
      qty,
      couponCode: options.coupon,
    });
    spinner?.succeed("Credits link ready");

    const pending: PendingCredits = {
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
      qty,
      payerWallet: walletAddress,
      createdAt: new Date().toISOString(),
    };
    setPendingCredits(pending);

    if (options.pay) {
      await runPayWithStored(pending, options, spinner, keypair.secretKey);
    } else {
      emitPaymentRequired(pending, false, options);
    }
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

function parseQty(input: string | undefined): number {
  if (input === undefined) return 1;
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--qty must be a positive integer, got "${input}".`);
  }
  return n;
}

// ────────────────────────────────────────────────────────────────────────────
// --pay path
// ────────────────────────────────────────────────────────────────────────────

async function runPayWithStored(
  stored: PendingCredits,
  options: CreditsOptions,
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
      clearPendingCredits();
      emitExpired(stored, options);
      return;
    }
    throw error;
  }
  spinner?.succeed(`Status: ${status.phase}`);

  if (status.readyToRedirect) {
    clearPendingCredits();
    await emitSuccess(stored, undefined, options);
    return;
  }
  if (status.phase === "expired") {
    clearPendingCredits();
    emitExpired(stored, options);
    return;
  }
  if (status.phase === "failed") {
    clearPendingCredits();
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
  // introduced; skip the check in that case.
  if (stored.payerWallet && payerAddress !== stored.payerWallet) {
    exitWithError(
      "INVALID_INPUT",
      `Local keypair wallet (${payerAddress}) does not match the wallet that created this credits intent (${stored.payerWallet}). Run \`helius credits --restart\` to start over.`,
      undefined,
      !!options.json,
    );
  }

  spinner?.start("Checking wallet balance...");
  const sol = await checkSolBalance(payerAddress);
  const usdc = await checkUsdcBalance(payerAddress);
  const required = BigInt(stored.amountCents) * CENTS_TO_USDC_RAW;
  if (sol < SOL_FEE_THRESHOLD) {
    spinner?.fail("Insufficient SOL for fees");
    exitWithError(
      "INSUFFICIENT_SOL",
      `Wallet ${payerAddress} needs ~0.001 SOL (have ${(Number(sol) / 1e9).toFixed(6)}).`,
      undefined,
      !!options.json,
    );
  }
  if (usdc < required) {
    spinner?.fail("Insufficient USDC");
    exitWithError(
      "INSUFFICIENT_USDC",
      `Wallet ${payerAddress} needs ${stored.amountCents / 100} USDC (have ${(Number(usdc) / 1e6).toFixed(2)}).`,
      undefined,
      !!options.json,
    );
  }
  spinner?.succeed("Balance OK");

  spinner?.start(`Sending ${stored.amountCents / 100} USDC + memo...`);
  const { txSignature } = await payPaymentLink(secretKey, link);
  spinner?.succeed(`Sent: ${txSignature}`);
  updatePendingCredits({ txSignature });

  await pollAndEmit(stored, txSignature, options, spinner);
}

async function pollAndEmit(
  stored: PendingCredits,
  txSignature: string | undefined,
  options: CreditsOptions,
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
        clearPendingCredits();
        emitExpired(stored, options);
        return;
      }
      throw error;
    }
    if (status.readyToRedirect) {
      spinner?.succeed("Credits added");
      clearPendingCredits();
      await emitSuccess(stored, txSignature, options);
      return;
    }
    if (status.phase === "failed") {
      clearPendingCredits();
      emitFailed(stored, status.message, options);
      return;
    }
    if (status.phase === "expired") {
      clearPendingCredits();
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
  options: CreditsOptions,
  spinner: ReturnType<typeof createSpinner>,
): Promise<void> {
  const stored = getPendingCredits();
  if (!stored) {
    if (options.json) {
      outputJson({ status: "MISSING_PENDING_CREDITS" });
      return;
    }
    exitWithError(
      "MISSING_PENDING_CREDITS",
      "No pending credits purchase. Run `helius credits` first.",
      undefined,
      !!options.json,
    );
  }
  spinner?.start("Polling credits status...");
  await pollAndEmit(stored!, stored!.txSignature, options, spinner);
}

// ────────────────────────────────────────────────────────────────────────────
// Output emitters
// ────────────────────────────────────────────────────────────────────────────

function emitPaymentRequired(
  stored: PendingCredits,
  reused: boolean,
  options: CreditsOptions,
): void {
  if (options.json) {
    outputJson({
      status: "PAYMENT_REQUIRED",
      paymentUrl: stored.paymentUrl,
      paymentIntentId: stored.paymentIntentId,
      projectId: stored.projectId,
      qty: stored.qty,
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
    console.log(
      chalk.gray("(Resuming previous credits purchase — re-run with --restart to start over.)"),
    );
  }
  console.log(
    chalk.bold(
      `Pay ${stored.amountCents / 100} USDC to top up ${stored.qty.toLocaleString()} × 1M credits:`,
    ),
  );
  console.log();
  console.log(`  ${chalk.cyan(stored.paymentUrl)}`);
  console.log();
  console.log(chalk.gray("Or send USDC directly to:"));
  console.log(chalk.gray(`  Treasury: ${stored.destinationWallet}`));
  console.log(chalk.gray(`  Memo:     ${stored.memo}`));
  console.log();
  console.log(chalk.gray("Once paid, run `helius credits --resume` to confirm locally."));
}

async function emitSuccess(
  stored: PendingCredits,
  txSignature: string | undefined,
  options: CreditsOptions,
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
      qty: stored.qty,
      paymentIntentId: stored.paymentIntentId,
      txSignature: resolvedTxSignature ?? null,
    });
    return;
  }
  console.log("\n" + chalk.green(`Topped up ${(stored.qty * 1_000_000).toLocaleString()} credits!`));
  if (resolvedTxSignature) {
    console.log(`Transaction: ${chalk.blue(`${TX_EXPLORER}/${resolvedTxSignature}`)}`);
  }
}

function emitPending(
  stored: PendingCredits,
  txSignature: string | undefined,
  options: CreditsOptions,
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
  console.log("\n" + chalk.yellow("Credits purchase still being confirmed."));
  console.log(`\n  Payment URL: ${chalk.cyan(stored.paymentUrl)}`);
  if (txSignature) {
    console.log(`  Transaction: ${chalk.blue(`${TX_EXPLORER}/${txSignature}`)}`);
  }
  console.log(chalk.gray(`\nRun \`helius credits --resume\` again in a moment.`));
}

function emitExpired(stored: PendingCredits, options: CreditsOptions): void {
  if (options.json) {
    outputJson({ status: "EXPIRED", paymentIntentId: stored.paymentIntentId });
    return;
  }
  console.error("\n" + chalk.red("Credits payment intent expired."));
  process.exit(ExitCode.GENERAL_ERROR);
}

function emitFailed(
  stored: PendingCredits,
  reason: string | undefined,
  options: CreditsOptions,
): void {
  if (options.json) {
    outputJson({
      status: "FAILED",
      paymentIntentId: stored.paymentIntentId,
      ...(reason && { reason }),
    });
    return;
  }
  console.error("\n" + chalk.red("Credits payment failed."));
  if (reason) console.error(chalk.gray(reason));
  process.exit(ExitCode.GENERAL_ERROR);
}

async function loadSecretKey(options: CreditsOptions): Promise<Uint8Array> {
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
