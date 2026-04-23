import chalk from "chalk";
import { isOwsInstalled, listOwsWallets, getOwsSolanaAddress, validateWalletName } from "../lib/ows.js";
import { setOwsWallet, getOwsWallet, clearOwsWallet } from "../lib/config.js";
import { handleCommandError, createSpinner, type OutputOptions, outputJson } from "../lib/output.js";

// ── ows-link: link an OWS wallet as the active signing wallet ──

interface OwsLinkOptions extends OutputOptions {}

export async function owsLinkCommand(
  walletName: string,
  options: OwsLinkOptions = {},
): Promise<void> {
  const spinner = createSpinner(options);
  try {
    validateWalletName(walletName);

    spinner?.start("Checking OWS installation...");
    if (!(await isOwsInstalled())) {
      spinner?.stop();
      console.error(
        chalk.red("OWS CLI is not installed.") +
          "\n\nInstall it with:\n" +
          chalk.cyan(
            "  curl -fsSL https://docs.openwallet.sh/install.sh | bash",
          ) +
          "\n  or\n" +
          chalk.cyan("  npm install -g @open-wallet-standard/core"),
      );
      process.exit(1);
    }

    spinner?.start(`Looking up OWS wallet "${walletName}"...`);
    const solAddress = await getOwsSolanaAddress(walletName);
    spinner?.stop();

    setOwsWallet(walletName);

    if (options.json) {
      outputJson({ owsWallet: walletName, solanaAddress: solAddress });
      return;
    }

    console.log(chalk.green("✓ OWS wallet linked"));
    console.log(`  ${chalk.gray("Wallet:")}  ${chalk.cyan(walletName)}`);
    console.log(`  ${chalk.gray("Solana:")}  ${chalk.cyan(solAddress)}`);
    console.log("");
    console.log(
      chalk.gray(
        "Transactions signed via this wallet will use OWS policy-gated signing.",
      ),
    );
    console.log(
      chalk.gray("The private key never leaves the OWS encrypted vault."),
    );
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

// ── ows-unlink: remove the linked OWS wallet ──

export async function owsUnlinkCommand(
  options: OwsLinkOptions = {},
): Promise<void> {
  const current = getOwsWallet();
  if (!current) {
    if (options.json) {
      outputJson({ owsWallet: null });
      return;
    }
    console.log(chalk.yellow("No OWS wallet is currently linked."));
    return;
  }

  clearOwsWallet();

  if (options.json) {
    outputJson({ owsWallet: null, unlinked: current });
    return;
  }

  console.log(chalk.green(`✓ Unlinked OWS wallet "${current}"`));
}

// ── ows-status: show linked wallet + OWS info ──

export async function owsStatusCommand(
  options: OwsLinkOptions = {},
): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const installed = await isOwsInstalled();
    const linkedWallet = getOwsWallet();

    if (options.json) {
      const result: Record<string, unknown> = {
        installed,
        linkedWallet: linkedWallet ?? null,
        solanaAddress: null,
        wallets: [],
      };

      if (installed && linkedWallet) {
        try {
          result.solanaAddress = await getOwsSolanaAddress(linkedWallet);
        } catch {
          // wallet may have been deleted in OWS
        }
      }

      if (installed) {
        try {
          result.wallets = await listOwsWallets();
        } catch {
          // OWS may return unexpected format
        }
      }

      outputJson(result);
      return;
    }

    console.log(chalk.bold("\nOpen Wallet Standard (OWS)\n"));

    if (!installed) {
      console.log(`  ${chalk.gray("Installed:")} ${chalk.red("No")}`);
      console.log("");
      console.log("  Install with:");
      console.log(
        chalk.cyan(
          "    curl -fsSL https://docs.openwallet.sh/install.sh | bash",
        ),
      );
      return;
    }

    console.log(`  ${chalk.gray("Installed:")} ${chalk.green("Yes")}`);

    if (linkedWallet) {
      let solAddress = "unknown";
      try {
        solAddress = await getOwsSolanaAddress(linkedWallet);
      } catch {
        // wallet may have been deleted
      }
      console.log(
        `  ${chalk.gray("Linked wallet:")} ${chalk.cyan(linkedWallet)}`,
      );
      console.log(
        `  ${chalk.gray("Solana address:")} ${chalk.cyan(solAddress)}`,
      );
    } else {
      console.log(`  ${chalk.gray("Linked wallet:")} ${chalk.yellow("None")}`);
      console.log(
        chalk.gray(
          "\n  Link a wallet with: helius wallet ows-link <wallet-name>",
        ),
      );
    }

    // List available wallets
    spinner?.start("Listing OWS wallets...");
    try {
      const wallets = await listOwsWallets();
      spinner?.stop();
      if (wallets.length > 0) {
        console.log(`\n  ${chalk.gray("Available OWS wallets:")}`);
        for (const w of wallets) {
          const name = w.name || w.id;
          const marker = name === linkedWallet ? chalk.green(" (linked)") : "";
          console.log(`    • ${chalk.cyan(name)}${marker}`);
        }
      }
    } catch {
      spinner?.stop();
      // OWS wallet list may fail — not critical
    }

    console.log("");
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}
