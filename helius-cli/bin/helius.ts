#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { signupCommand } from "../src/commands/signup.js";
import { upgradeCommand } from "../src/commands/upgrade.js";
import { payCommand } from "../src/commands/pay.js";
import { creditsCommand } from "../src/commands/credits.js";
import { loginCommand } from "../src/commands/login.js";
import { logoutCommand } from "../src/commands/logout.js";
import { whoamiCommand } from "../src/commands/whoami.js";
import { projectsCommand } from "../src/commands/projects.js";
import { projectCommand } from "../src/commands/project.js";
import { apikeysCommand, createApiKeyCommand } from "../src/commands/apikeys.js";
import { usageCommand } from "../src/commands/usage.js";
import { statusCommand } from "../src/commands/status.js";
import { plansCommand } from "../src/commands/plans.js";
import { rpcCommand } from "../src/commands/rpc.js";
import { keygenCommand, getDefaultKeypairPath } from "../src/commands/keygen.js";
import { configShowCommand, configSetApiKeyCommand, configSetNetworkCommand, configSetProjectCommand, configClearCommand } from "../src/commands/config-cmd.js";
import { balanceCommand, tokensCommand, tokenHoldersCommand } from "../src/commands/balance.js";
import { txParseCommand, txHistoryCommand, txTransfersCommand, txFeesCommand } from "../src/commands/tx.js";
import {
  assetGetCommand, assetBatchCommand, assetOwnerCommand, assetCreatorCommand,
  assetAuthorityCommand, assetCollectionCommand, assetSearchCommand,
  assetProofCommand, assetProofBatchCommand, assetEditionsCommand,
  assetSignaturesCommand, assetTokenAccountsCommand,
} from "../src/commands/asset.js";
import { accountCommand } from "../src/commands/account.js";
import { networkStatusCommand } from "../src/commands/network-status.js";
import { blockCommand } from "../src/commands/block.js";
import {
  walletIdentityCommand, walletIdentityBatchCommand, walletBalancesCommand,
  walletHistoryCommand, walletTransfersCommand, walletFundedByCommand,
} from "../src/commands/wallet.js";
import {
  webhookListCommand, webhookGetCommand, webhookCreateCommand,
  webhookUpdateCommand, webhookDeleteCommand,
} from "../src/commands/webhook.js";
import { programAccountsCommand, programAccountsAllCommand, programTokenAccountsCommand } from "../src/commands/program.js";
import {
  stakeAccountsCommand, stakeWithdrawableCommand, stakeInstructionsCommand,
  stakeUnstakeInstructionCommand, stakeWithdrawInstructionCommand,
  stakeCreateCommand, stakeUnstakeCommand, stakeWithdrawCommand,
} from "../src/commands/stake.js";
import {
  zkAccountCommand, zkAccountsByOwnerCommand, zkBalanceCommand, zkBalanceByOwnerCommand,
  zkTokenHoldersCommand, zkTokenBalanceCommand, zkTokenAccountsByOwnerCommand,
  zkTokenAccountsByDelegateCommand, zkTokenBalancesByOwnerCommand,
  zkProofCommand, zkProofsCommand, zkMultipleAccountsCommand, zkAddressProofsCommand,
  zkSignaturesAccountCommand, zkSignaturesAddressCommand, zkSignaturesOwnerCommand,
  zkSignaturesTokenOwnerCommand, zkLatestSignaturesCommand, zkLatestNonVotingCommand,
  zkTxCommand, zkValidityProofCommand, zkIndexerHealthCommand, zkIndexerSlotCommand,
  zkSignaturesForAssetCommand,
} from "../src/commands/zk.js";
import { sendBroadcastCommand, sendRawCommand, sendSenderCommand, sendPollCommand, sendComputeUnitsCommand } from "../src/commands/send.js";
import { reclaimCommand } from "../src/commands/reclaim.js";
import { wsAccountCommand, wsLogsCommand, wsSlotCommand, wsSignatureCommand, wsProgramCommand } from "../src/commands/ws.js";
import { simdListCommand, simdGetCommand } from "../src/commands/simd.js";
import { owsLinkCommand, owsUnlinkCommand, owsStatusCommand } from "../src/commands/ows.js";
import { updateCommand } from "../src/commands/update.js";
import { completionsCommand } from "../src/commands/completions.js";
import { VERSION } from "../src/constants.js";
import { setDebugEnabled, exitWithError, handleCommandError, printFeedbackPrompt } from "../src/lib/output.js";
import { sendCommandEvent, sendCliFeedback, setCurrentCommand } from "../src/lib/feedback.js";

// Detect --json before Commander parses so boundary-path handlers below
// (Commander errors + uncaught exceptions) know whether to emit an envelope
// or human-readable text. Per-command --json flags live in argv either way.
const isJsonMode = process.argv.includes("--json");

// Keep uncaught rejections/exceptions from printing raw stack traces under
// --json, which would break the envelope contract for consumers.
process.on("unhandledRejection", (reason) => {
  if (isJsonMode) {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    handleCommandError(error, { json: true });
  }
  // Non-JSON mode: let Node's default handler print the stack.
  throw reason;
});

process.on("uncaughtException", (error) => {
  if (isJsonMode) {
    handleCommandError(error, { json: true });
  }
  throw error;
});

const program = new Command();

program
  .name("helius")
  .description("Helius CLI — manage accounts, query Solana data, and interact with the Helius platform")
  .version(VERSION)
  .option("--api-key <key>", "Helius API key")
  .option("--network <net>", "Network: mainnet or devnet", "mainnet")
  .option("--retry <n>", "Retry transient errors (429, 5xx, network) up to n times with exponential backoff", "0")
  .option("--debug", "Log HTTP request/response details to stderr for troubleshooting")
  .hook('preAction', (_thisCommand, actionCommand) => {
    if (program.opts().debug) setDebugEnabled(true);
    setCurrentCommand(actionCommand.name());
    sendCommandEvent(actionCommand.name());
  })
  .hook('postAction', (_thisCommand, actionCommand) => {
    const cmd = actionCommand.name();
    if (!actionCommand.opts().json && cmd !== 'feedback') {
      printFeedbackPrompt(cmd);
    }
  });

