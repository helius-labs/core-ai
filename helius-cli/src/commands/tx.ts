import chalk from "chalk";
import type { GetEnhancedTransactionsByAddressRequest } from "helius-sdk/enhanced/types";
import type {
  ComparisonBounds,
  GetParsedTransactionHistoryRequest,
  GetParsedTransactionHistoryResponse,
  ParsedTransaction,
  ParsedTransactionResult,
  ParseTransactionsResponse,
  ScanMatch,
  ScanMatchScope,
  ScanParsedTransactionHistoryRequest,
  ScanParsedTransactionHistoryResponse,
  ScanReturnShape,
  ScanSignature,
} from "helius-sdk/parsedEvents/types";
import { resolveNetwork, setupClient, type ResolveOptions } from "../lib/helius.js";
import { formatSol, formatTimestamp, formatAddress, formatEnumLabel } from "../lib/formatters.js";
import { outputJson, exitWithError, handleCommandError, createSpinner, withRetry, type OutputOptions, type RetryOptions } from "../lib/output.js";
import { validateAddress, validateAddresses, validateScanMatch, validateSignature } from "../lib/validation.js";
import type { GetTransfersByAddressConfig, GetTransfersByAddressResult } from "helius-sdk/types/types";

interface TxOptions extends OutputOptions, ResolveOptions, RetryOptions {}

// ─── Parsed Events (mainnet) with an Enhanced Transactions fallback (devnet) ───

/** Parsed Events parses at most this many signatures per request. */
const PARSED_EVENTS_BATCH_SIZE = 100;

/** Exit with INVALID_INPUT unless `value` is one of `allowed`. */
function checkOneOf(flag: string, value: string | undefined, allowed: string[], json: boolean): void {
  if (value !== undefined && !allowed.includes(value)) {
    exitWithError("INVALID_INPUT", `${flag} must be ${allowed.map((a) => `"${a}"`).join(", ")} (got "${value}")`, undefined, json);
  }
}

/** Parse an integer flag, optionally within [min, max], or exit with INVALID_INPUT. */
function parseIntFlag(flag: string, raw: string | undefined, json: boolean, min?: number, max?: number): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || (min !== undefined && n < min) || (max !== undefined && n > max)) {
    const range = min !== undefined && max !== undefined ? ` from ${min} to ${max}` : "";
    exitWithError("INVALID_INPUT", `${flag} must be an integer${range} (got "${raw}")`, undefined, json);
  }
  return n;
}

/** A `{ gte, lte }` bound from a pair of `--*-gte` / `--*-lte` flags, or undefined when neither is set. */
function parseBounds(gteFlag: string, gte: string | undefined, lteFlag: string, lte: string | undefined, json: boolean): ComparisonBounds | undefined {
  const lower = parseIntFlag(gteFlag, gte, json);
  const upper = parseIntFlag(lteFlag, lte, json);
  if (lower === undefined && upper === undefined) return undefined;
  return { ...(lower !== undefined && { gte: lower }), ...(upper !== undefined && { lte: upper }) };
}

function formatTokenAmount(rawAmount: number, decimals: number): string {
  return (rawAmount / Math.pow(10, decimals)).toLocaleString(undefined, { maximumFractionDigits: Math.min(decimals || 6, 6) });
}

/** A failed transaction's error, preferring the program's decoded error. */
function formatParsedError(tx: ParsedTransaction): string | null {
  if (tx.transactionStatus !== "ERROR") return null;
  const decoded = tx.decodedError;
  if (decoded) {
    return `${decoded.programName} error ${decoded.code} ${decoded.name}${decoded.msg ? `: ${decoded.msg}` : ""} (instruction ${decoded.instructionIndex})`;
  }
  return tx.error ? JSON.stringify(tx.error) : "Transaction failed";
}

function summaryLabel(tx: ParsedTransaction): string {
  return tx.summary?.type ? formatEnumLabel(tx.summary.type) : "Unknown";
}

