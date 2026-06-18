// Output utilities for JSON mode
import chalk from "chalk";
import ora from "ora";
import readline from "readline";
import { sendCommandEvent, getCurrentCommand } from "./feedback.js";

export interface OutputOptions {
  json?: boolean;
}

/** True when the caller is a non-human agent (NO_DNA convention). */
export const isAgent = !!process.env.NO_DNA;

/** Global debug flag — set by --debug CLI option. */
let _debugEnabled = false;

export function setDebugEnabled(enabled: boolean): void {
  _debugEnabled = enabled;
}

/** Log a debug message to stderr (never pollutes --json stdout). */
export function debug(msg: string): void {
  if (_debugEnabled) {
    console.error(chalk.gray(`[DEBUG] ${msg}`));
  }
}

/** Mask an API key for debug output: show first 4 chars + dots. */
export function maskKey(key: string): string {
  return key.length > 4 ? key.slice(0, 4) + "••••" : "••••";
}

/** Create a spinner, suppressed when --json is set or NO_DNA is detected. */
export function createSpinner(options: OutputOptions = {}): ReturnType<typeof ora> | null {
  return options.json || isAgent ? null : ora();
}

// Exit codes for machine-readable error handling
// 0 = success
// 1 = general error
// 10-19 = authentication errors
// 20-29 = balance/payment errors
// 30-39 = project errors
// 40-49 = API errors
// 50-59 = SDK/data errors
export const ExitCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,

  // Auth errors (10-19)
  NOT_LOGGED_IN: 10,
  KEYPAIR_NOT_FOUND: 11,
  AUTH_FAILED: 12,

  // Balance/payment errors (20-29)
  INSUFFICIENT_SOL: 20,
  INSUFFICIENT_USDC: 21,
  PAYMENT_FAILED: 22,
  INSUFFICIENT_FUNDS: 23,

  // Project errors (30-39)
  NO_PROJECTS: 30,
  PROJECT_NOT_FOUND: 31,
  MULTIPLE_PROJECTS: 32,
  PROJECT_EXISTS: 33,

  // API errors (40-49)
  API_ERROR: 40,
  NO_API_KEYS: 41,

  // SDK/data errors (50-59)
  NO_API_KEY: 50,      // resolveApiKey() failed — permanent, fix config
  SDK_ERROR: 51,       // unclassified SDK error
  INVALID_ADDRESS: 52, // bad base58 / pubkey format — permanent
  INVALID_INPUT: 53,   // bad parameters / 400 — permanent
  INVALID_API_KEY: 54, // 401 / 403 — permanent, fix the key
  NOT_FOUND: 55,       // 404 — permanent for that resource
  RATE_LIMITED: 56,    // 429 — transient, safe to retry
  SERVER_ERROR: 57,    // 5xx — transient, safe to retry
  NETWORK_ERROR: 58,   // connection/timeout — transient, safe to retry
} as const;

export type ExitCodeType = (typeof ExitCode)[keyof typeof ExitCode];

// Exit codes that indicate a transient error safe to retry
const RETRYABLE_CODES = new Set<ExitCodeType>([
  ExitCode.RATE_LIMITED,
  ExitCode.SERVER_ERROR,
  ExitCode.NETWORK_ERROR,
]);

// Map error code strings to exit codes
const errorToExitCode: Record<string, ExitCodeType> = {
  NOT_LOGGED_IN: ExitCode.NOT_LOGGED_IN,
  KEYPAIR_NOT_FOUND: ExitCode.KEYPAIR_NOT_FOUND,
  AUTH_FAILED: ExitCode.AUTH_FAILED,
  INSUFFICIENT_SOL: ExitCode.INSUFFICIENT_SOL,
  INSUFFICIENT_USDC: ExitCode.INSUFFICIENT_USDC,
  PAYMENT_FAILED: ExitCode.PAYMENT_FAILED,
  INSUFFICIENT_FUNDS: ExitCode.INSUFFICIENT_FUNDS,
  NO_PROJECTS: ExitCode.NO_PROJECTS,
  PROJECT_NOT_FOUND: ExitCode.PROJECT_NOT_FOUND,
  MULTIPLE_PROJECTS: ExitCode.MULTIPLE_PROJECTS,
  PROJECT_EXISTS: ExitCode.PROJECT_EXISTS,
  API_ERROR: ExitCode.API_ERROR,
  NO_API_KEYS: ExitCode.NO_API_KEYS,
  NO_API_KEY: ExitCode.NO_API_KEY,
  SDK_ERROR: ExitCode.SDK_ERROR,
  INVALID_ADDRESS: ExitCode.INVALID_ADDRESS,
  INVALID_INPUT: ExitCode.INVALID_INPUT,
  INVALID_API_KEY: ExitCode.INVALID_API_KEY,
  NOT_FOUND: ExitCode.NOT_FOUND,
  RATE_LIMITED: ExitCode.RATE_LIMITED,
  SERVER_ERROR: ExitCode.SERVER_ERROR,
  NETWORK_ERROR: ExitCode.NETWORK_ERROR,
};