// Helper to merge global opts into subcommand opts
function opts(cmd: any): any {
  return { ...program.opts(), ...cmd.opts() };
}

// ── Account management (existing) ──

program
  .command("keygen")
  .description("Generate a new Solana keypair")
  .option("-o, --output <path>", "Output path for keypair", getDefaultKeypairPath())
  .option("-f, --force", "Overwrite existing keypair")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius keygen
  $ helius keygen --output ~/my-keypair.json
  $ helius keygen --force --json`)
  .action(function(this: any) { keygenCommand(opts(this)); });

program
  .command("signup")
  .description("Create a Helius account via crypto checkout (default plan: agent — $10 USDC one-time, 1M starting credits)")
  .option("-k, --keypair <path>", "Path to Solana keypair file", getDefaultKeypairPath())
  .option(
    "--plan <plan>",
    "Plan: agent ($10 one-time, default), developer ($49/mo), business ($499/mo), professional ($999/mo)",
    "agent",
  )
  .option("--period <period>", "Billing period: monthly or yearly (subscription plans only)", "monthly")
  .option("--coupon <code>", "Coupon code")
  .option("--email <email>", "Email address (required for fresh signup)")
  .option("--first-name <name>", "First name (required for fresh signup)")
  .option("--last-name <name>", "Last name (required for fresh signup)")
  .option("--discovery-path <text>", "How did you discover Helius?")
  .option("--friction-points <text>", "What friction did you hit finding or setting up Helius?")
  .option("--pay", "Auto-pay USDC + memo from the local keypair instead of printing only the link")
  .option("--resume", "Poll an existing pending signup intent stored in config, then provision the API key")
  .option("--restart", "Discard any stored pending signup and start a fresh one")
  .option("--json", "Output in JSON format")
  .addHelpText("after", `
Examples:
  $ helius signup --email you@example.com --first-name Jane --last-name Doe
      Default link mode — prints a hosted-checkout URL and exits.
      Open the URL in a browser, pay USDC, then run \`helius signup --resume\`
      to finish setup. Re-running this command without --restart re-prints the
      stored link instead of creating a duplicate intent.

  $ helius signup --pay --email you@example.com --first-name Jane --last-name Doe
      Auto-pay flow — the CLI keypair sends USDC + memo to the treasury and
      polls activation. On poll timeout, prints PENDING with the txSignature
      so you can resume later.

  $ helius signup --resume
      Polls the stored intent and provisions the API key when the backend
      reports the subscription is active. Does NOT load the keypair.

  $ helius signup --restart --plan developer --period yearly ...
      Discards the stored pending intent and starts a fresh signup.`)
  .action(function (this: any) { signupCommand(opts(this)); });

program
  .command("upgrade")
  .description("Upgrade your Helius plan via crypto checkout")
  .option("--plan <name>", "Target plan: developer, business, professional")
  .option("--period <period>", "Billing period: monthly or yearly", "monthly")
  .option("--coupon <code>", "Coupon code")
  .option("--email <email>", "Email (only needed for first-time upgrades; backend auto-fetches otherwise)")
  .option("--first-name <name>", "First name (only needed for first-time upgrades)")
  .option("--last-name <name>", "Last name (only needed for first-time upgrades)")
  .option("-k, --keypair <path>", "Path to Solana keypair file", getDefaultKeypairPath())
  .option("--pay", "Auto-pay USDC + memo from the local keypair")
  .option("--resume", "Poll an existing pending upgrade stored in config")
  .option("--restart", "Discard any stored pending upgrade and start fresh")
  .option("--json", "Output in JSON format")
  .addHelpText("after", `
Examples:
  $ helius upgrade --plan business --period yearly
      Print the upgrade payment URL and exit. Open it in a browser, pay USDC,
      then run \`helius upgrade --resume\` to confirm locally.

  $ helius upgrade --plan developer --pay
      Auto-pay from the local keypair, poll activation, surface SUCCESS / PENDING.

  $ helius upgrade --resume
      Poll the stored pending upgrade and confirm activation.`)
  .action(function (this: any) { upgradeCommand(opts(this)); });

program
  .command("pay <payment-intent-id>")
  .description("Pay an existing renewal payment intent (e.g., from email)")
  .option("-k, --keypair <path>", "Path to Solana keypair file", getDefaultKeypairPath())
  .option("--pay", "Auto-pay USDC + memo from the local keypair")
  .option("--resume", "Poll status of an in-flight payment")
  .option("--json", "Output in JSON format")
  .addHelpText("after", `
Examples:
  $ helius pay pi_abc123
      Print the renewal payment URL and exit. Open it in a browser to pay.

  $ helius pay pi_abc123 --pay
      Auto-pay USDC + memo from the local keypair, poll until confirmed.

  $ helius pay pi_abc123 --resume
      Poll status of an already-sent payment.`)
  .action(function (this: any, id: string) { payCommand(id, opts(this)); });