function printParsedTransaction(signature: string, tx: ParsedTransaction): void {
  const protocol = typeof tx.summary?.parsedData?.protocol === "string" ? tx.summary.parsedData.protocol : null;
  const error = formatParsedError(tx);
  console.log(chalk.bold(`\n${"─".repeat(60)}`));
  console.log(`${chalk.gray("Signature:")}    ${chalk.cyan(signature)}`);
  console.log(`${chalk.gray("Type:")}         ${chalk.yellow(summaryLabel(tx))}`);
  if (protocol) console.log(`${chalk.gray("Protocol:")}     ${formatEnumLabel(protocol)}`);
  console.log(`${chalk.gray("Status:")}       ${error ? chalk.red(`Failed — ${error}`) : chalk.green("Success")}`);
  console.log(`${chalk.gray("Timestamp:")}    ${tx.blockTime ? formatTimestamp(tx.blockTime) : "N/A"}`);
  console.log(`${chalk.gray("Fee:")}          ${formatSol(tx.fee)}`);
  if (tx.summary?.description) {
    console.log(`${chalk.gray("Description:")} ${tx.summary.description}`);
  }
  const topLevel = tx.instructions.filter((ix) => ix.innerInstructionIndex === null);
  if (topLevel.length > 0) {
    console.log(chalk.bold("\n  Instructions:"));
    for (const ix of topLevel) {
      const program = ix.programName ?? formatAddress(ix.programId);
      console.log(`    [${ix.instructionIndex}] ${ix.instructionName ? `${program}.${ix.instructionName}` : `${program} ${chalk.gray("(not decoded)")}`}`);
    }
  }
  if (tx.tokenTransfers.length > 0) {
    console.log(chalk.bold("\n  Token Transfers:"));
    for (const t of tx.tokenTransfers) {
      console.log(`    ${t.fromUserAccount || "?"} → ${t.toUserAccount || "?"}: ${formatTokenAmount(t.rawTokenAmount, t.decimals)} ${t.mint}`);
    }
  }
  if (tx.nativeTransfers.length > 0) {
    console.log(chalk.bold("\n  Native Transfers:"));
    for (const t of tx.nativeTransfers) {
      console.log(`    ${t.fromUserAccount || "?"} → ${t.toUserAccount || "?"}: ${formatSol(t.amount)}`);
    }
  }
}

/** Legacy Enhanced Transactions output, still used on devnet. */
function printEnhancedTransaction(tx: any): void {
  console.log(chalk.bold(`\n${"─".repeat(60)}`));
  console.log(`${chalk.gray("Signature:")}    ${chalk.cyan(tx.signature || "N/A")}`);
  console.log(`${chalk.gray("Type:")}         ${chalk.yellow(tx.type ? formatEnumLabel(tx.type) : "Unknown")}`);
  console.log(`${chalk.gray("Source:")}       ${tx.source ? formatEnumLabel(tx.source) : "N/A"}`);
  console.log(`${chalk.gray("Timestamp:")}    ${tx.timestamp ? formatTimestamp(tx.timestamp) : "N/A"}`);
  console.log(`${chalk.gray("Fee:")}          ${tx.fee != null ? formatSol(tx.fee) : "N/A"}`);
  if (tx.description) {
    console.log(`${chalk.gray("Description:")} ${tx.description}`);
  }
  if (tx.nativeTransfers?.length) {
    console.log(chalk.bold("\n  Native Transfers:"));
    for (const t of tx.nativeTransfers) {
      console.log(`    ${t.fromUserAccount || "?"} → ${t.toUserAccount || "?"}: ${formatSol(t.amount)}`);
    }
  }
  if (tx.tokenTransfers?.length) {
    console.log(chalk.bold("\n  Token Transfers:"));
    for (const t of tx.tokenTransfers) {
      console.log(`    ${t.fromUserAccount || "?"} → ${t.toUserAccount || "?"}: ${t.tokenAmount} ${t.mint || ""}`);
    }
  }
}

/** Per-signature parser errors: missing transactions and ones the parser could not decode. */
function printParserErrors(results: ParsedTransactionResult[]): void {
  for (const result of results) {
    if (result.parserStatus === "OK") continue;
    const reason = result.parserError.code === "transaction_not_found"
      ? "not found on mainnet (may be pending, very old, or nonexistent)"
      : `could not be parsed: ${result.parserError.code} — ${result.parserError.message}`;
    console.log(chalk.yellow(`  ${result.signature} ${reason}`));
  }
}