export function getExitCode(errorCode: string): ExitCodeType {
  const code = errorToExitCode[errorCode];
  if (code === undefined) {
    debug(`Unknown error code "${errorCode}" — falling back to GENERAL_ERROR. Add to errorToExitCode.`);
    return ExitCode.GENERAL_ERROR;
  }
  return code;
}

// ── Envelope contract (v1) ─────────────────────────────────────────
// All --json output is wrapped in one of these shapes. See README
// "Output Format" section for the public contract.

export const ENVELOPE_VERSION = 1 as const;

export type Category =
  | "success" | "general" | "auth" | "payment" | "project"
  | "api" | "sdk" | "validation" | "not_found"
  | "rate_limit" | "server" | "network";

export type SuccessEnvelope<T = unknown> = {
  ok: true;
  v: typeof ENVELOPE_VERSION;
  data: T;
};

export type ErrorEnvelope = {
  ok: false;
  v: typeof ENVELOPE_VERSION;
  error_code: string;
  category: Category;
  error: string;
  recoverable: boolean;
  suggestion: string;
  details?: Record<string, unknown>;
};

export type Envelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;

const exitCodeToCategory: Record<ExitCodeType, Category> = {
  [ExitCode.SUCCESS]: "success",
  [ExitCode.GENERAL_ERROR]: "general",
  [ExitCode.NOT_LOGGED_IN]: "auth",
  [ExitCode.KEYPAIR_NOT_FOUND]: "auth",
  [ExitCode.AUTH_FAILED]: "auth",
  [ExitCode.INSUFFICIENT_SOL]: "payment",
  [ExitCode.INSUFFICIENT_USDC]: "payment",
  [ExitCode.PAYMENT_FAILED]: "payment",
  [ExitCode.INSUFFICIENT_FUNDS]: "payment",
  [ExitCode.NO_API_KEY]: "auth",  // API-key configuration is an auth concern — grouped with INVALID_API_KEY so `category === "auth"` catches all key problems
  [ExitCode.NO_PROJECTS]: "project",
  [ExitCode.PROJECT_NOT_FOUND]: "project",
  [ExitCode.MULTIPLE_PROJECTS]: "project",
  [ExitCode.PROJECT_EXISTS]: "project",
  [ExitCode.API_ERROR]: "api",
  [ExitCode.NO_API_KEYS]: "api",
  [ExitCode.SDK_ERROR]: "sdk",
  [ExitCode.INVALID_ADDRESS]: "validation",
  [ExitCode.INVALID_INPUT]: "validation",
  [ExitCode.INVALID_API_KEY]: "auth",
  [ExitCode.NOT_FOUND]: "not_found",
  [ExitCode.RATE_LIMITED]: "rate_limit",
  [ExitCode.SERVER_ERROR]: "server",
  [ExitCode.NETWORK_ERROR]: "network",
};

export function getCategory(exitCode: ExitCodeType): Category {
  return exitCodeToCategory[exitCode] ?? "general";
}

function writeEnvelope(obj: Envelope): void {
  console.log(JSON.stringify(obj, jsonReplacer, 2));
}

function buildErrorEnvelope(
  errorCode: string,
  exitCode: ExitCodeType,
  message: string,
  retryable: boolean,
  details?: Record<string, unknown>,
  stack?: string,
): ErrorEnvelope {
  const guidance = CLI_GUIDANCE[errorCode]
    ?? 'An error occurred. Re-run with --debug for more details.';
  const mergedDetails = details || stack
    ? { ...(details ?? {}), ...(stack ? { stack } : {}) }
    : undefined;
  return {
    ok: false,
    v: ENVELOPE_VERSION,
    error_code: errorCode,
    category: getCategory(exitCode),
    error: message,
    recoverable: retryable,  // internal 'retryable' → public 'recoverable'
    suggestion: guidance,
    ...(mergedDetails ? { details: mergedDetails } : {}),
  };
}

