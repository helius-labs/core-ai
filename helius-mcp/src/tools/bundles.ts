import { z } from 'zod';
import type { ActionRegistry } from '../router/action-registry.js';
import { hasApiKey, rpcRequest } from '../utils/helius.js';
import { formatAddress, formatSol } from '../utils/formatters.js';
import { noApiKeyResponse } from './shared.js';
import { mcpError, mcpText, handleToolError } from '../utils/errors.js';
import { contextFromExtra } from '../utils/request-context.js';

/** Jito caps a bundle at five transactions, and getBundleStatuses at five IDs. */
const MAX_BUNDLE_SIZE = 5;

type SimAccount = { lamports: number; owner: string; executable: boolean } | null;

type BundleTransactionResult = {
  err: unknown;
  logs: string[] | null;
  unitsConsumed?: number | null;
  returnData?: { programId: string; data: [string, string] } | null;
  postExecutionAccounts?: SimAccount[] | null;
};

type SimulateBundleResult = {
  context?: { slot?: number };
  value?: {
    summary: 'succeeded' | { failed: { error: unknown; tx_signature?: string | null } };
    transactionResults: BundleTransactionResult[];
  };
};

type BundleStatus = {
  bundle_id: string;
  transactions: string[];
  slot: number;
  confirmation_status: string;
  err: unknown;
} | null;

type BundleStatusesResult = { context?: { slot?: number }; value?: BundleStatus[] };

function tooManyError(field: string, count: number) {
  return mcpError(`At most ${MAX_BUNDLE_SIZE} ${field} are allowed; got ${count}.`, {
    type: 'VALIDATION',
    code: 'TOO_MANY_ITEMS',
    retryable: false,
    recovery: `Pass ${MAX_BUNDLE_SIZE} or fewer ${field}.`,
  });
}

/** A bundle or transaction error as one line. Jito reports success as `{ "Ok": null }`. */
function formatErr(err: unknown): string | null {
  if (err == null) return null;
  if (typeof err === 'object' && 'Ok' in (err as object)) return null;
  return typeof err === 'object' ? JSON.stringify(err) : String(err);
}

/**
 * The bundle-level failure. Jito reports a failed transaction as
 * `{ TransactionFailure: [signatureBytes, message] }`; the signature is shown
 * separately in base58, so keep only the message.
 */
function formatBundleFailure(error: unknown): string {
  const failure = (error as { TransactionFailure?: unknown } | null)?.TransactionFailure;
  if (Array.isArray(failure) && typeof failure[1] === 'string') return failure[1];
  return formatErr(error) ?? 'unknown';
}

