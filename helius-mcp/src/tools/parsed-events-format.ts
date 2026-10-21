// ─── Parsed Events formatting ───
//
// Renders Parsed Events API results (helius-sdk `parsedEvents`) for the
// parseTransactions and getTransactionHistory actions. Parsed Events decodes
// instructions into named programs, instructions, and arguments, and reports
// missing or unparseable signatures per item instead of dropping them.

import type { ParsedInstruction, ParsedTransaction, ParsedTransactionResult } from 'helius-sdk/parsedEvents/types';
import { formatAddress, formatSol, formatTimestamp } from '../utils/formatters.js';

/** Resolves a mint to a display label, e.g. a symbol from token metadata. */
export type TokenLabel = (mint: string) => string;

export type SplitParsedResults = {
  parsed: Array<{ signature: string; tx: ParsedTransaction }>;
  notFound: string[];
  unparseable: Array<{ signature: string; code: string; message: string }>;
};

/** Parsed Events accepts at most this many signatures per request. */
export const PARSED_EVENTS_BATCH_SIZE = 100;

export function splitParsedResults(results: ParsedTransactionResult[]): SplitParsedResults {
  const split: SplitParsedResults = { parsed: [], notFound: [], unparseable: [] };
  for (const result of results) {
    if (result.parserStatus === 'OK') {
      split.parsed.push({ signature: result.signature, tx: result.parsed });
    } else if (result.parserError.code === 'transaction_not_found') {
      split.notFound.push(result.signature);
    } else {
      split.unparseable.push({ signature: result.signature, ...result.parserError });
    }
  }
  return split;
}

export function collectParsedMints(txs: ParsedTransaction[]): Set<string> {
  const mints = new Set<string>();
  for (const tx of txs) {
    for (const transfer of tx.tokenTransfers) {
      if (transfer.mint) mints.add(transfer.mint);
    }
  }
  return mints;
}

/** A failed transaction's error, preferring the decoded program error. */
export function formatParsedError(tx: ParsedTransaction): string | null {
  if (tx.transactionStatus !== 'ERROR') return null;

  const decoded = tx.decodedError;
  if (decoded) {
    const message = decoded.msg ? `: ${decoded.msg}` : '';
    return `${decoded.programName} error ${decoded.code} ${decoded.name}${message} (instruction ${decoded.instructionIndex})`;
  }

  const raw = tx.error as Record<string, unknown> | null | undefined;
  if (raw && Array.isArray(raw.InstructionError)) {
    const [index, reason] = raw.InstructionError;
    return `Instruction ${index} failed: ${typeof reason === 'object' ? JSON.stringify(reason) : String(reason)}`;
  }
  return raw ? JSON.stringify(raw) : 'Transaction failed';
}

