// Output utilities for JSON mode
import chalk from "chalk";
import { sendCommandEvent, getCurrentCommand } from "./feedback.js";

export interface OutputOptions {
  json?: boolean;
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
  return errorToExitCode[errorCode] || ExitCode.GENERAL_ERROR;
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

  // Tier 2 — HTTP status embedded in message (Enhanced TX and webhooks SDK paths)
  // Matches: "Helius HTTP 429: ..." or "HTTP error! status: 429 - ..."
  const heliusMatch = msg.match(/Helius HTTP (\d+):/);
  const webhookMatch = msg.match(/HTTP error! status: (\d+)/);
  const embeddedStatus = heliusMatch ? parseInt(heliusMatch[1], 10)
    : webhookMatch ? parseInt(webhookMatch[1], 10)
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
const CLI_GUIDANCE: Record<string, string> = {
  INVALID_API_KEY: 'Run `helius config set-api-key <key>` with a valid key, or `helius usage` to check your current plan and credits.',
  RATE_LIMITED: 'Run `helius usage` to check remaining credits. Back off and retry, or upgrade your plan for higher limits.',
  NO_API_KEY: 'Run `helius config set-api-key <key>` or set HELIUS_API_KEY env var. Get a key at https://dashboard.helius.dev.',
  NOT_FOUND: 'The requested resource was not found. Verify the address or identifier is correct.',
  SERVER_ERROR: 'Helius backend error. Retry after a few seconds.',
  NETWORK_ERROR: 'Could not connect to Helius. Check your internet connection and retry.',
  INSUFFICIENT_SOL: 'Fund your wallet with ~0.001 SOL for transaction fees, then retry.',
  INSUFFICIENT_USDC: 'Fund your wallet with the required USDC amount, then retry.',
  PAYMENT_FAILED: 'The on-chain payment did not complete. Check your wallet balance and retry.',
  NOT_LOGGED_IN: 'Run `helius login` to authenticate, or `helius signup` to create a new account.',
  KEYPAIR_NOT_FOUND: 'Run `helius keygen` to generate a keypair first.',
  NO_PROJECTS: 'Run `helius signup` to create your first project.',
  MULTIPLE_PROJECTS: 'Specify a project ID. Run `helius projects` to list them.',
  PROJECT_NOT_FOUND: 'Run `helius projects` to list available projects.',
  NO_API_KEYS: 'Run `helius apikeys create` to create an API key.',
  INVALID_INPUT: 'Check command usage with --help.',
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
    outputJson({ error: errorCode, message, retryable, ...(guidance ? { guidance } : {}) });
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
  console.log(JSON.stringify(data, jsonReplacer, 2));
}

export function exitWithError(
  errorCode: string,
  message: string,
  details?: Record<string, unknown>,
  json = true,
): never {
  const exitCode = getExitCode(errorCode);

  if (json) {
    const retryable = RETRYABLE_CODES.has(exitCode);
    outputJson({ error: errorCode, message, retryable, ...details });
  } else {
    console.error(chalk.red(message));
    const guidance = CLI_GUIDANCE[errorCode];
    if (guidance) {
      console.error(chalk.yellow(`\n  Hint: ${guidance}`));
    }
  }

  process.exit(exitCode);
}