program
  .command("credits")
  .description("Buy prepaid credits as a one-time USDC top-up. Agent plan only ($10 per 1M credits). Subscription plans (developer/business/professional) handle overage at $5/M auto-billed on the subscription — they cannot use this command.")
  .option("--qty <n>", "Quantity multiplier (each unit = 1M credits at $10 USDC)", "1")
  .option("--coupon <code>", "Coupon code")
  .option("-k, --keypair <path>", "Path to Solana keypair file", getDefaultKeypairPath())
  .option("--pay", "Auto-pay USDC + memo from the local keypair")
  .option("--resume", "Poll an existing pending credits purchase")
  .option("--restart", "Discard any stored pending credits purchase and start fresh")
  .option("--json", "Output in JSON format")
  .addHelpText("after", `
Examples:
  $ helius credits --qty 2
      Print the payment URL for 2 × 1M credits ($20 USDC). Open in browser.

  $ helius credits --pay
      Auto-pay 1 × 1M credits from the local keypair.

  $ helius credits --resume
      Poll the stored pending credits purchase.`)
  .action(function (this: any) { creditsCommand(opts(this)); });

program
  .command("login")
  .description("Authenticate with your Helius account in the browser (OAuth/PKCE)")
  .option("--json", "Output in JSON format")
  .option("--no-browser", "Print URL instead of opening the browser")
  .addHelpText('after', `
Examples:
  $ helius login
  $ helius login --no-browser
  $ helius login --json

Wallet-based account creation continues to work via \`helius signup\`.`)
  .action(loginCommand);

program
  .command("logout")
  .description("Sign out and clear the local session token (keeps API key by default)")
  .option("--all", "Wipe the entire local config (jwt, apiKey, projectId, network, owsWallet)")
  .option("-y, --yes", "Skip confirmation prompt (only relevant with --all)")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius logout
  $ helius logout --all
  $ helius logout --json`)
  .action(logoutCommand);

program
  .command("whoami")
  .description("Show the current authenticated identity, session expiry, and local config")
  .option("--verify", "Also verify the session token against the backend (one API call)")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius whoami
  $ helius whoami --verify
  $ helius whoami --json`)
  .action(whoamiCommand);

program
  .command("projects")
  .description("List all projects")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius projects
  $ helius projects --json`)
  .action(projectsCommand);

program
  .command("project [id]")
  .description("Get project details")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius project
  $ helius project proj_abc123 --json`)
  .action(projectCommand);

const apikeysCmd = program
  .command("apikeys [project-id]")
  .description("List all API keys for project (or use 'apikeys create')")
  .option("--json", "Output in JSON format");

apikeysCmd
  .command("create [project-id]")
  .description("Create new API key for project")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius apikeys create
  $ helius apikeys create proj_abc123 --json`)
  .action(function(this: any, projectId: string) {
    createApiKeyCommand(projectId, { json: this.opts().json || process.argv.includes("--json") });
  });

apikeysCmd.action(apikeysCommand);

program
  .command("usage [project-id]")
  .description("Show credits usage for project")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius usage
  $ helius usage proj_abc123 --json`)
  .action(usageCommand);

program
  .command("status")
  .description("Show account status: plan, credits, billing cycle")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius status
  $ helius status --json`)
  .action(statusCommand);

program
  .command("plans")
  .description("List available Helius plans and pricing")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius plans
  $ helius plans --json`)
  .action(plansCommand);

program
  .command("rpc [project-id]")
  .description("Show RPC endpoints for project")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius rpc
  $ helius rpc proj_abc123 --json`)
  .action(rpcCommand);

// ── Config ──

const configCmd = program
  .command("config")
  .description("Manage CLI configuration");

configCmd
  .command("show")
  .description("Show current configuration")
  .option("--reveal", "Show full API key (not truncated)")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius config show
  $ helius config show --reveal --json`)
  .action(function(this: any) { configShowCommand(opts(this)); });

configCmd
  .command("set-api-key <key>")
  .description("Set Helius API key")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius config set-api-key your-api-key-here`)
  .action(function(this: any, key: string) { configSetApiKeyCommand(key, opts(this)); });

configCmd
  .command("set-network <network>")
  .description("Set network (mainnet or devnet)")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius config set-network devnet
  $ helius config set-network mainnet`)
  .action(function(this: any, network: string) { configSetNetworkCommand(network, opts(this)); });

configCmd
  .command("set-project <id>")
  .description("Set default project ID")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius config set-project proj_abc123`)
  .action(function(this: any, id: string) { configSetProjectCommand(id, opts(this)); });

configCmd
  .command("clear")
  .description("Clear all configuration")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius config clear`)
  .action(function(this: any) { configClearCommand(opts(this)); });

// ── Balance & tokens ──

program
  .command("balance <address>")
  .description("Get native SOL balance")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius balance 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY
  $ helius balance 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json
  $ helius balance 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --network devnet`)
  .action(function(this: any, address: string) { balanceCommand(address, opts(this)); });

program
  .command("tokens <address>")
  .description("Get fungible token balances")
  .option("--limit <n>", "Max tokens to return")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius tokens 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY
  $ helius tokens 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --limit 50 --json`)
  .action(function(this: any, address: string) { tokensCommand(address, opts(this)); });

program
  .command("token-holders <mint>")
  .description("Get top holders of a token")
  .option("--limit <n>", "Max holders to return")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius token-holders EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
  $ helius token-holders EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --limit 10 --json`)
  .action(function(this: any, mint: string) { tokenHoldersCommand(mint, opts(this)); });

// ── Transactions ──

const txCmd = program
  .command("tx")
  .description("Transaction commands");

txCmd
  .command("parse <signatures...>")
  .description("Parse transaction(s) into human-readable format")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius tx parse 5UfDuX7hXbDjdMRbQMCbNvPZQEr4mEAMq3fNM7oKnUFqpEygPoAEsm2MFVwfCaG1CjprB2og8LmNVBLMrACG7L4
  $ helius tx parse sig1 sig2 sig3 --json`)
  .action(function(this: any, signatures: string[]) { txParseCommand(signatures, opts(this)); });