function instructionLabel(ix: ParsedInstruction): string {
  const program = ix.programName ?? formatAddress(ix.programId);
  return ix.instructionName ? `${program}.${ix.instructionName}` : `${program} (not decoded)`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function formatTokenAmount(rawAmount: number, decimals: number): string {
  const amount = rawAmount / Math.pow(10, decimals);
  return amount.toLocaleString(undefined, { maximumFractionDigits: Math.min(decimals || 6, 6) });
}

function formatTransferSide(account: string | null): string {
  return account || 'unknown';
}

const MAX_TOP_LEVEL_INSTRUCTIONS = 10;
const MAX_RAW_ACCOUNTS = 10;
const MAX_INNER_INSTRUCTIONS = 5;

/** Full detail block for one transaction, as returned by parseTransactions. */
export function formatParsedTransaction(
  signature: string,
  tx: ParsedTransaction,
  tokenLabel: TokenLabel,
  showRaw: boolean,
): string[] {
  const lines: string[] = [];
  const protocol = typeof tx.summary?.parsedData?.protocol === 'string' ? tx.summary.parsedData.protocol : null;
  const fee = `${formatSol(tx.fee)} (${tx.fee.toLocaleString()} lamports)`;

  lines.push(
    `**Transaction: ${signature}**`,
    '',
    `**Type:** ${tx.summary?.type ?? 'unknown'}`,
  );
  if (protocol) lines.push(`**Protocol:** ${protocol}`);
  lines.push(
    `**Fee:** ${fee}`,
    `**Fee Payer:** ${tx.feePayer ?? 'N/A'}`,
    `**Timestamp:** ${tx.blockTime ? formatTimestamp(tx.blockTime) : 'N/A'}`,
    `**Slot:** ${tx.slot.toLocaleString()}`,
    `**Status:** ${tx.transactionStatus === 'OK' ? '✅ Success' : '❌ Failed'}`,
  );

  const error = formatParsedError(tx);
  if (error) lines.push(`**Error:** ${error}`);

  if (tx.summary?.description) {
    lines.push('', `**Description:** ${tx.summary.description}`);
  }

  const topLevel = tx.instructions.filter((ix) => ix.innerInstructionIndex === null);
  if (topLevel.length > 0) {
    lines.push('', '**Instructions:**');
    for (const ix of topLevel.slice(0, MAX_TOP_LEVEL_INSTRUCTIONS)) {
      const summary = ix.summary?.description && ix.summary.description !== tx.summary?.description
        ? ` — ${truncate(ix.summary.description, 160)}`
        : '';
      lines.push(`- [${ix.instructionIndex}] ${instructionLabel(ix)}${summary}`);
    }
    if (topLevel.length > MAX_TOP_LEVEL_INSTRUCTIONS) {
      lines.push(`_(Showing ${MAX_TOP_LEVEL_INSTRUCTIONS} of ${topLevel.length} instructions)_`);
    }
  }

  if (tx.tokenTransfers.length > 0) {
    lines.push('', '**Token Transfers:**');
    for (const t of tx.tokenTransfers) {
      lines.push(`- ${formatTransferSide(t.fromUserAccount)} → ${formatTransferSide(t.toUserAccount)}: ${formatTokenAmount(t.rawTokenAmount, t.decimals)} ${tokenLabel(t.mint)}`);
    }
  }

  // A single SOL transfer is already covered by the description.
  if (tx.nativeTransfers.length > 0 && !(tx.nativeTransfers.length === 1 && tx.summary?.description)) {
    lines.push('', '**SOL Transfers:**');
    for (const t of tx.nativeTransfers) {
      lines.push(`- ${formatTransferSide(t.fromUserAccount)} → ${formatTransferSide(t.toUserAccount)}: ${formatSol(t.amount)} (${t.amount.toLocaleString()} lamports)`);
    }
  }

  if (showRaw) {
    lines.push('', '**Raw Instructions:**');
    for (const ix of topLevel) {
      lines.push(`\n[${ix.instructionIndex}] ${instructionLabel(ix)} — Program: ${ix.programId}`);

      const named = ix.decoded?.accounts;
      const accounts = named?.length ? named.map((a) => `${a.name}: ${a.pubkey}`) : ix.rawAccounts;
      lines.push(`    Accounts (${accounts.length}):`);
      accounts.slice(0, MAX_RAW_ACCOUNTS).forEach((account, j) => lines.push(`      ${j}: ${account}`));
      if (accounts.length > MAX_RAW_ACCOUNTS) {
        lines.push(`      ... +${accounts.length - MAX_RAW_ACCOUNTS} more accounts`);
      }

      if (ix.decoded && Object.keys(ix.decoded.args).length > 0) {
        lines.push(`    Args: ${truncate(JSON.stringify(ix.decoded.args), 300)}`);
      }
      if (ix.rawData) lines.push(`    Data: ${truncate(ix.rawData, 200)}`);

      const inner = tx.instructions.filter(
        (candidate) => candidate.instructionIndex === ix.instructionIndex && candidate.innerInstructionIndex !== null,
      );
      if (inner.length > 0) {
        lines.push(`    Inner Instructions (${inner.length}):`);
        for (const child of inner.slice(0, MAX_INNER_INSTRUCTIONS)) {
          lines.push(`      [${ix.instructionIndex}.${child.innerInstructionIndex}] ${instructionLabel(child)}`);
          if (child.decoded && Object.keys(child.decoded.args).length > 0) {
            lines.push(`             Args: ${truncate(JSON.stringify(child.decoded.args), 120)}`);
          }
        }
        if (inner.length > MAX_INNER_INSTRUCTIONS) {
          lines.push(`      ... +${inner.length - MAX_INNER_INSTRUCTIONS} more inner instructions`);
        }
      }
    }
  }

  return lines;
}

/** Compact entry for one transaction in a history listing. */
export function formatParsedHistoryEntry(signature: string, tx: ParsedTransaction, tokenLabel: TokenLabel): string[] {
  const protocol = typeof tx.summary?.parsedData?.protocol === 'string' ? ` (${tx.summary.parsedData.protocol})` : '';
  const time = tx.blockTime ? formatTimestamp(tx.blockTime) : 'N/A';
  const lines = [
    `${tx.transactionStatus === 'OK' ? '✅' : '❌'} **${tx.summary?.type ?? 'unknown'}**${protocol} - ${time}`,
    `   Sig: \`${signature}\``,
  ];

  if (tx.summary?.description) lines.push(`   ${tx.summary.description}`);

  const error = formatParsedError(tx);
  if (error) lines.push(`   Error: ${error}`);

  // The summary already describes a swap's in and out amounts.
  if (tx.summary?.type !== 'swap' && tx.tokenTransfers.length > 0) {
    const parts = tx.tokenTransfers.slice(0, 3).map((t) => `${formatTokenAmount(t.rawTokenAmount, t.decimals)} ${tokenLabel(t.mint)}`);
    const more = tx.tokenTransfers.length > 3 ? ` +${tx.tokenTransfers.length - 3} more` : '';
    lines.push(`   Transfers: ${parts.join(', ')}${more}`);
  }

  lines.push(`   Fee: ${formatSol(tx.fee)}`);
  return lines;
}
