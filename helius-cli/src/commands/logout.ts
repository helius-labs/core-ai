import chalk from "chalk";
import { decodeJwtEmail } from "../lib/oauth.js";
import { getJwt, clearJwt, clearConfig, load } from "../lib/config.js";
import {
  outputJson,
  handleCommandError,
  createSpinner,
  confirmDestructive,
  type OutputOptions,
} from "../lib/output.js";

interface LogoutOptions extends OutputOptions {
  all?: boolean;
  yes?: boolean;
}

export async function logoutCommand(options: LogoutOptions): Promise<void> {
  const spinner = createSpinner(options);

  try {
    const existingJwt = getJwt();
    const email = existingJwt ? decodeJwtEmail(existingJwt) : null;
    const hadAnyConfig = Object.keys(load()).length > 0;

    if (!existingJwt && !options.all) {
      if (options.json) {
        outputJson({ status: "NOT_LOGGED_IN" });
        return;
      }
      console.log("Not logged in. Nothing to clear.");
      return;
    }

    if (options.all) {
      if (!(await confirmDestructive(
        chalk.yellow("\n  Wipe the entire local config (jwt, apiKey, projectId, network, owsWallet)? (y/N) "),
        options,
      ))) {
        console.log(chalk.gray("  Cancelled."));
        return;
      }
      clearConfig();
      spinner?.succeed("Cleared local config");
    } else {
      clearJwt();
      spinner?.succeed("Signed out");
    }

    if (options.json) {
      outputJson({
        status: "SIGNED_OUT",
        email,
        scope: options.all ? "all" : "jwt-only",
        hadConfig: hadAnyConfig,
      });
      return;
    }

    if (options.all) {
      console.log(chalk.gray("Cleared: jwt, apiKey, projectId, network, owsWallet"));
    } else {
      if (email) {
        console.log(`Signed out ${chalk.cyan(email)}.`);
      }
      console.log(
        chalk.gray(
          "Your API key (if set) is kept so RPC calls still work. Pass --all to wipe the entire local config.",
        ),
      );
    }
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}