txCmd
  .command("history <address>")
  .description("Get enhanced transaction history")
  .option("--limit <n>", "Max transactions")
  .option("--before <sig>", "Cursor: start before this signature")
  .option("--type <type>", "Filter by transaction type")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius tx history 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY
  $ helius tx history 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --limit 5 --type SWAP --json`)
  .action(function(this: any, address: string) { txHistoryCommand(address, opts(this)); });

txCmd
  .command("transfers <address>")
  .description("List parsed token + SOL transfers for an address (RPC, rich filters)")
  .option("-l, --limit <n>", "Max transfers per page (1-100, default 25)")
  .option("--sort-order <order>", "asc | desc", "desc")
  .option("--mint <mint>", "Filter by token mint address")
  .option("--direction <dir>", "in | out | any", "any")
  .option("--with <addr>", "Filter by counterparty address")
  .option("--pagination-token <token>", "Cursor from a previous response")
  .option("--block-time-gte <ts>", "Unix seconds lower bound")
  .option("--block-time-lte <ts>", "Unix seconds upper bound")
  .option("--slot-gte <slot>", "Slot lower bound")
  .option("--slot-lte <slot>", "Slot upper bound")
  .option("--amount-gte <raw>", "Raw u64 amount lower bound (not UI amount)")
  .option("--amount-lte <raw>", "Raw u64 amount upper bound (not UI amount)")
  .option("--sol-mode <mode>", "merged | separate — treat SOL/WSOL as one asset, or keep distinct")
  .option("--commitment <level>", "finalized | confirmed")
  .option("--json", "Output JSON envelope")
  .addHelpText('after', `
Examples:
  $ helius tx transfers 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --limit 5
  $ helius tx transfers <addr> --mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --direction in
  $ helius tx transfers <addr> --with <counterparty> --block-time-gte 1700000000 --json`)
  .action(function(this: any, address: string) { txTransfersCommand(address, opts(this)); });

txCmd
  .command("fees")
  .description("Get priority fee estimates")
  .option("--accounts <addrs>", "Comma-separated account addresses")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius tx fees
  $ helius tx fees --accounts JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 --json`)
  .action(function(this: any) { txFeesCommand(opts(this)); });

// ── Assets (DAS API) ──

const assetCmd = program
  .command("asset")
  .description("Digital asset (DAS API) commands");

assetCmd
  .command("get <id>")
  .description("Get asset details by mint address")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius asset get EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
  $ helius asset get EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --json`)
  .action(function(this: any, id: string) { assetGetCommand(id, opts(this)); });

assetCmd
  .command("batch <ids...>")
  .description("Get multiple assets by mint addresses")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius asset batch EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v So11111111111111111111111111111111111111112 --json`)
  .action(function(this: any, ids: string[]) { assetBatchCommand(ids, opts(this)); });

assetCmd
  .command("owner <address>")
  .description("Get assets by owner")
  .option("--page <n>", "Page number")
  .option("--limit <n>", "Results per page")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius asset owner 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY
  $ helius asset owner 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --limit 50 --json`)
  .action(function(this: any, address: string) { assetOwnerCommand(address, opts(this)); });

assetCmd
  .command("creator <address>")
  .description("Get assets by creator")
  .option("--page <n>", "Page number")
  .option("--limit <n>", "Results per page")
  .option("--verified", "Only verified creators")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius asset creator J1S9H3QjnRtBbbuD4HjPV6RpRhwuk4zKbxsnCHuTgh9w --verified --json`)
  .action(function(this: any, address: string) { assetCreatorCommand(address, opts(this)); });

assetCmd
  .command("authority <address>")
  .description("Get assets by authority")
  .option("--page <n>", "Page number")
  .option("--limit <n>", "Results per page")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius asset authority 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any, address: string) { assetAuthorityCommand(address, opts(this)); });

assetCmd
  .command("collection <address>")
  .description("Get assets in a collection")
  .option("--page <n>", "Page number")
  .option("--limit <n>", "Results per page")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius asset collection J1S9H3QjnRtBbbuD4HjPV6RpRhwuk4zKbxsnCHuTgh9w --limit 20 --json`)
  .action(function(this: any, address: string) { assetCollectionCommand(address, opts(this)); });

assetCmd
  .command("search")
  .description("Search assets with filters")
  .option("--owner <addr>", "Filter by owner")
  .option("--creator <addr>", "Filter by creator")
  .option("--authority <addr>", "Filter by authority")
  .option("--compressed", "Filter compressed NFTs")
  .option("--burnt", "Filter burnt assets")
  .option("--frozen", "Filter frozen assets")
  .option("--page <n>", "Page number")
  .option("--limit <n>", "Results per page")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius asset search --owner 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --compressed
  $ helius asset search --creator J1S9H3QjnRtBbbuD4HjPV6RpRhwuk4zKbxsnCHuTgh9w --json`)
  .action(function(this: any) { assetSearchCommand(opts(this)); });

assetCmd
  .command("proof <id>")
  .description("Get Merkle proof for compressed NFT")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius asset proof <compressed-nft-mint> --json`)
  .action(function(this: any, id: string) { assetProofCommand(id, opts(this)); });

assetCmd
  .command("proof-batch <ids...>")
  .description("Get Merkle proofs for multiple compressed NFTs")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius asset proof-batch <mint1> <mint2> --json`)
  .action(function(this: any, ids: string[]) { assetProofBatchCommand(ids, opts(this)); });

assetCmd
  .command("editions <mint>")
  .description("Get NFT editions for a master NFT")
  .option("--page <n>", "Page number")
  .option("--limit <n>", "Results per page")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius asset editions <master-nft-mint> --limit 10 --json`)
  .action(function(this: any, mint: string) { assetEditionsCommand(mint, opts(this)); });

assetCmd
  .command("signatures <id>")
  .description("Get transaction signatures for an asset")
  .option("--page <n>", "Page number")
  .option("--limit <n>", "Results per page")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius asset signatures EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --json`)
  .action(function(this: any, id: string) { assetSignaturesCommand(id, opts(this)); });

