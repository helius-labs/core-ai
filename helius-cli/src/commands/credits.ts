import chalk from "chalk";
import { purchaseCredits as sdkPurchaseCredits } from "helius-sdk/auth/purchaseCredits";
import { signAuthMessage } from "helius-sdk/auth/signAuthMessage";
import { walletSignup } from "helius-sdk/auth/walletSignup";
import { loadKeypairFromFile, getAddress } from "../lib/wallet.js";
import { listProjects } from "../lib/api.js";
import { CLI_USER_AGENT } from "../constants.js";
import { canonicalizeCreditsTier, validateCreditsTier, validateQty } from "../lib/validation.js";
import {
  createSpinner,
  exitWithError,
  handleCommandError,
  outputJson,
  type OutputOptions,
} from "../lib/output.js";
import { printSolanaPayQR, buildSolanaPayUri } from "../lib/qr.js";
import { checkUsdcBalance } from "../lib/payment.js";
import { computeTierUsdc } from "../lib/checkout.js";

interface CreditsBuyOptions extends OutputOptions {
  keypair: string;
  tier?: string;
  qty?: string;
  project?: string;
  wait?: boolean;
  qr?: boolean;
}

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1_000;

async function waitForFunding(
  walletAddress: string,
  requiredUsdcRaw: bigint,
  spinner?: { start(text: string): void; succeed(text: string): void } | null,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    spinner?.start("Waiting for USDC...");
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const usdcBalance = await checkUsdcBalance(walletAddress);
      if (usdcBalance >= requiredUsdcRaw) {
        spinner?.succeed(
          `USDC received (${(Number(usdcBalance) / 1_000_000).toFixed(2)} USDC)`,
        );
        return true;
      }
    } catch {
      // Network blip — keep polling.
    }
  }
  console.error(chalk.red("\nTimed out waiting for funds (5 minutes)."));
  return false;
}

export async function creditsBuyCommand(options: CreditsBuyOptions): Promise<void> {
  const spinner = createSpinner(options);

  try {
    // Preserve canonical case (e.g. `10_USDC`) — the backend looks up
    // `prepaid_credits_${tier}` which is case-sensitive. Validate
    // case-insensitively but always forward the uppercase form.
    const rawTier = options.tier || "10_USDC";
    const tierErr = validateCreditsTier(rawTier);
    if (tierErr) exitWithError("INVALID_INPUT", tierErr, undefined, options.json);
    const tier = canonicalizeCreditsTier(rawTier) ?? "10_USDC";

    const qty = options.qty ? Number(options.qty) : 1;
    const qtyErr = validateQty(qty);
    if (qtyErr) exitWithError("INVALID_INPUT", qtyErr, undefined, options.json);

    spinner?.start("Loading keypair...");
    const keypair = await loadKeypairFromFile(options.keypair);
    const walletAddress = await getAddress(keypair);
    spinner?.succeed(`Wallet loaded: ${walletAddress}`);

    spinner?.start("Authenticating...");
    const { message, signature } = await signAuthMessage(keypair.secretKey);
    const auth = await walletSignup(message, signature, walletAddress, CLI_USER_AGENT);
    const jwt = auth.token;
    spinner?.succeed("Authenticated");

    // Resolve target project: explicit --project, else the wallet's first project.
    let projectId = options.project;
    if (!projectId) {
      const projects = await listProjects(jwt);
      if (projects.length === 0) {
        exitWithError(
          "NO_PROJECT",
          "No project found. Run `helius signup --plan=agent` first.",
          undefined,
          options.json,
        );
      }
      projectId = projects[0].id;
    }

    // Pre-check the payer wallet's USDC balance. The top-up is sponsored for
    // agent-plan users (no SOL required), but USDC is still paid by the user.
    // If insufficient, show a funding QR — same UX as signup.
    const tierUsdc = computeTierUsdc(tier);
    const requiredUsdcRaw = BigInt(tierUsdc) * BigInt(qty) * 1_000_000n;
    const usdcBalance = await checkUsdcBalance(walletAddress);
    if (usdcBalance < requiredUsdcRaw) {
      const missing = `${tierUsdc * qty} USDC (have ${(Number(usdcBalance) / 1_000_000).toFixed(2)})`;
      if (!options.wait) {
        if (options.json) {
          exitWithError(
            "INSUFFICIENT_FUNDS",
            `Need more funds: ${missing}`,
            { wallet: walletAddress, required: { usdc: `${tierUsdc * qty} USDC` } },
            options.json,
          );
        }
        console.error(chalk.red(`\nInsufficient USDC. Send to ${chalk.cyan(walletAddress)}:`));
        console.error(`  • ${missing}`);
        console.error(chalk.gray("  SOL fees are sponsored by Helius — only USDC is required."));
        if (options.qr !== false) {
          const qrUri = buildSolanaPayUri(walletAddress, tierUsdc * qty);
          await printSolanaPayQR(qrUri);
        }
        console.error(
          chalk.gray("\nThen rerun `helius credits buy`, or use `--wait` to poll until funded."),
        );
        process.exit(1);
      }
      // --wait path
      console.error(chalk.red(`\nInsufficient USDC. Send to ${chalk.cyan(walletAddress)}:`));
      console.error(`  • ${missing}`);
      if (options.qr !== false) {
        const qrUri = buildSolanaPayUri(walletAddress, tierUsdc * qty);
        await printSolanaPayQR(qrUri);
      }
      const funded = await waitForFunding(walletAddress, requiredUsdcRaw, spinner);
      if (!funded) process.exit(1);
    }

    spinner?.start(`Purchasing credits (${tier} × ${qty})...`);
    const result = await sdkPurchaseCredits(
      keypair.secretKey,
      jwt,
      { tier, qty, projectId },
      CLI_USER_AGENT,
    );

    if (result.status !== "completed") {
      spinner?.fail(`Purchase ${result.status}`);
      if (options.json) {
        outputJson({
          status: result.status.toUpperCase(),
          paymentIntentId: result.paymentIntentId,
          transaction: result.txSignature || null,
          error: result.error || null,
        });
        return;
      }
      console.error(chalk.red(`\nPurchase ${result.status}${result.error ? `: ${result.error}` : ""}`));
      if (result.txSignature) {
        console.error(`TX: ${chalk.blue(result.txSignature)}`);
      }
      process.exit(1);
    }

    spinner?.succeed("Credits purchased");
    const creditsAdded = qty * 1_000_000;
    if (options.json) {
      outputJson({
        status: "SUCCESS",
        projectId,
        tier,
        qty,
        creditsAdded,
        amountCents: result.amountCents,
        transaction: result.txSignature || null,
      });
      return;
    }

    console.log("\n" + chalk.green(`Added ${creditsAdded.toLocaleString()} credits to your agent plan`));
    console.log(`Project: ${chalk.cyan(projectId)}`);
    console.log(`Amount: $${(result.amountCents / 100).toFixed(2)}`);
    if (result.txSignature) {
      console.log(
        `Transaction: ${chalk.blue(`https://orbmarkets.io/tx/${result.txSignature}`)}`,
      );
    }
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}