export async function txParseCommand(signatures: string[], options: TxOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    for (const sig of signatures) {
      const sigErr = validateSignature(sig);
      if (sigErr) exitWithError("INVALID_INPUT", sigErr, undefined, !!options.json);
    }
    const helius = await setupClient(spinner, options, `Parsing ${signatures.length} transaction(s)...`);

    // Parsed Events serves mainnet only, so devnet keeps the legacy Enhanced Transactions API.
    if (resolveNetwork(options) === "devnet") {
      const result = await withRetry(() => helius.enhanced.getTransactions({ transactions: signatures }), options, spinner);
      spinner?.stop();
      if (options.json) {
        outputJson(result);
        return;
      }
      const txs = Array.isArray(result) ? result : result ? [result] : [];
      if (txs.length === 0) {
        console.log(chalk.yellow("\nNo transactions found."));
        return;
      }
      txs.forEach(printEnhancedTransaction);
      console.log();
      return;
    }

    const results: ParsedTransactionResult[] = [];
    for (let i = 0; i < signatures.length; i += PARSED_EVENTS_BATCH_SIZE) {
      const batch = signatures.slice(i, i + PARSED_EVENTS_BATCH_SIZE);
      results.push(...await withRetry<ParseTransactionsResponse>(() => helius.parsedEvents.parseTransactions({ transactions: batch }), options, spinner));
    }
    spinner?.stop();

    if (options.json) {
      outputJson(results);
      return;
    }

    const parsed = results.filter((r) => r.parserStatus === "OK");
    if (parsed.length === 0) console.log(chalk.yellow("\nNo transactions could be parsed."));
    for (const result of parsed) printParsedTransaction(result.signature, result.parsed);
    if (parsed.length < results.length) {
      console.log(chalk.bold("\nWarnings:"));
      printParserErrors(results);
    }
    console.log();
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

interface TxHistoryOptions extends TxOptions {
  limit?: string;
  before?: string;
  after?: string;
  type?: string;
  sortOrder?: string;
  status?: string;
  tokenAccounts?: string;
  commitment?: string;
  blockTimeGte?: string;
  blockTimeLte?: string;
  slotGte?: string;
  slotLte?: string;
  paginationToken?: string;
}

export async function txHistoryCommand(address: string, options: TxHistoryOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const json = !!options.json;
    const addrErr = validateAddress(address);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, json);

    if (options.type !== undefined) {
      exitWithError(
        "INVALID_INPUT",
        "--type was removed in helius-cli 3.0: transaction history now comes from the Parsed Events API, which has no type filter. "
          + "To find transactions that call a program or instruction, or touch a token mint, use `helius tx scan <address> --programs <id> --instructions <names>` "
          + "or `--mints <mint>`. To filter by summary type, use --json and filter on data[].parsed.summary.type.",
        undefined,
        json,
      );
    }
    for (const signature of [options.before, options.after]) {
      const sigErr = signature === undefined ? null : validateSignature(signature);
      if (sigErr) exitWithError("INVALID_INPUT", sigErr, undefined, json);
    }
    checkOneOf("--sort-order", options.sortOrder, ["asc", "desc"], json);
    checkOneOf("--status", options.status, ["succeeded", "failed", "any"], json);
    checkOneOf("--token-accounts", options.tokenAccounts, ["none", "balanceChanged", "all"], json);
    checkOneOf("--commitment", options.commitment, ["finalized", "confirmed"], json);
    const limit = parseIntFlag("--limit", options.limit, json, 1, 100) ?? 10;
    const time = parseBounds("--block-time-gte", options.blockTimeGte, "--block-time-lte", options.blockTimeLte, json);
    const slot = parseBounds("--slot-gte", options.slotGte, "--slot-lte", options.slotLte, json);
    const sortOrder = options.sortOrder as "asc" | "desc" | undefined;
    const commitment = options.commitment as "finalized" | "confirmed" | undefined;

    // Parsed Events serves mainnet only, so devnet keeps the legacy Enhanced Transactions API,
    // which has no status, token-account, or pagination-token options.
    if (resolveNetwork(options) === "devnet") {
      const mainnetOnly = ([["--status", options.status], ["--token-accounts", options.tokenAccounts], ["--pagination-token", options.paginationToken]] as const)
        .filter(([, value]) => value !== undefined)
        .map(([flag]) => flag);
      if (mainnetOnly.length > 0) {
        exitWithError("INVALID_INPUT", `${mainnetOnly.join(", ")} ${mainnetOnly.length > 1 ? "are" : "is"} only available on mainnet (Parsed Events). On devnet, page with --before.`, undefined, json);
      }
      const params: GetEnhancedTransactionsByAddressRequest = { address, limit };
      if (options.before) params.beforeSignature = options.before;
      if (options.after) params.afterSignature = options.after;
      if (sortOrder) params.sortOrder = sortOrder;
      if (commitment) params.commitment = commitment;
      if (time?.gte !== undefined) params.gteTime = time.gte;
      if (time?.lte !== undefined) params.lteTime = time.lte;
      if (slot?.gte !== undefined) params.gteSlot = slot.gte;
      if (slot?.lte !== undefined) params.lteSlot = slot.lte;

      const helius = await setupClient(spinner, options, "Fetching transaction history...");
      const result = await withRetry(() => helius.enhanced.getTransactionsByAddress(params), options, spinner);
      spinner?.stop();
      if (json) {
        outputJson(result);
        return;
      }
      const txs = Array.isArray(result) ? result : [];
      if (txs.length === 0) {
        console.log(chalk.yellow("\nNo transactions found."));
        return;
      }
      console.log(chalk.bold(`\nTransaction history for ${chalk.cyan(address)}:\n`));
      for (const tx of txs) {
        const time = tx.timestamp ? formatTimestamp(tx.timestamp) : "N/A";
        const type = tx.type ? formatEnumLabel(tx.type) : "Unknown";
        console.log(`  ${chalk.cyan(tx.signature || "N/A")}`);
        console.log(`    ${chalk.yellow(type.padEnd(16))}  ${chalk.gray(time)}`);
        if (tx.description) console.log(`    ${chalk.gray(tx.description)}`);
      }
      console.log(chalk.gray(`\n  ${txs.length} transaction(s) shown`));
      return;
    }

    const request: GetParsedTransactionHistoryRequest = { address, limit };
    if (options.before) request.beforeSignature = options.before;
    if (options.after) request.afterSignature = options.after;
    if (sortOrder) request.sortOrder = sortOrder;
    if (commitment) request.commitment = commitment;
    if (options.status) request.status = options.status as "succeeded" | "failed" | "any";
    if (options.tokenAccounts) request.tokenAccounts = options.tokenAccounts as "none" | "balanceChanged" | "all";
    if (time) request.time = time;
    if (slot) request.slot = slot;
    if (options.paginationToken) request.paginationToken = options.paginationToken;

    const helius = await setupClient(spinner, options, "Fetching transaction history...");
    const result = await withRetry<GetParsedTransactionHistoryResponse>(() => helius.parsedEvents.getTransactionHistory(request), options, spinner);
    spinner?.stop();

    if (json) {
      outputJson(result);
      return;
    }

    if (result.data.length === 0) {
      console.log(chalk.yellow("\nNo transactions found."));
    } else {
      console.log(chalk.bold(`\nTransaction history for ${chalk.cyan(address)}:\n`));
      for (const item of result.data) {
        if (item.parserStatus !== "OK") continue;
        const tx = item.parsed;
        const time = tx.blockTime ? formatTimestamp(tx.blockTime) : "N/A";
        const status = tx.transactionStatus === "OK" ? "" : chalk.red(" failed");
        console.log(`  ${chalk.cyan(item.signature)}`);
        console.log(`    ${chalk.yellow(summaryLabel(tx).padEnd(16))}  ${chalk.gray(time)}${status}`);
        if (tx.summary?.description) console.log(`    ${chalk.gray(tx.summary.description)}`);
      }
      printParserErrors(result.data);
      console.log(chalk.gray(`\n  ${result.data.length} transaction(s) shown`));
    }
    if (!options.status || options.status === "succeeded") {
      console.log(chalk.gray("  Successful transactions only; pass --status any to include failed ones."));
    }
    if (result.paginationToken) {
      console.log(chalk.gray(`  Next: --pagination-token ${result.paginationToken}`));
    }
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

interface TxTransfersOptions extends TxOptions {
  limit?: string;
  sortOrder?: string;
  mint?: string;
  direction?: string;
  with?: string;
  paginationToken?: string;
  blockTimeGte?: string;
  blockTimeLte?: string;
  commitment?: string;
  solMode?: string;
  amountGte?: string;
  amountLte?: string;
  slotGte?: string;
  slotLte?: string;
}

export async function txTransfersCommand(address: string, options: TxTransfersOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const addrErr = validateAddress(address);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, !!options.json);

    if (options.commitment && !["finalized", "confirmed"].includes(options.commitment)) {
      exitWithError("INVALID_INPUT", `--commitment must be "finalized" or "confirmed" (got "${options.commitment}")`, undefined, !!options.json);
    }
    if (options.solMode && !["merged", "separate"].includes(options.solMode)) {
      exitWithError("INVALID_INPUT", `--sol-mode must be "merged" or "separate" (got "${options.solMode}")`, undefined, !!options.json);
    }
    if (options.direction && !["in", "out", "any"].includes(options.direction)) {
      exitWithError("INVALID_INPUT", `--direction must be "in", "out", or "any" (got "${options.direction}")`, undefined, !!options.json);
    }
    if (options.sortOrder && !["asc", "desc"].includes(options.sortOrder)) {
      exitWithError("INVALID_INPUT", `--sort-order must be "asc" or "desc" (got "${options.sortOrder}")`, undefined, !!options.json);
    }

    const helius = await setupClient(spinner, options, "Fetching transfers...");

    const limit = options.limit ? Math.min(Math.max(parseInt(options.limit, 10), 1), 100) : 25;
    const sortOrder = options.sortOrder || "desc";
    const direction = options.direction || "any";

    // The enums were validated above
    const config: GetTransfersByAddressConfig = {
      direction: direction as GetTransfersByAddressConfig["direction"],
      limit,
      sortOrder: sortOrder as GetTransfersByAddressConfig["sortOrder"],
    };
    if (options.mint) config.mint = options.mint;
    if (options.with) config.with = options.with;
    if (options.paginationToken) config.paginationToken = options.paginationToken;
    if (options.commitment) config.commitment = options.commitment as GetTransfersByAddressConfig["commitment"];
    if (options.solMode) config.solMode = options.solMode as GetTransfersByAddressConfig["solMode"];

    // SDK's TransferComparisonFilter types amount as `number`, so raw u64 values outside JS safe-integer
    // range (>2^53) can't be passed without precision loss. Mirror the MCP handler: surface a clear error
    // rather than silently dropping the filter.
    const parseAmountBound = (raw: string | undefined, label: string): number | undefined => {
      if (raw === undefined) return undefined;
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        exitWithError("INVALID_INPUT", `${label} must be a numeric raw u64 amount (got "${raw}")`, undefined, !!options.json);
      }
      if (!Number.isSafeInteger(n) || n < 0) {
        exitWithError("INVALID_INPUT", `${label}="${raw}" is outside JS safe integer range (>2^53) or negative. Pass a smaller raw amount or filter client-side.`, undefined, !!options.json);
      }
      return n;
    };

    const filters: NonNullable<GetTransfersByAddressConfig["filters"]> = {};
    if (options.blockTimeGte || options.blockTimeLte) {
      filters.blockTime = {};
      if (options.blockTimeGte) filters.blockTime.gte = parseInt(options.blockTimeGte, 10);
      if (options.blockTimeLte) filters.blockTime.lte = parseInt(options.blockTimeLte, 10);
    }
    if (options.slotGte || options.slotLte) {
      filters.slot = {};
      if (options.slotGte) filters.slot.gte = parseInt(options.slotGte, 10);
      if (options.slotLte) filters.slot.lte = parseInt(options.slotLte, 10);
    }
    const aGte = parseAmountBound(options.amountGte, "--amount-gte");
    const aLte = parseAmountBound(options.amountLte, "--amount-lte");
    if (aGte !== undefined || aLte !== undefined) {
      filters.amount = {};
      if (aGte !== undefined) filters.amount.gte = aGte;
      if (aLte !== undefined) filters.amount.lte = aLte;
    }
    if (Object.keys(filters).length > 0) config.filters = filters;

    // The SDK takes a single [address, config] tuple as the JSON-RPC params
    const result = await withRetry<GetTransfersByAddressResult>(() => helius.getTransfersByAddress([address, config]), options, spinner);
    spinner?.stop();

    if (options.json) {
      outputJson(result);
      return;
    }

    const data = result?.data || [];
    if (!Array.isArray(data) || data.length === 0) {
      console.log(chalk.yellow("\nNo transfers found."));
      return;
    }

    const WSOL = "So11111111111111111111111111111111111111112";
    const NATIVE_SOL = "So11111111111111111111111111111111111111111";
    console.log(chalk.bold(`\nTransfers for ${chalk.cyan(address)}:\n`));
    for (const t of data) {
      // Native SOL transfers come back with the native mint (or WSOL) and no token accounts; accept null or undefined from JSON.
      const isSol = (t.mint === NATIVE_SOL || t.mint === WSOL) && t.fromTokenAccount == null && t.toTokenAccount == null;
      const amount = `${t.uiAmount} ${isSol ? "SOL" : formatAddress(t.mint)}`;
      const from = t.fromUserAccount ? formatAddress(t.fromUserAccount) : (t.type === "mint" ? "mint" : "?");
      const to = t.toUserAccount ? formatAddress(t.toUserAccount) : (t.type === "burn" ? "burn" : "?");
      const time = t.blockTime ? formatTimestamp(Number(t.blockTime)) : "N/A";
      console.log(`  ${chalk.yellow((t.type || "transfer").padEnd(10))} ${amount}`);
      console.log(`    ${from} ${chalk.gray("→")} ${to}`);
      console.log(`    ${chalk.gray("sig:")} ${chalk.cyan(formatAddress(t.signature))}  ${chalk.gray("slot:")} ${t.slot.toString()}  ${chalk.gray(time)}`);
    }
    console.log(chalk.gray(`\n  ${data.length} transfer(s) shown`));
    if (result?.paginationToken) {
      console.log(chalk.gray(`  Next: --pagination-token ${result.paginationToken}`));
    }
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