assetCmd
  .command("token-accounts")
  .description("Query token accounts by owner and/or mint")
  .option("--owner <addr>", "Filter by owner")
  .option("--mint <addr>", "Filter by mint")
  .option("--page <n>", "Page number")
  .option("--limit <n>", "Results per page")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius asset token-accounts --owner 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY
  $ helius asset token-accounts --mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --json`)
  .action(function(this: any) { assetTokenAccountsCommand(opts(this)); });

// ── Account info ──

program
  .command("account <address>")
  .description("Get Solana account info")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius account 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY
  $ helius account TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA --json`)
  .action(function(this: any, address: string) { accountCommand(address, opts(this)); });

// ── Network status ──

program
  .command("network-status")
  .description("Get Solana network status")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius network-status
  $ helius network-status --json`)
  .action(function(this: any) { networkStatusCommand(opts(this)); });

// ── Block ──

program
  .command("block <slot>")
  .description("Get block details by slot number")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius block 250000000
  $ helius block 250000000 --json`)
  .action(function(this: any, slot: string) { blockCommand(slot, opts(this)); });

// ── Wallet API (REST) ──

const walletCmd = program
  .command("wallet")
  .description("Wallet API commands (balances, identity, history)");

walletCmd
  .command("identity <address-or-domain>")
  .description("Look up wallet identity (accepts address or SNS/ANS domain, mainnet only for domains)")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius wallet identity 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY
  $ helius wallet identity toly.sol
  $ helius wallet identity helius.bonk`)
  .action(function(this: any, address: string) { walletIdentityCommand(address, opts(this)); });

walletCmd
  .command("identity-batch <entries...>")
  .description("Look up identities for multiple wallets (accepts addresses and/or SNS/ANS domains)")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius wallet identity-batch 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA --json
  $ helius wallet identity-batch toly.sol 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY`)
  .action(function(this: any, addresses: string[]) { walletIdentityBatchCommand(addresses, opts(this)); });

walletCmd
  .command("balances <address>")
  .description("Get all token balances with USD values")
  .option("--show-nfts", "Include NFT balances")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius wallet balances 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY
  $ helius wallet balances 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --show-nfts --json`)
  .action(function(this: any, address: string) { walletBalancesCommand(address, opts(this)); });

walletCmd
  .command("history <address>")
  .description("Get transaction history with balance changes")
  .option("--limit <n>", "Number of results")
  .option("--type <type>", "Filter by transaction type")
  .option("--before <cursor>", "Pagination cursor")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius wallet history 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --limit 10
  $ helius wallet history 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --type SWAP --json`)
  .action(function(this: any, address: string) { walletHistoryCommand(address, opts(this)); });

walletCmd
  .command("transfers <address>")
  .description("Get token transfers with sender/recipient info")
  .option("--limit <n>", "Number of results")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius wallet transfers 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --limit 20 --json`)
  .action(function(this: any, address: string) { walletTransfersCommand(address, opts(this)); });

walletCmd
  .command("funded-by <address>")
  .description("Find original funding source of a wallet")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius wallet funded-by 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any, address: string) { walletFundedByCommand(address, opts(this)); });

walletCmd
  .command("ows-link <wallet-name>")
  .description("Link an OWS wallet for policy-gated signing (requires ows CLI)")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius wallet ows-link my-wallet`)
  .action(function(this: any, name: string) { owsLinkCommand(name, opts(this)); });

walletCmd
  .command("ows-unlink")
  .description("Remove the linked OWS wallet")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius wallet ows-unlink`)
  .action(function(this: any) { owsUnlinkCommand(opts(this)); });

walletCmd
  .command("ows-status")
  .description("Show OWS installation status and linked wallet")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius wallet ows-status`)
  .action(function(this: any) { owsStatusCommand(opts(this)); });

// ── Webhooks ──

const webhookCmd = program
  .command("webhook")
  .description("Webhook management commands");

webhookCmd
  .command("list")
  .description("List all webhooks")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius webhook list
  $ helius webhook list --json`)
  .action(function(this: any) { webhookListCommand(opts(this)); });

webhookCmd
  .command("get <id>")
  .description("Get webhook details")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius webhook get wh_abc123 --json`)
  .action(function(this: any, id: string) { webhookGetCommand(id, opts(this)); });

webhookCmd
  .command("create")
  .description("Create a webhook")
  .requiredOption("--url <url>", "Webhook URL endpoint")
  .requiredOption("--accounts <addrs>", "Comma-separated addresses to monitor")
  .requiredOption("--types <types>", "Comma-separated transaction types (or ANY)")
  .option("--webhook-type <type>", "Webhook type: enhanced, raw, or discord", "enhanced")
  .option("--dry-run", "Preview webhook config without creating")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius webhook create --url https://example.com/hook --accounts 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --types ANY
  $ helius webhook create --url https://example.com/hook --accounts addr1,addr2 --types SWAP,TRANSFER --json`)
  .action(function(this: any) { webhookCreateCommand(opts(this)); });

webhookCmd
  .command("update <id>")
  .description("Update a webhook")
  .option("--url <url>", "New webhook URL")
  .option("--accounts <addrs>", "New comma-separated addresses")
  .option("--types <types>", "New comma-separated transaction types")
  .option("--dry-run", "Preview changes without updating")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius webhook update wh_abc123 --url https://example.com/new-hook
  $ helius webhook update wh_abc123 --accounts addr1,addr2 --json`)
  .action(function(this: any, id: string) { webhookUpdateCommand(id, opts(this)); });

webhookCmd
  .command("delete <id>")
  .description("Delete a webhook")
  .option("--dry-run", "Preview which webhook would be deleted")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius webhook delete wh_abc123`)
  .action(function(this: any, id: string) { webhookDeleteCommand(id, opts(this)); });

