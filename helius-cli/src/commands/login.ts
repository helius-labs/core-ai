import chalk from "chalk";
import ora from "ora";
import { loadKeypairFromFile, signAuthMessage, getAddress } from "../lib/wallet.js";
import { signup } from "../lib/api.js";
import { setJwt } from "../lib/config.js";
import { keypairExists } from "./keygen.js";
import { outputJson, exitWithError, handleCommandError, type OutputOptions } from "../lib/output.js";

interface LoginOptions extends OutputOptions {
  keypair: string;
}

export async function loginCommand(options: LoginOptions): Promise<void> {
  const spinner = options.json ? null : ora();

  try {
    // Check keypair exists
    if (!keypairExists(options.keypair)) {
      exitWithError("KEYPAIR_NOT_FOUND", `Keypair not found at ${options.keypair}`, undefined, options.json);
    }

    // Load keypair
    spinner?.start("Loading keypair...");
    const keypair = await loadKeypairFromFile(options.keypair);
    const walletAddress = await getAddress(keypair);
    spinner?.succeed(`Wallet: ${chalk.cyan(walletAddress)}`);

    // Sign auth message
    spinner?.start("Signing authentication message...");
    const { message, signature } = await signAuthMessage(keypair.secretKey);
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
    console.log(`\nJWT saved to ~/.helius/config.json`);
  } catch (error) {
    handleCommandError(error, options, spinner, "AUTH_FAILED");
  }
}