interface TxScanOptions extends TxOptions {
  programs?: string;
  instructions?: string;
  discriminators?: string;
  programScope?: string;
  mints?: string;
  mintScope?: string;
  match?: string;
  returnShape?: string;
  limit?: string;
  maxScanned?: string;
  sortOrder?: string;
  status?: string;
  tokenAccounts?: string;
  blockTimeGte?: string;
  blockTimeLte?: string;
  slotGte?: string;
  slotLte?: string;
  paginationToken?: string;
}

const SCAN_STOP_REASONS: Record<string, string> = {
  windowEnd: "reached the end of the history or window",
  limit: "returned --limit matches",
  budget: "scanned --max-scanned transactions",
  deadline: "reached the request time limit",
};

const splitList = (value: string) => value.split(",").map((s) => s.trim()).filter(Boolean);

/** Parsed Events scan: search an address's history server-side for program instructions or token mints. */
export async function txScanCommand(address: string, options: TxScanOptions = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const json = !!options.json;
    const addrErr = validateAddress(address);
    if (addrErr) exitWithError("INVALID_ADDRESS", addrErr, undefined, json);

    if (resolveNetwork(options) === "devnet") {
      exitWithError("INVALID_INPUT", "tx scan uses the Parsed Events API, which serves mainnet only. Re-run with --network mainnet.", undefined, json);
    }

    const oneOf = (flag: string, value: string | undefined, allowed: string[]) => checkOneOf(flag, value, allowed, json);
    oneOf("--program-scope", options.programScope, ["address", "transaction"]);
    oneOf("--mint-scope", options.mintScope, ["address", "transaction"]);
    oneOf("--return-shape", options.returnShape, ["transactions", "signatures", "count"]);
    oneOf("--sort-order", options.sortOrder, ["asc", "desc"]);
    oneOf("--status", options.status, ["succeeded", "failed", "any"]);
    oneOf("--token-accounts", options.tokenAccounts, ["none", "balanceChanged", "all"]);

    const int = (flag: string, raw: string | undefined, min?: number, max?: number) => parseIntFlag(flag, raw, json, min, max);

    let match: unknown;
    const usesMatchFlags = [options.programs, options.instructions, options.discriminators, options.programScope, options.mints, options.mintScope]
      .some((v) => v !== undefined);
    if (options.match !== undefined) {
      if (usesMatchFlags) {
        exitWithError("INVALID_INPUT", "--match replaces --programs, --instructions, --discriminators, --mints, and the scope flags. Use one or the other.", undefined, json);
      }
      try {
        match = JSON.parse(options.match);
      } catch {
        exitWithError("INVALID_INPUT", `--match must be a JSON object, e.g. '{"programs":[{"programId":"...","instructions":["buy"]}]}'`, undefined, json);
      }
      const matchErr = validateScanMatch(match);
      if (matchErr) exitWithError("INVALID_INPUT", `--match: ${matchErr}`, undefined, json);
    } else {
      const programIds = options.programs ? splitList(options.programs) : [];
      const mints = options.mints ? splitList(options.mints) : [];
      const listErr = validateAddresses([...programIds, ...mints]);
      if (listErr) exitWithError("INVALID_ADDRESS", listErr, undefined, json);
      if (programIds.length === 0 && mints.length === 0) {
        exitWithError("INVALID_INPUT", "Pass --programs, --mints, or both (or --match): a scan returns only the transactions that match them.", undefined, json);
      }
      const instructions = options.instructions ? splitList(options.instructions) : [];
      const discriminators = options.discriminators ? splitList(options.discriminators) : [];
      if ((instructions.length > 0 || discriminators.length > 0) && programIds.length !== 1) {
        exitWithError("INVALID_INPUT", "--instructions and --discriminators apply to a single program. With several programs, pass per-program lists in --match.", undefined, json);
      }
      const programScope = options.programScope as ScanMatchScope | undefined;
      const mintScope = options.mintScope as ScanMatchScope | undefined;
      match = {
        ...(programIds.length > 0 && {
          programs: programIds.map((programId) => ({
            programId,
            ...(instructions.length > 0 && { instructions }),
            ...(discriminators.length > 0 && { discriminators }),
            ...(programScope && { scope: programScope }),
          })),
        }),
        ...(mints.length > 0 && { mints: mints.map((mint) => ({ mint, ...(mintScope && { scope: mintScope }) })) }),
      };
      // Same rules as --match: counts, duplicates, and discriminator format
      const matchErr = validateScanMatch(match);
      if (matchErr) exitWithError("INVALID_INPUT", matchErr, undefined, json);
    }

    const returnShape = (options.returnShape ?? "transactions") as ScanReturnShape;
    const request: ScanParsedTransactionHistoryRequest<ScanReturnShape> = { address, match: match as ScanMatch, returnShape };
    if (returnShape === "transactions") request.limit = int("--limit", options.limit, 1, 100) ?? 25;
    const maxScanned = int("--max-scanned", options.maxScanned, 1, 10_000);
    if (maxScanned !== undefined) request.budget = { maxScannedTransactions: maxScanned };
    if (options.sortOrder) request.sortOrder = options.sortOrder as "asc" | "desc";
    if (options.status) request.status = options.status as "succeeded" | "failed" | "any";
    if (options.tokenAccounts) request.tokenAccounts = options.tokenAccounts as "none" | "balanceChanged" | "all";
    const time = parseBounds("--block-time-gte", options.blockTimeGte, "--block-time-lte", options.blockTimeLte, json);
    if (time) request.time = time;
    const slot = parseBounds("--slot-gte", options.slotGte, "--slot-lte", options.slotLte, json);
    if (slot) request.slot = slot;
    if (options.paginationToken) request.paginationToken = options.paginationToken;

    const helius = await setupClient(spinner, options, "Scanning transaction history...");
    const result = await withRetry<ScanParsedTransactionHistoryResponse<ScanReturnShape>>(() => helius.parsedEvents.scan(request), options, spinner);
    spinner?.stop();

    if (json) {
      outputJson(result);
      return;
    }

    const { scan } = result;
    const through = scan.scannedThrough
      ? ` through slot ${scan.scannedThrough.slot.toLocaleString()}${scan.scannedThrough.blockTime ? ` (${formatTimestamp(scan.scannedThrough.blockTime)})` : ""}`
      : "";
    console.log(chalk.bold(`\nScan of ${chalk.cyan(address)}:\n`));
    console.log(chalk.gray(`  Scanned ${scan.scannedTransactions.toLocaleString()} transactions${through}, matched ${scan.matchedTransactions.toLocaleString()}.`));
    console.log(chalk.gray(`  Stopped on ${scan.stoppedOn}: ${SCAN_STOP_REASONS[scan.stoppedOn] ?? scan.stoppedOn}. Credits charged: ${scan.creditsCharged}.\n`));

    if (returnShape === "count") {
      console.log(`  ${chalk.gray("Matches:")} ${chalk.cyan(scan.matchedTransactions.toLocaleString())}`);
    } else if (!result.data || result.data.length === 0) {
      console.log(chalk.yellow("  No matches in the range scanned."));
    } else if (returnShape === "signatures") {
      for (const item of result.data as ScanSignature[]) {
        const time = item.blockTime ? formatTimestamp(item.blockTime) : "N/A";
        console.log(`  ${chalk.cyan(item.signature)}  ${chalk.gray(`slot ${item.slot}`)}  ${chalk.gray(time)}`);
      }
    } else {
      for (const item of result.data as ParsedTransactionResult[]) {
        if (item.parserStatus !== "OK") {
          console.log(`  ${chalk.cyan(item.signature)}  ${chalk.yellow(`could not be parsed: ${item.parserError.code}`)}`);
          continue;
        }
        const tx = item.parsed;
        const type = tx.summary?.type ? formatEnumLabel(tx.summary.type) : "Unknown";
        const time = tx.blockTime ? formatTimestamp(tx.blockTime) : "N/A";
        const status = tx.transactionStatus === "OK" ? "" : chalk.red(" failed");
        console.log(`  ${chalk.cyan(item.signature)}`);
        console.log(`    ${chalk.yellow(type.padEnd(16))}  ${chalk.gray(time)}${status}`);
        if (tx.summary?.description) console.log(`    ${chalk.gray(tx.summary.description)}`);
      }
    }

    if (result.paginationToken) {
      const partial = returnShape === "count" ? " The count covers only the range scanned; add up the counts across pages." : "";
      console.log(chalk.gray(`\n  The history continues.${partial}`));
      console.log(chalk.gray(`  Next: --pagination-token ${result.paginationToken}`));
    }
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}

export async function txFeesCommand(options: TxOptions & { accounts?: string } = {}): Promise<void> {
  const spinner = createSpinner(options);
  try {
    const helius = await setupClient(spinner, options, "Fetching priority fee estimate...");
    const params: any = { options: { includeAllPriorityFeeLevels: true } };
    if (options.accounts) {
      params.accountKeys = options.accounts.split(",").map((s: string) => s.trim());
    }
    const result = await withRetry(() => helius.getPriorityFeeEstimate(params), options, spinner);
    spinner?.stop();

    if (options.json) {
      outputJson(result);
      return;
    }

    console.log(chalk.bold("\nPriority Fee Estimates (microlamports per CU):\n"));
    const levels = (result as any)?.priorityFeeLevels;
    if (levels) {
      for (const [level, fee] of Object.entries(levels)) {
        console.log(`  ${chalk.gray(level.padEnd(12))} ${chalk.cyan(String(fee))}`);
      }
    } else {
      console.log(chalk.gray("  No fee data available."));
    }
  } catch (error) {
    handleCommandError(error, options, spinner);
  }
}
