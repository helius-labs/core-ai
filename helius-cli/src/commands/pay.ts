import chalk from "chalk";
import ora from "ora";
import { loadKeypairFromFile, signAuthMessage, getAddress } from "../lib/wallet.js";
import { signup } from "../lib/api.js";
import { getPaymentIntent, executeRenewal } from "../lib/checkout.js";
import { setJwt } from "../lib/config.js";
import { keypairExists } from "./keygen.js";
import { formatEnumLabel } from "../lib/formatters.js";
import { outputJson, exitWithError, ExitCode, type OutputOptions } from "../lib/output.js";
import readline from "readline";

interface PayOptions extends OutputOptions {
  keypair: string;
  yes?: boolean;
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

export async function payCommand(paymentIntentId: string, options: PayOptions): Promise<void> {
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

    // 1. Load keypair and authenticate
    spinner?.start("Loading keypair...");
    const keypair = await loadKeypairFromFile(options.keypair);
    const walletAddress = await getAddress(keypair);
    spinner?.succeed(`Wallet: ${chalk.cyan(walletAddress)}`);

    spinner?.start("Authenticating...");
    const { message, signature } = await signAuthMessage(keypair.secretKey);
    const authResult = await signup(message, signature, walletAddress);
    setJwt(authResult.token);
    spinner?.succeed("Authenticated");

    // 2. Fetch payment intent details
    spinner?.start("Fetching payment intent...");
    const intent = await getPaymentIntent(authResult.token, paymentIntentId);
    spinner?.succeed("Payment intent loaded");

    const amountUsdc = intent.amount / 100;
    const expiresAt = new Date(intent.expiresAt).toLocaleString();

    if (!options.json) {
      console.log("");
      console.log(`  Payment ID:  ${chalk.cyan(intent.id)}`);
      console.log(`  Amount:      ${chalk.bold(`$${amountUsdc.toFixed(2)} USDC`)}`);
      console.log(`  Status:      ${formatEnumLabel(intent.status)}`);
      console.log(`  Expires:     ${expiresAt}`);
      console.log("");
    }

    if (intent.status !== "pending") {
      if (options.json) {
        exitWithError("PAYMENT_FAILED", `Payment intent is ${intent.status}, cannot pay`, { intentId: intent.id }, true);
      }
      spinner?.fail(`Payment intent is ${intent.status} — cannot pay`);
      process.exit(ExitCode.PAYMENT_FAILED);
    }

    if (!options.yes) {
      const ok = await confirm(`  Pay $${amountUsdc.toFixed(2)} USDC? (y/N) `);
      if (!ok) {
        console.log(chalk.gray("  Cancelled."));
        return;
      }
    }

    // 3. Execute renewal payment
    spinner?.start("Processing payment...");
    const result = await executeRenewal(
      keypair.secretKey,
      authResult.token,
      paymentIntentId,
    );

    if (result.status !== "completed") {
      throw new Error(
        `Payment ${result.status}${result.txSignature ? `. TX: ${result.txSignature}` : ""}`
      );
    }
    spinner?.succeed("Payment complete");

    if (options.json) {
      outputJson({
        status: "SUCCESS",
        paymentIntentId: intent.id,
        amount: intent.amount,
        transaction: result.txSignature,
      });
      return;
    }

    console.log("\n" + chalk.green("✓ Payment complete!"));
    if (result.txSignature) {
      console.log(`\nView transaction: ${chalk.blue(`https://orbmarkets.io/tx/${result.txSignature}`)}`);
    }
  } catch (error) {
    if (options.json) {
      exitWithError("PAYMENT_FAILED", error instanceof Error ? error.message : String(error), undefined, true);
    }
    spinner?.fail(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(ExitCode.GENERAL_ERROR);
  }
}