// Classification result returned by classifyError()
export interface ErrorClassification {
  exitCode: ExitCodeType;
  errorCode: string;
  retryable: boolean;
}

// Import here to avoid circular dependency — helius.ts imports from output.ts
// so we use a type-only import path trick: classifyError checks instanceof at runtime
// by importing HeliusHttpError lazily via the class reference passed in.
// Instead, we export a registration function so helius.ts can register its error class
let _HeliusHttpError: (new (...args: any[]) => { status: number }) | null = null;

export function registerHttpErrorClass(cls: new (...args: any[]) => { status: number }): void {
  _HeliusHttpError = cls;
}

/**
 * Classifies an unknown error into a structured result with exit code and retryability
 *
 * Three classification tiers:
 *   1. HeliusHttpError (restRequest() path) — exact HTTP status property
 *   2. Status embedded in message (enhanced TX: "Helius HTTP 429:", webhooks: "HTTP error! status: 429")
 *   3. Keyword matching (RPC caller path: "RPC error (method): <server message>")
 */
export function classifyError(error: unknown): ErrorClassification {
  const msg = error instanceof Error ? error.message : String(error);

  // Tier 1 — HeliusHttpError from restRequest(): exact status code available
  if (_HeliusHttpError && error instanceof _HeliusHttpError) {
    return classifyByStatus(error.status);
  }

  // Tier 2 — HTTP status embedded in message (Enhanced TX, webhooks, and auth SDK paths)
  // Matches: "Helius HTTP 429: ...", "HTTP error! status: 429 - ...", or
  // "API error (429): ..." (helius-sdk/auth authRequest — signup, projects, oauth)
  const heliusMatch = msg.match(/Helius HTTP (\d+):/);
  const webhookMatch = msg.match(/HTTP error! status: (\d+)/);
  const authApiMatch = msg.match(/API error \((\d+)\)/);
  const embeddedStatus = heliusMatch ? parseInt(heliusMatch[1], 10)
    : webhookMatch ? parseInt(webhookMatch[1], 10)
    : authApiMatch ? parseInt(authApiMatch[1], 10)
    : null;
  if (embeddedStatus !== null) {
    return classifyByStatus(embeddedStatus);
  }

  // Tier 3 — Keyword matching (RPC caller path, resolveApiKey, payment, network errors)

  // Payment / balance errors (signup, upgrade, pay)
  if (/insufficient sol/i.test(msg)) {
    return { exitCode: ExitCode.INSUFFICIENT_SOL, errorCode: "INSUFFICIENT_SOL", retryable: false };
  }
  if (/insufficient usdc/i.test(msg)) {
    return { exitCode: ExitCode.INSUFFICIENT_USDC, errorCode: "INSUFFICIENT_USDC", retryable: false };
  }
  if (/checkout (failed|expired|timeout)/i.test(msg)) {
    return { exitCode: ExitCode.PAYMENT_FAILED, errorCode: "PAYMENT_FAILED", retryable: false };
  }

  // resolveApiKey() failure
  if (msg.includes("No API key found")) {
    return { exitCode: ExitCode.NO_API_KEY, errorCode: "NO_API_KEY", retryable: false };
  }

  // Auth — Helius server returns these strings inside "RPC error (method): ..."
  if (/invalid.?api.?key|unauthorized|restricted access/i.test(msg)) {
    return { exitCode: ExitCode.INVALID_API_KEY, errorCode: "INVALID_API_KEY", retryable: false };
  }

  // Rate limiting
  if (/rate.?limit|too many requests|insufficient credits/i.test(msg)) {
    return { exitCode: ExitCode.RATE_LIMITED, errorCode: "RATE_LIMITED", retryable: true };
  }

  // Not found
  if (/not found/i.test(msg)) {
    return { exitCode: ExitCode.NOT_FOUND, errorCode: "NOT_FOUND", retryable: false };
  }

  // Invalid address / pubkey — @solana/kit throws on bad base58
  if (/invalid.*(address|pubkey|base58|public.?key)/i.test(msg)) {
    return { exitCode: ExitCode.INVALID_ADDRESS, errorCode: "INVALID_ADDRESS", retryable: false };
  }

  // Bad input: SyntaxError (e.g. BigInt("abc") in block.ts) or bad params
  if (error instanceof SyntaxError || /invalid.*param|bad request/i.test(msg)) {
    return { exitCode: ExitCode.INVALID_INPUT, errorCode: "INVALID_INPUT", retryable: false };
  }

  // Network / connection errors — Node.js / undici error codes
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|fetch failed/i.test(msg)) {
    return { exitCode: ExitCode.NETWORK_ERROR, errorCode: "NETWORK_ERROR", retryable: true };
  }

  // Server errors surfaced in RPC message body
  if (/internal server|server error/i.test(msg)) {
    return { exitCode: ExitCode.SERVER_ERROR, errorCode: "SERVER_ERROR", retryable: true };
  }

  return { exitCode: ExitCode.SDK_ERROR, errorCode: "SDK_ERROR", retryable: false };
}

