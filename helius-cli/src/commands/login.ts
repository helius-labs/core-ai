import chalk from "chalk";
import ora from "ora";
import { loadKeypair, signAuthMessage, getAddress } from "../lib/wallet.js";
import { signup } from "../lib/api.js";
import { setJwt } from "../lib/config.js";
import { keypairExists } from "./keygen.js";
import { outputJson, exitWithError, ExitCode, type OutputOptions } from "../lib/output.js";

interface LoginOptions extends OutputOptions {
  keypair: string;
}

export async function loginCommand(options: LoginOptions): Promise<void> {
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

    // Load keypair
    spinner?.start("Loading keypair...");
    const keypair = await loadKeypair(options.keypair);
    const walletAddress = await getAddress(keypair);
    spinner?.succeed(`Wallet: ${chalk.cyan(walletAddress)}`);

    // Sign auth message
    spinner?.start("Signing authentication message...");
    const { message, signature } = signAuthMessage(keypair.secretKey);
    spinner?.succeed("Message signed");

    // Call login API
    spinner?.start("Authenticating...");
    const authResult = await signup(message, signature, walletAddress);
    setJwt(authResult.token);
    spinner?.succeed("Authenticated");

    if (options.json) {
      outputJson({
        wallet: walletAddress,
        authenticated: true,
      });
      return;
    }

    console.log("\n" + chalk.green("✓ Login successful!"));
    console.log(`\nJWT saved to ~/.helius-cli/config.json`);
  } catch (error) {
    if (options.json) {
      exitWithError("AUTH_FAILED", error instanceof Error ? error.message : String(error), undefined, true);
    }
    spinner?.fail(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(ExitCode.AUTH_FAILED);
  }
}