// ── Program accounts ──

const programCmd = program
  .command("program")
  .description("Program account commands");

programCmd
  .command("accounts <program-id>")
  .description("Get accounts owned by a program")
  .option("--data-size <n>", "Filter by account data size")
  .option("--limit <n>", "Max accounts to return")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius program accounts TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA --limit 10
  $ helius program accounts TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA --data-size 165 --json`)
  .action(function(this: any, programId: string) { programAccountsCommand(programId, opts(this)); });

programCmd
  .command("accounts-all <program-id>")
  .description("Get all accounts owned by a program (auto-paginate)")
  .option("--data-size <n>", "Filter by account data size")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius program accounts-all TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA --json`)
  .action(function(this: any, programId: string) { programAccountsAllCommand(programId, opts(this)); });

programCmd
  .command("token-accounts <owner>")
  .description("Get token accounts by owner")
  .option("--limit <n>", "Max accounts to return")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius program token-accounts 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any, owner: string) { programTokenAccountsCommand(owner, opts(this)); });

// ── Staking ──

const stakeCmd = program
  .command("stake")
  .description("Staking commands");

stakeCmd
  .command("create [amount]")
  .description("Create a stake transaction. Accepts positional SOL, --amount <sol>, or --raw-amount <lamports>.")
  .option("-k, --keypair <path>", "Path to Solana keypair file")
  .option("--amount <sol>", "Amount in SOL (e.g. 1.5) — alternative to positional")
  .option("--raw-amount <lamports>", "Amount in lamports (e.g. 1500000000) — exact, avoids float rounding")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius stake create 1.5 -k ~/.helius/keypair.json
  $ helius stake create --amount 1.5 -k ~/.helius/keypair.json
  $ helius stake create --raw-amount 1500000000 -k ~/.helius/keypair.json --json`)
  .action(function(this: any, amount: string | undefined) { stakeCreateCommand(amount, opts(this)); });

stakeCmd
  .command("unstake <stake-account>")
  .description("Create an unstake transaction")
  .option("-k, --keypair <path>", "Path to Solana keypair file")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius stake unstake <stake-account> -k ~/.helius/keypair.json --json`)
  .action(function(this: any, stakeAccount: string) { stakeUnstakeCommand(stakeAccount, opts(this)); });

stakeCmd
  .command("withdraw <stake-account>")
  .description("Create a withdraw transaction")
  .option("-k, --keypair <path>", "Path to Solana keypair file")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius stake withdraw <stake-account> -k ~/.helius/keypair.json --json`)
  .action(function(this: any, stakeAccount: string) { stakeWithdrawCommand(stakeAccount, opts(this)); });

stakeCmd
  .command("accounts <wallet>")
  .description("Get Helius stake accounts for a wallet")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius stake accounts 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any, wallet: string) { stakeAccountsCommand(wallet, opts(this)); });

stakeCmd
  .command("withdrawable <stake-account>")
  .description("Get withdrawable amount for a stake account")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius stake withdrawable <stake-account> --json`)
  .action(function(this: any, stakeAccount: string) { stakeWithdrawableCommand(stakeAccount, opts(this)); });

stakeCmd
  .command("instructions [amount]")
  .description("Get stake instructions. Accepts positional SOL, --amount <sol>, or --raw-amount <lamports>.")
  .option("--amount <sol>", "Amount in SOL (e.g. 1.5) — alternative to positional")
  .option("--raw-amount <lamports>", "Amount in lamports (e.g. 1500000000) — exact, avoids float rounding")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius stake instructions 5
  $ helius stake instructions --amount 5
  $ helius stake instructions --raw-amount 5000000000 --json`)
  .action(function(this: any, amount: string | undefined) { stakeInstructionsCommand(amount, opts(this)); });

stakeCmd
  .command("unstake-instruction <stake-account>")
  .description("Get unstake instruction")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius stake unstake-instruction <stake-account> --json`)
  .action(function(this: any, stakeAccount: string) { stakeUnstakeInstructionCommand(stakeAccount, opts(this)); });

stakeCmd
  .command("withdraw-instruction <stake-account>")
  .description("Get withdraw instruction")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius stake withdraw-instruction <stake-account> --json`)
  .action(function(this: any, stakeAccount: string) { stakeWithdrawInstructionCommand(stakeAccount, opts(this)); });

// ── ZK Compression ──

const zkCmd = program
  .command("zk")
  .description("ZK Compression commands");

zkCmd
  .command("account <address-or-hash>")
  .description("Get compressed account")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk account 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any, addr: string) { zkAccountCommand(addr, opts(this)); });

zkCmd
  .command("accounts-by-owner <owner>")
  .description("Get compressed accounts by owner")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk accounts-by-owner 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any, owner: string) { zkAccountsByOwnerCommand(owner, opts(this)); });

zkCmd
  .command("balance <address-or-hash>")
  .description("Get compressed balance")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk balance 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any, addr: string) { zkBalanceCommand(addr, opts(this)); });

zkCmd
  .command("balance-by-owner <owner>")
  .description("Get compressed balance by owner")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk balance-by-owner 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any, owner: string) { zkBalanceByOwnerCommand(owner, opts(this)); });

zkCmd
  .command("token-holders <mint>")
  .description("Get compressed token holders")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk token-holders EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --json`)
  .action(function(this: any, mint: string) { zkTokenHoldersCommand(mint, opts(this)); });

zkCmd
  .command("token-balance <account>")
  .description("Get compressed token account balance")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk token-balance 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any, account: string) { zkTokenBalanceCommand(account, opts(this)); });