export function registerBundleTools(registry: ActionRegistry) {
  // Simulate a Jito bundle (dry run — does NOT submit anything)
  registry.registerAction(
    'simulateBundle',
    'BEST FOR: dry-running a Jito bundle before sending it. Simulates up to 5 base64-encoded transactions in order, against current chain state, and returns whether the bundle would succeed, which transaction failed and why, and each transaction\'s compute units and program logs. Pass `addresses` to see their state after each transaction. Does NOT submit anything on-chain. Defaults match simulateTransaction: replaces the recent blockhash and skips signature verification. Credit cost: 1 credit/call.',
    {
      transactions: z.array(z.string()).min(1).describe('Base64-encoded serialized transactions (not base58), in bundle order. 1 to 5.'),
      sigVerify: z.boolean().optional().default(false).describe('Verify transaction signatures. Requires a valid recent blockhash, so it turns off replaceRecentBlockhash.'),
      replaceRecentBlockhash: z.boolean().optional().default(true).describe('Replace each recent blockhash with the latest before simulating (default true), so unsigned or stale transactions can be simulated. Ignored when sigVerify=true.'),
      addresses: z.array(z.string()).optional().describe('Account addresses (base58) to return state for after each transaction.'),
    },
    async ({ transactions, sigVerify, replaceRecentBlockhash, addresses }, extra) => {
      const ctx = contextFromExtra(extra);
      if (!hasApiKey(ctx)) return noApiKeyResponse();
      if (transactions.length > MAX_BUNDLE_SIZE) return tooManyError('transactions', transactions.length);

      const verify = sigVerify === true;
      const replaceBlockhash = verify ? false : replaceRecentBlockhash !== false;
      const capture = addresses && addresses.length > 0 ? { addresses, encoding: 'base64' } : null;

      let result: SimulateBundleResult;
      try {
        result = await rpcRequest<SimulateBundleResult>('simulateBundle', [
          { encodedTransactions: transactions },
          {
            // One entry per transaction; null captures nothing.
            preExecutionAccountsConfigs: transactions.map(() => null),
            postExecutionAccountsConfigs: transactions.map(() => capture),
            transactionEncoding: 'base64',
            skipSigVerify: !verify,
            replaceRecentBlockhash: replaceBlockhash,
          },
        ], ctx);
      } catch (err) {
        return handleToolError(err, 'Simulate Bundle Error');
      }

      const value = result?.value;
      if (!value) {
        return mcpText('**Bundle Simulation**\n\nNo simulation result was returned by the RPC.');
      }

      const failure = typeof value.summary === 'object' ? value.summary.failed : null;
      const lines: string[] = ['**Bundle Simulation**', ''];
      if (result.context?.slot != null) {
        lines.push(`**Simulated at slot:** ${Number(result.context.slot).toLocaleString()}`);
      }
      lines.push(`**Status:** ${failure ? '❌ Would fail' : '✅ Would succeed'} (${transactions.length} transaction${transactions.length === 1 ? '' : 's'})`);
      if (failure) {
        lines.push(`**Error:** ${formatBundleFailure(failure.error)}`);
        if (failure.tx_signature) lines.push(`**Failed transaction:** \`${failure.tx_signature}\``);
      }
      lines.push(`**Signature verification:** ${verify ? 'on' : 'off'} | **Replace blockhash:** ${replaceBlockhash ? 'on' : 'off'}`);

      value.transactionResults.forEach((tx, i) => {
        const txErr = formatErr(tx.err);
        lines.push('', `### Transaction ${i + 1}: ${txErr ? `❌ ${txErr}` : '✅ ok'}`);
        if (tx.unitsConsumed != null) {
          lines.push(`**Compute Units Consumed:** ${Number(tx.unitsConsumed).toLocaleString()}`);
        }
        if (tx.returnData?.data?.[0]) {
          lines.push(`**Return Data** (program \`${tx.returnData.programId}\`): \`${tx.returnData.data[0]}\``);
        }
        if (tx.logs && tx.logs.length > 0) {
          lines.push(`**Program Logs (${tx.logs.length}):**`, '```', ...tx.logs, '```');
        }
        if (capture && Array.isArray(tx.postExecutionAccounts)) {
          lines.push('**Account State After:**');
          addresses!.forEach((addr, j) => {
            const acc = tx.postExecutionAccounts![j];
            lines.push(acc
              ? `- ${formatAddress(addr)}: ${formatSol(Number(acc.lamports))}, owner ${acc.owner}${acc.executable ? ' (executable)' : ''}`
              : `- ${formatAddress(addr)}: (not found or empty)`);
          });
        }
      });

      if (value.transactionResults.length < transactions.length) {
        lines.push('', `_Results stop at transaction ${value.transactionResults.length}: the bundle halts at the first failure._`);
      }

      return mcpText(lines.join('\n'));
    },
  );

  // Look up landed Jito bundles
  registry.registerAction(
    'getBundleStatuses',
    'BEST FOR: checking whether submitted Jito bundles landed. Returns each bundle\'s confirmation status, slot, error, and transaction signatures for up to 5 bundle IDs. A bundle that has not landed, or is unknown, is reported as not found. Credit cost: 1 credit/call.',
    {
      bundleIds: z.array(z.string()).min(1).describe('Bundle IDs returned by sendBundle. 1 to 5.'),
    },
    async ({ bundleIds }, extra) => {
      const ctx = contextFromExtra(extra);
      if (!hasApiKey(ctx)) return noApiKeyResponse();
      if (bundleIds.length > MAX_BUNDLE_SIZE) return tooManyError('bundle IDs', bundleIds.length);

      let result: BundleStatusesResult;
      try {
        result = await rpcRequest<BundleStatusesResult>('getBundleStatuses', [bundleIds], ctx);
      } catch (err) {
        return handleToolError(err, 'Bundle Status Error');
      }

      const statuses = result?.value ?? [];
      const lines: string[] = ['**Bundle Statuses**', ''];
      bundleIds.forEach((id, i) => {
        // The RPC omits or nulls bundles it has not seen.
        const status = statuses.find((s) => s?.bundle_id === id) ?? statuses[i] ?? null;
        if (!status || status.bundle_id !== id) {
          lines.push(`- \`${id}\`: not found (not landed yet, expired, or unknown)`);
          return;
        }
        const err = formatErr(status.err);
        lines.push(`- \`${id}\`: **${status.confirmation_status}** at slot ${Number(status.slot).toLocaleString()}${err ? ` — ❌ ${err}` : ''}`);
        status.transactions.forEach((sig) => lines.push(`  - \`${sig}\``));
      });

      return mcpText(lines.join('\n'));
    },
  );
}