/**
 * Shared error handler for command catch blocks.
 *
 * Classifies the error, emits JSON or spinner output, and exits.
 * All commands except ws.ts should use this in their catch block:
 *
 *   } catch (error) {
 *     handleCommandError(error, options, spinner);
 *   }
 *
 * Commands with domain-specific knowledge can pass `fallbackCode` so that
 * unclassified errors (SDK_ERROR) get a more meaningful code.  Specific
 * classifications (RATE_LIMITED, NETWORK_ERROR, etc.) are never overridden.
 *
 *   handleCommandError(error, options, spinner, "AUTH_FAILED");
 */
export const CLI_GUIDANCE: Record<string, string> = {
  INVALID_API_KEY: 'Run `helius config set-api-key <key>` with a valid key, or `helius usage` to check your current plan and credits.',
  RATE_LIMITED: 'Run `helius usage` to check remaining credits. Back off and retry, or upgrade your plan for higher limits.',
  NO_API_KEY: 'Run `helius config set-api-key <key>` or set HELIUS_API_KEY env var. Get a key at https://dashboard.helius.dev.',
  NOT_FOUND: 'The requested resource was not found. Verify the address or identifier is correct.',
  SERVER_ERROR: 'Helius backend error. Retry after a few seconds.',
  NETWORK_ERROR: 'Could not connect to Helius. Check your internet connection and retry.',
  INSUFFICIENT_SOL: 'Fund your wallet with ~0.001 SOL for transaction fees, then retry.',
  INSUFFICIENT_USDC: 'Fund your wallet with the required USDC amount, then retry.',
  INSUFFICIENT_FUNDS: 'Fund your wallet with the amounts listed in `details.missing`, then retry.',
  PAYMENT_FAILED: 'The on-chain payment did not complete. Check your wallet balance and retry.',
  NOT_LOGGED_IN: 'Run `helius login` to authenticate, or `helius signup` to create a new account.',
  KEYPAIR_NOT_FOUND: 'Run `helius keygen` to generate a keypair first.',
  NO_PROJECTS: 'Create a project in the dashboard at https://dashboard.helius.dev, or run `helius signup` if you do not have an account yet.',
  MULTIPLE_PROJECTS: 'Specify a project ID. Run `helius projects` to list them.',
  PROJECT_NOT_FOUND: 'Run `helius projects` to list available projects.',
  NO_API_KEYS: 'Run `helius apikeys create` to create an API key.',
  INVALID_INPUT: 'Check command usage with --help.',
  AUTH_FAILED: 'Your credentials are invalid or expired. Run `helius login` to re-authenticate.',
  PROJECT_EXISTS: 'A project with this name already exists. Run `helius projects` to list them or pick a different name.',
  API_ERROR: 'The Helius management API returned an error. Retry, or inspect `details` for more information.',
  SDK_ERROR: 'Unclassified SDK error. Re-run with --debug for a stack trace.',
  INVALID_ADDRESS: 'The provided address is not a valid base58 Solana pubkey. Verify the address format.',
};

export function handleCommandError(
  error: unknown,
  options: { json?: boolean },
  spinner?: { fail(text: string): void } | null,
  fallbackCode?: string,
): never {
  let { exitCode, errorCode, retryable } = classifyError(error);

  // If the generic classifier couldn't do better than SDK_ERROR and the
  // caller provided a domain-specific fallback, use it instead.
  if (fallbackCode && errorCode === "SDK_ERROR") {
    errorCode = fallbackCode;
    exitCode = getExitCode(fallbackCode);
    retryable = RETRYABLE_CODES.has(exitCode);
  }

  const message = error instanceof Error ? error.message : String(error);
  const guidance = CLI_GUIDANCE[errorCode];

  const cmdName = getCurrentCommand() || 'unknown';
  sendCommandEvent(cmdName, { exitCode, success: false });

  if (options.json) {
    const stack = _debugEnabled && error instanceof Error ? error.stack : undefined;
    writeEnvelope(buildErrorEnvelope(errorCode, exitCode, message, retryable, undefined, stack));
  } else {
    const hint = retryable ? chalk.gray(" (transient — safe to retry)") : "";
    spinner?.fail(`${message}${hint}`);
    if (guidance) {
      console.error(chalk.yellow(`\n  Hint: ${guidance}`));
    }
  }
  process.exit(exitCode);
}