zkCmd
  .command("token-accounts-by-owner <owner>")
  .description("Get compressed token accounts by owner")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk token-accounts-by-owner 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any, owner: string) { zkTokenAccountsByOwnerCommand(owner, opts(this)); });

zkCmd
  .command("token-accounts-by-delegate <delegate>")
  .description("Get compressed token accounts by delegate")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk token-accounts-by-delegate 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any, delegate: string) { zkTokenAccountsByDelegateCommand(delegate, opts(this)); });

zkCmd
  .command("token-balances-by-owner <owner>")
  .description("Get compressed token balances by owner (V2)")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk token-balances-by-owner 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any, owner: string) { zkTokenBalancesByOwnerCommand(owner, opts(this)); });

zkCmd
  .command("proof <address-or-hash>")
  .description("Get compressed account proof")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk proof 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any, addr: string) { zkProofCommand(addr, opts(this)); });

zkCmd
  .command("proofs <addresses...>")
  .description("Get multiple compressed account proofs")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk proofs 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --json`)
  .action(function(this: any, addrs: string[]) { zkProofsCommand(addrs, opts(this)); });

zkCmd
  .command("multiple-accounts <addresses...>")
  .description("Get multiple compressed accounts")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk multiple-accounts 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --json`)
  .action(function(this: any, addrs: string[]) { zkMultipleAccountsCommand(addrs, opts(this)); });

zkCmd
  .command("address-proofs <addresses...>")
  .description("Get multiple new address proofs (V2)")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk address-proofs 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --json`)
  .action(function(this: any, addrs: string[]) { zkAddressProofsCommand(addrs, opts(this)); });

zkCmd
  .command("signatures-account <account>")
  .description("Get compression signatures for account")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk signatures-account 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any, account: string) { zkSignaturesAccountCommand(account, opts(this)); });

zkCmd
  .command("signatures-address <address>")
  .description("Get compression signatures for address")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk signatures-address 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any, addr: string) { zkSignaturesAddressCommand(addr, opts(this)); });

zkCmd
  .command("signatures-owner <owner>")
  .description("Get compression signatures for owner")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk signatures-owner 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any, owner: string) { zkSignaturesOwnerCommand(owner, opts(this)); });

zkCmd
  .command("signatures-token-owner <owner>")
  .description("Get compression signatures for token owner")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk signatures-token-owner 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any, owner: string) { zkSignaturesTokenOwnerCommand(owner, opts(this)); });

zkCmd
  .command("latest-signatures")
  .description("Get latest compression signatures")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk latest-signatures --json`)
  .action(function(this: any) { zkLatestSignaturesCommand(opts(this)); });

zkCmd
  .command("latest-non-voting")
  .description("Get latest non-voting signatures")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk latest-non-voting --json`)
  .action(function(this: any) { zkLatestNonVotingCommand(opts(this)); });

zkCmd
  .command("tx <signature>")
  .description("Get transaction with compression info")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk tx 5UfDuX7hXbDjdMRbQMCbNvPZQEr4mEAMq3fNM7oKnUFqpEygPoAEsm2MFVwfCaG1CjprB2og8LmNVBLMrACG7L4 --json`)
  .action(function(this: any, sig: string) { zkTxCommand(sig, opts(this)); });

zkCmd
  .command("validity-proof")
  .description("Get validity proof")
  .option("--hashes <hashes>", "Comma-separated hashes")
  .option("--addresses <addrs>", "Comma-separated addresses")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk validity-proof --addresses 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any) { zkValidityProofCommand(opts(this)); });

zkCmd
  .command("indexer-health")
  .description("Check ZK indexer health")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk indexer-health --json`)
  .action(function(this: any) { zkIndexerHealthCommand(opts(this)); });

zkCmd
  .command("indexer-slot")
  .description("Get ZK indexer slot")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk indexer-slot --json`)
  .action(function(this: any) { zkIndexerSlotCommand(opts(this)); });

zkCmd
  .command("signatures-for-asset <id>")
  .description("Get compression signatures for asset")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius zk signatures-for-asset EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --json`)
  .action(function(this: any, id: string) { zkSignaturesForAssetCommand(id, opts(this)); });

// ── Transaction helpers ──

const sendCmd = program
  .command("send")
  .description("Transaction send/broadcast commands");

sendCmd
  .command("broadcast <base64-tx>")
  .description("Broadcast a signed transaction and poll for confirmation")
  .option("--dry-run", "Preview without submitting the transaction")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius send broadcast <base64-tx> --json`)
  .action(function(this: any, tx: string) { sendBroadcastCommand(tx, opts(this)); });

sendCmd
  .command("raw <base64-tx>")
  .description("Send a raw transaction")
  .option("--dry-run", "Preview without submitting the transaction")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius send raw <base64-tx> --json`)
  .action(function(this: any, tx: string) { sendRawCommand(tx, opts(this)); });

sendCmd
  .command("sender <base64-tx>")
  .description("Send via Helius Sender for ultra-low latency")
  .option("--region <region>", "Sender region (Default, US_SLC, US_EAST, etc.)")
  .option("--dry-run", "Preview without submitting the transaction")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius send sender <base64-tx> --region US_EAST --json`)
  .action(function(this: any, tx: string) { sendSenderCommand(tx, opts(this)); });

sendCmd
  .command("poll <signature>")
  .description("Poll transaction status until confirmed")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius send poll 5UfDuX7hXbDjdMRbQMCbNvPZQEr4mEAMq3fNM7oKnUFqpEygPoAEsm2MFVwfCaG1CjprB2og8LmNVBLMrACG7L4 --json`)
  .action(function(this: any, sig: string) { sendPollCommand(sig, opts(this)); });

sendCmd
  .command("compute-units <base64-tx>")
  .description("Simulate and return compute unit estimate")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius send compute-units <base64-tx> --json`)
  .action(function(this: any, tx: string) { sendComputeUnitsCommand(tx, opts(this)); });

