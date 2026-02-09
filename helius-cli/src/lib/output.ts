// Output utilities for JSON mode

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
} as const;

export type ExitCodeType = (typeof ExitCode)[keyof typeof ExitCode];

// Map error codes to exit codes
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
};

export function getExitCode(errorCode: string): ExitCodeType {
  return errorToExitCode[errorCode] || ExitCode.GENERAL_ERROR;
}

export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function exitWithError(
  errorCode: string,
  message: string,
  details?: Record<string, unknown>,
  json?: boolean
): never {
  const exitCode = getExitCode(errorCode);

  if (json) {
    outputJson({ error: errorCode, message, ...details });
  }

  process.exit(exitCode);
}