function classifyByStatus(status: number): ErrorClassification {
  if (status === 401 || status === 403) {
    return { exitCode: ExitCode.INVALID_API_KEY, errorCode: "INVALID_API_KEY", retryable: false };
  }
  if (status === 404) {
    return { exitCode: ExitCode.NOT_FOUND, errorCode: "NOT_FOUND", retryable: false };
  }
  if (status === 400) {
    return { exitCode: ExitCode.INVALID_INPUT, errorCode: "INVALID_INPUT", retryable: false };
  }
  if (status === 429) {
    return { exitCode: ExitCode.RATE_LIMITED, errorCode: "RATE_LIMITED", retryable: true };
  }
  if (status >= 500) {
    return { exitCode: ExitCode.SERVER_ERROR, errorCode: "SERVER_ERROR", retryable: true };
  }
  return { exitCode: ExitCode.SDK_ERROR, errorCode: "SDK_ERROR", retryable: false };
}

export function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? Number(value) : value;
}

export function outputJson(data: unknown): void {
  writeEnvelope({ ok: true, v: ENVELOPE_VERSION, data });
}

/**
 * Print the post-command "share feedback" nudge. This mirrors the program's
 * postAction hook (see bin/helius.ts). It lives here so command paths that call
 * process.exit() before Commander runs postAction — like reclaim's non-zero
 * terminal exit — can emit the same prompt instead of silently dropping it.
 */
export function printFeedbackPrompt(commandName: string): void {
  console.log(
    "\n" +
      chalk.yellow(
        `Please run: helius feedback "<your feedback on ${commandName}>" --feedback-tool ${commandName} --model <your-model>`,
      ),
  );
}

export function exitWithError(
  errorCode: string,
  message: string,
  details?: Record<string, unknown>,
  json = true,
  opts?: { recoverable?: boolean },
): never {
  const exitCode = getExitCode(errorCode);
  // recoverable defaults to the exit code's classification, but callers can
  // override it when they know better. reclaim does this: a failed broadcast
  // batch is transient (rate-limited / Sender down) and the command tells the
  // user to re-run, so the envelope must report recoverable:true even though
  // PAYMENT_FAILED is non-retryable for genuine payment failures.
  const retryable = opts?.recoverable ?? RETRYABLE_CODES.has(exitCode);

  const cmdName = getCurrentCommand() || 'unknown';
  sendCommandEvent(cmdName, { exitCode, success: false });

  if (json) {
    writeEnvelope(buildErrorEnvelope(errorCode, exitCode, message, retryable, details));
  } else {
    console.error(chalk.red(message));
    const guidance = CLI_GUIDANCE[errorCode];
    if (guidance) {
      console.error(chalk.yellow(`\n  Hint: ${guidance}`));
    }
  }

  process.exit(exitCode);
}

export interface RetryOptions {
  retry?: string | number;
}

/**
 * Wrap an async function with exponential backoff retry on transient errors.
 * Only retries errors classified as retryable (429, 5xx, network).
 * Non-retryable errors are re-thrown immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  spinner?: { start(text: string): void } | null,
): Promise<T> {
  const maxRetries = Math.max(0, parseInt(String(options.retry ?? 0), 10) || 0);
  let attempt = 0;

  while (true) {
    const start = Date.now();
    try {
      const result = await fn();
      debug(`SDK call → OK (${Date.now() - start}ms)`);
      return result;
    } catch (error) {
      const elapsed = Date.now() - start;
      const { retryable, errorCode } = classifyError(error);
      debug(`SDK call → ${errorCode} (${elapsed}ms)${retryable ? " [retryable]" : ""}`);
      if (!retryable || attempt >= maxRetries) {
        throw error;
      }

      attempt++;
      const delay = Math.min(1000 * 2 ** (attempt - 1), 30_000);
      const message = error instanceof Error ? error.message : String(error);
      debug(`Retry ${attempt}/${maxRetries} in ${delay / 1000}s...`);
      spinner?.start(`${message} — retrying in ${delay / 1000}s (${attempt}/${maxRetries})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/** Prompt the user for yes/no confirmation. Returns true if they answer y/yes. */
export function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}
