import chalk from "chalk";
import {
  loadKeypairFromFile,
  signAuthMessage,
  getAddress,
} from "../lib/wallet.js";
import {
  walletSignup,
  payRenewal as sdkPayRenewal,
  payPaymentLink,
  getPaymentStatus,
  getPaymentIntent,
} from "../lib/api.js";
import { setJwt } from "../lib/config.js";
import { keypairExists } from "./keygen.js";
import {
  outputJson,
  exitWithError,
  ExitCode,
  handleCommandError,
  createSpinner,
  type OutputOptions,
} from "../lib/output.js";
import { checkSolBalance, checkUsdcBalance } from "../lib/payment.js";

interface PayOptions extends OutputOptions {
  keypair: string;
  pay?: boolean;
  resume?: boolean;
}

const CENTS_TO_USDC_RAW = 10_000n;
const SOL_FEE_THRESHOLD = 1_000_000n;
const TX_EXPLORER = "https://orbmarkets.io/tx";

/**
 * Phase 2 — `helius pay <paymentIntentId>` for renewal flows.
 *
 * Modes:
 *   - default (link): print the renewal payment URL, exit. User opens it
 *     in a browser or sends USDC + memo manually.
 *   - --pay: autopay USDC + memo from the local keypair, poll, surface
 *     SUCCESS / PENDING.
 *   - --resume: poll the existing intent, no USDC send.
 *
 * Renewals don't have a webhook activation gate (the subscription is
 * already active), so `readyToRedirect` flips on payment confirmation alone.
 */
export async function payCommand(
  paymentIntentId: string,
  options: PayOptions,
): Promise<void> {
  const spinner = createSpinner(options);

  try {
    // Always need a JWT to fetch the renewal intent + poll status.
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

    if (options.resume) {
      await pollAndEmit(auth.token, paymentIntentId, undefined, options, spinner);
      return;
    }

    if (options.pay) {
      await runPay(
        auth.token,
        paymentIntentId,
        keypair.secretKey,
        walletAddress,
        options,
        spinner,
      );
      return;
    }

    // Default: print the renewal link.
    spinner?.start("Fetching renewal payment intent...");
    const result = await sdkPayRenewal(auth.token, paymentIntentId);
    spinner?.succeed("Renewal link ready");

    if (options.json) {
      outputJson({
        status: "PAYMENT_REQUIRED",
        paymentUrl: result.paymentLink.paymentUrl,
        paymentIntentId: result.paymentLink.paymentIntentId,
        expiresAt: result.paymentLink.expiresAt,
        amountCents: result.paymentLink.amountCents,
        planName: result.paymentLink.planName,
        destinationWallet: result.paymentLink.destinationWallet,
        memo: result.paymentLink.memo,
        solanaPayUrl: result.paymentLink.solanaPayUrl,
      });
      return;
    }

    console.log();
    console.log(
      chalk.bold(
        `Pay ${result.paymentLink.amountCents / 100} USDC to renew your subscription:`,
      ),
    );
    console.log();
    console.log(`  ${chalk.cyan(result.paymentLink.paymentUrl)}`);
    console.log();
    console.log(chalk.gray("Or send USDC directly to:"));
    console.log(chalk.gray(`  Treasury: ${result.paymentLink.destinationWallet}`));
    console.log(chalk.gray(`  Memo:     ${result.paymentLink.memo}`));
    console.log();
    console.log(
      chalk.gray(
        `Once paid, run \`helius pay ${paymentIntentId} --resume\` to confirm locally.`,
      ),
    );
  } catch (error) {
    handleCommandError(error, options, spinner, "PAYMENT_FAILED");
  }
}