// ── Reclaim rent from empty token accounts ──

program
  .command("reclaim [owner]")
  .description("Close empty SPL token accounts and reclaim rent via Helius Sender")
  .option("-k, --keypair <path>", "Path to Solana keypair file", getDefaultKeypairPath())
  .option("--destination <addr>", "Address to receive reclaimed lamports (default: signer)")
  .option("--region <region>", "Sender region (Default, US_SLC, US_EAST, etc.)", "Default")
  .option("--swqos-only", "Route only through SWQoS (cheaper tip)")
  .option("--tip-amount <lamports>", "Override auto-tip for Sender")
  .option("--batch-size <n>", "Number of accounts closed per transaction", "20")
  .option("--limit <n>", "Cap total accounts closed across all batches")
  .option("--dry-run", "List closable accounts without sending")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius reclaim --dry-run
  $ helius reclaim --dry-run 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY
  $ helius reclaim -y
  $ helius reclaim --limit 50 --batch-size 15 --region US_EAST --swqos-only --yes --json

Token-2022 accounts are not scanned in v1. Only empty, initialized (non-frozen)
SPL Token accounts where closeAuthority is unset or matches the keypair will be
closed. Each batch is sent independently via Helius Sender; a failed batch does
not abort later batches.`)
  .action(function(this: any, owner?: string) { reclaimCommand(owner, opts(this)); });

// ── WebSocket subscriptions ──

const wsCmd = program
  .command("ws")
  .description("WebSocket streaming commands (Ctrl+C to stop)");

wsCmd
  .command("account <address>")
  .description("Stream account change notifications")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius ws account 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY
  $ helius ws account 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any, address: string) { wsAccountCommand(address, opts(this)); });

wsCmd
  .command("logs")
  .description("Stream log notifications")
  .option("--mentions <addr>", "Filter by mentioned address")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius ws logs
  $ helius ws logs --mentions 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY --json`)
  .action(function(this: any) { wsLogsCommand(opts(this)); });

wsCmd
  .command("slot")
  .description("Stream slot notifications")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius ws slot --json`)
  .action(function(this: any) { wsSlotCommand(opts(this)); });

wsCmd
  .command("signature <sig>")
  .description("Stream signature confirmation")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius ws signature 5UfDuX7hXbDjdMRbQMCbNvPZQEr4mEAMq3fNM7oKnUFqpEygPoAEsm2MFVwfCaG1CjprB2og8LmNVBLMrACG7L4 --json`)
  .action(function(this: any, sig: string) { wsSignatureCommand(sig, opts(this)); });

wsCmd
  .command("program <program-id>")
  .description("Stream program account change notifications")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius ws program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA --json`)
  .action(function(this: any, programId: string) { wsProgramCommand(programId, opts(this)); });

// ── SIMD (Solana Improvement Documents) ──

const simdCmd = program
  .command("simd")
  .description("Browse Solana Improvement Documents (SIMDs)");

simdCmd
  .command("list")
  .description("List all SIMD proposals")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius simd list
  $ helius simd list --json`)
  .action(function(this: any) { simdListCommand(opts(this)); });

simdCmd
  .command("get <number>")
  .description("Read a specific SIMD proposal by number")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius simd get 72
  $ helius simd get 72 --json`)
  .action(function(this: any, number: string) { simdGetCommand(number, opts(this)); });

// ── Update ──

program
  .command("update")
  .description("Check for and install CLI updates")
  .option("--check", "Check for updates without installing")
  .option("--json", "Output in JSON format")
  .addHelpText('after', `
Examples:
  $ helius update --check
  $ helius update`)
  .action(function(this: any) { updateCommand(opts(this)); });

// ── Completions ──

program
  .command("completions <shell>")
  .description("Output shell completion script (bash, zsh, or fish)")
  .option("--install", "Install completions to your shell config")
  .addHelpText('after', `
Examples:
  $ helius completions bash >> ~/.bashrc
  $ helius completions zsh --install
  $ helius completions fish > ~/.config/fish/completions/helius.fish`)
  .action(function(this: any, shell: string) { completionsCommand(shell, program, opts(this)); });

// ── Feedback ──

program
  .command("feedback <text>")
  .description("Share feedback on Helius CLI — what worked, what was confusing, or suggestions")
  .option("--feedback-tool <name>", "Which command the feedback is about (e.g. balance, tx-parse)")
  .option("--model <name>", "Your LLM model (e.g. claude-sonnet-4-20250514, gpt-4o)")
  .addHelpText('after', `
Examples:
  $ helius feedback "The balance command is great but I wish it showed USD values" --feedback-tool balance --model claude-sonnet-4-20250514`)
  .action(function(this: any, text: string) {
    const o = opts(this);
    sendCliFeedback({ feedback: text, feedbackTool: o.feedbackTool, model: o.model });
    console.log(chalk.green("Thanks for the feedback!"));
  });

// Wrap Commander parsing so argument/flag errors (unknown option, missing arg,
// etc.) emit the v2 envelope under --json instead of Commander's raw stderr text.
// --help and --version still exit normally with exit code 0.
program.exitOverride();

try {
  program.parse();
} catch (err: any) {
  const code: string | undefined = err?.code;
  const exitCode: number = typeof err?.exitCode === "number" ? err.exitCode : 1;

  // Help/version are successful exits; let them pass through silently.
  if (code === "commander.helpDisplayed" || code === "commander.version" || code === "commander.help") {
    process.exit(exitCode);
  }

  if (isJsonMode) {
    exitWithError("INVALID_INPUT", err?.message ?? "Invalid command-line usage", undefined, true);
  } else {
    // Commander already printed its message to stderr; mirror its exit code.
    process.exit(exitCode || 1);
  }
}