async function runPay(
  jwt: string,
  paymentIntentId: string,
  secretKey: Uint8Array,
  walletAddress: string,
  options: PayOptions,
  spinner: ReturnType<typeof createSpinner>,
): Promise<void> {
  spinner?.start("Fetching renewal intent...");
  const result = await sdkPayRenewal(jwt, paymentIntentId);
  const link = result.paymentLink;
  spinner?.succeed(`Renewal: ${link.amountCents / 100} USDC`);

  // Pre-flight balance check.
  spinner?.start("Checking wallet balance...");
  const sol = await checkSolBalance(walletAddress);
  const usdc = await checkUsdcBalance(walletAddress);
  const required = BigInt(link.amountCents) * CENTS_TO_USDC_RAW;
  if (sol < SOL_FEE_THRESHOLD) {
    spinner?.fail("Insufficient SOL for fees");
    exitWithError(
      "INSUFFICIENT_SOL",
      `Wallet ${walletAddress} needs ~0.001 SOL (have ${(Number(sol) / 1e9).toFixed(6)}).`,
      undefined,
      !!options.json,
    );
  }
  if (usdc < required) {
    spinner?.fail("Insufficient USDC");
    exitWithError(
      "INSUFFICIENT_USDC",
      `Wallet ${walletAddress} needs ${link.amountCents / 100} USDC (have ${(Number(usdc) / 1e6).toFixed(2)}).`,
      undefined,
      !!options.json,
    );
  }
  spinner?.succeed("Balance OK");

  spinner?.start(`Sending ${link.amountCents / 100} USDC + memo...`);
  const { txSignature } = await payPaymentLink(secretKey, link);
  spinner?.succeed(`Sent: ${txSignature}`);

  await pollAndEmit(jwt, paymentIntentId, txSignature, options, spinner);
}

async function pollAndEmit(
  jwt: string,
  paymentIntentId: string,
  txSignature: string | undefined,
  options: PayOptions,
  spinner: ReturnType<typeof createSpinner>,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  spinner?.start("Confirming payment...");

  while (Date.now() < deadline) {
    let status;
    try {
      status = await getPaymentStatus(jwt, paymentIntentId);
    } catch (error) {
      if (error instanceof Error && error.message.includes("410")) {
        emitExpired(paymentIntentId, options);
        return;
      }
      throw error;
    }
    if (status.readyToRedirect) {
      spinner?.succeed("Renewal complete");
      await emitSuccess(jwt, paymentIntentId, txSignature, options);
      return;
    }
    if (status.phase === "failed") {
      emitFailed(paymentIntentId, status.message, options);
      return;
    }
    if (status.phase === "expired") {
      emitExpired(paymentIntentId, options);
      return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }

  spinner?.warn("Polling timed out");
  emitPending(paymentIntentId, txSignature, options);
}

async function emitSuccess(
  jwt: string,
  paymentIntentId: string,
  txSignature: string | undefined,
  options: PayOptions,
): Promise<void> {
  // Backfill txSignature from the backend for browser-pay flows where the
  // SDK never saw the on-chain signature.
  let resolvedTxSignature = txSignature;
  if (!resolvedTxSignature) {
    try {
      const intent = await getPaymentIntent(jwt, paymentIntentId);
      resolvedTxSignature = intent.txSignature;
    } catch {
      // Best-effort.
    }
  }

  if (options.json) {
    outputJson({
      status: "SUCCESS",
      paymentIntentId,
      txSignature: resolvedTxSignature ?? null,
    });
    return;
  }
  console.log("\n" + chalk.green("Renewal payment complete!"));
  if (resolvedTxSignature) {
    console.log(`Transaction: ${chalk.blue(`${TX_EXPLORER}/${resolvedTxSignature}`)}`);
  }
}

function emitPending(
  paymentIntentId: string,
  txSignature: string | undefined,
  options: PayOptions,
): void {
  if (options.json) {
    outputJson({
      status: "PENDING",
      paymentIntentId,
      ...(txSignature && { txSignature }),
    });
    return;
  }
  console.log("\n" + chalk.yellow("Payment is still being confirmed."));
  if (txSignature) {
    console.log(`Transaction: ${chalk.blue(`${TX_EXPLORER}/${txSignature}`)}`);
  }
  console.log(
    chalk.gray(
      `\nRun \`helius pay ${paymentIntentId} --resume\` again in a moment.`,
    ),
  );
}

function emitExpired(paymentIntentId: string, options: PayOptions): void {
  if (options.json) {
    outputJson({ status: "EXPIRED", paymentIntentId });
    return;
  }
  console.error("\n" + chalk.red("Payment intent expired."));
  process.exit(ExitCode.GENERAL_ERROR);
}

function emitFailed(
  paymentIntentId: string,
  reason: string | undefined,
  options: PayOptions,
): void {
  if (options.json) {
    outputJson({
      status: "FAILED",
      paymentIntentId,
      ...(reason && { reason }),
    });
    return;
  }
  console.error("\n" + chalk.red("Payment failed."));
  if (reason) console.error(chalk.gray(reason));
  process.exit(ExitCode.GENERAL_ERROR);
}
