import { z } from 'zod';
import type { ActionRegistry } from '../router/action-registry.js';
import { getNetwork, hasApiKey, rpcRequest } from '../utils/helius.js';
import { formatSol } from '../utils/formatters.js';
import { noApiKeyResponse } from './shared.js';
import { mcpError, mcpText, handleToolError, type ErrorHandler } from '../utils/errors.js';
import { contextFromExtra } from '../utils/request-context.js';

// Historical account state (beta): getHistoricalAccountInfo and
// getHistoricalTokenAccountsByOwner read accounts as they were at a past slot,
// or right after one transaction within it. Both take `[address, query, config]`,
// where the query object `{ slot?, transactionIndex? }` picks the position.
// Mainnet only, Business plans and above, 0 credits per call.
//
// helius-sdk wraps both methods from the release after 3.4.1. Until the MCP
// depends on that release, they go through rpcRequest.

/** The first slot with history: the state at the start of epoch 1030. */
export const HISTORY_START_SLOT = 444_959_999;
const MAX_TRANSACTION_INDEX = 16_777_214;
const MAX_TOKEN_ACCOUNTS = 1000;
/** Base64 characters of raw account data to show before truncating. */
const MAX_DATA_CHARS = 2000;
const MAX_LIST_DATA_CHARS = 300;

const TOKEN_PROGRAMS: Record<string, string> = {
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'SPL Token',
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: 'Token-2022',
};

const ENCODINGS = ['base64', 'base64+zstd', 'jsonParsed'] as const;
const COMMITMENTS = ['finalized', 'confirmed'] as const;

const AVAILABILITY = 'Beta. Mainnet only, Business plan or higher, 0 credits per call. History starts at slot 444959999 (September 7, 2026).';

// ─── Response shapes (see GetHistoricalAccountInfoResponse in helius-sdk) ───

type WritePosition = { slot: number; transactionIndex: number | null };

type ParsedData = { program: string; parsed: any; space: number };

type HistoricalAccount = {
  lamports: number;
  owner: string;
  data: [string, string] | ParsedData;
  executable: boolean;
  rentEpoch: number;
  space: number;
  lastUpdatedAt: WritePosition;
};

type AccountInfoResult = {
  context: { slot: number };
  value: HistoricalAccount | null;
};

type TokenAccountsResult = {
  context: { slot: number };
  value: {
    accounts: Array<{ pubkey: string; account: HistoricalAccount }>;
    paginationKey: string | null;
  };
};

// ─── Shared params, validation, and wording ───

const positionParams = {
  slot: z.number().int().optional().describe('Read state at the end of this slot (444959999 or later). Omit for the latest indexed slot.'),
  transactionIndex: z.number().int().min(0).max(MAX_TRANSACTION_INDEX).optional().describe('Read state right after the transaction at this index in `slot` executed. Requires `slot`. To read the state just before a transaction at index N, pass N - 1 (or the previous slot when N is 0).'),
};

const configParams = {
  encoding: z.enum(ENCODINGS).optional().describe('Account data encoding. Defaults to jsonParsed, or base64 when dataSlice is set. base58 is not supported.'),
  dataSlice: z.object({
    offset: z.number().int().min(0),
    length: z.number().int().min(0),
  }).optional().describe('Return only this byte range of the account data. Applies to base64 and base64+zstd.'),
  commitment: z.enum(COMMITMENTS).optional().default('finalized').describe('finalized (default) or confirmed. processed is not supported.'),
};

type Position = { slot?: number; transactionIndex?: number };

function positionError(p: Position) {
  if (p.transactionIndex !== undefined && p.slot === undefined) {
    const recovery = 'Pass `slot` with `transactionIndex`. Find a transaction\'s slot and index with heliusTransaction.getTransactionHistory.';
    return mcpError(`**Historical Account Error**\n\n\`transactionIndex\` requires \`slot\`. ${recovery}`,
      { type: 'VALIDATION', code: 'MISSING_PARAM', retryable: false, recovery });
  }
  if (p.slot !== undefined && p.slot < HISTORY_START_SLOT) {
    return beforeCoverageError();
  }
  return null;
}

function beforeCoverageError() {
  const recovery = `Query slot ${HISTORY_START_SLOT} or later.`;
  return mcpError(
    `**Historical Account Error**\n\nHistory isn't available before slot ${HISTORY_START_SLOT.toLocaleString()} (September 7, 2026, the start of epoch 1030). ${recovery}`,
    { type: 'VALIDATION', code: 'BEFORE_HISTORY_COVERAGE', retryable: false, recovery },
  );
}

function devnetError() {
  const recovery = 'Switch to mainnet: historical account methods are not available on devnet.';
  return mcpError(`**Historical Account Error**\n\n${recovery}`,
    { type: 'UNSUPPORTED', code: 'MAINNET_ONLY', retryable: false, recovery });
}

function historicalErrors(): ErrorHandler[] {
  return [
    { match: (m) => m.includes('RPC error -32018'), respond: beforeCoverageError },
    {
      match: (m) => m.includes('RPC error -32004'),
      respond: () => {
        const recovery = 'Pass `commitment: "confirmed"`, or query an older slot.';
        return mcpError(`**Historical Account Error**\n\nThat slot is newer than the requested commitment allows. ${recovery}`,
          { type: 'VALIDATION', code: 'SLOT_NOT_YET_AVAILABLE', retryable: true, recovery });
      },
    },
    {
      match: (m) => m.includes('RPC error -32601'),
      respond: () => {
        const recovery = 'Historical account methods are served on mainnet only. Check that the network is mainnet.';
        return mcpError(`**Historical Account Error**\n\nMethod not found. ${recovery}`,
          { type: 'UNSUPPORTED', code: 'METHOD_NOT_FOUND', retryable: false, recovery });
      },
    },
    {
      match: (m) => m.includes('RPC error -32602'),
      respond: (m) => {
        const detail = m.replace(/^RPC error -32602:\s*/, '');
        const recovery = 'Fix the parameter the message names.';
        return mcpError(`**Historical Account Error**\n\nInvalid parameters: ${detail}`,
          { type: 'VALIDATION', code: 'INVALID_PARAMS', retryable: false, recovery });
      },
    },
    {
      match: (m) => m.includes('HTTP 403'),
      respond: () => {
        const recovery = 'Historical account state requires a Business plan or higher. Call `getAccountPlan` to check the current plan, or `previewUpgrade` to see upgrade pricing.';
        return mcpError(`**Historical Account Error**\n\n${recovery}`,
          { type: 'AUTH', code: 'HTTP_403', retryable: false, recovery });
      },
    },
  ];
}

/** `[address, query, config]`, leaving the query empty rather than sending nulls. */
function buildParams(address: string, p: Position, config: Record<string, unknown>): unknown[] {
  const query: Position = {};
  if (p.slot !== undefined) query.slot = p.slot;
  if (p.transactionIndex !== undefined) query.transactionIndex = p.transactionIndex;
  return [address, query, config];
}

function describePosition(p: Position): string {
  if (p.slot === undefined) return 'latest indexed slot';
  if (p.transactionIndex === undefined) return `end of slot ${p.slot.toLocaleString()}`;
  return `right after transaction ${p.transactionIndex} in slot ${p.slot.toLocaleString()}`;
}

function describeWrite(w: WritePosition): string {
  if (w.transactionIndex === null) {
    return w.slot <= HISTORY_START_SLOT
      ? `unchanged since history coverage began (slot ${HISTORY_START_SLOT.toLocaleString()}); the actual last write is earlier`
      : `slot ${w.slot.toLocaleString()}, outside a transaction (e.g. epoch rewards)`;
  }
  return `slot ${w.slot.toLocaleString()}, transaction ${w.transactionIndex}`;
}

/** The position just before a write, for walking an account's history backward. */
export function positionBefore(w: WritePosition): Position | null {
  if (w.slot <= HISTORY_START_SLOT) return null;
  return w.transactionIndex ? { slot: w.slot, transactionIndex: w.transactionIndex - 1 } : { slot: w.slot - 1 };
}

function formatPositionParams(p: Position): string {
  return p.transactionIndex === undefined
    ? `\`slot: ${p.slot}\``
    : `\`slot: ${p.slot}, transactionIndex: ${p.transactionIndex}\``;
}

function resolveEncoding(encoding: string | undefined, dataSlice: unknown): string {
  return encoding ?? (dataSlice ? 'base64' : 'jsonParsed');
}

function buildConfig(encoding: string, dataSlice: unknown, commitment: string): Record<string, unknown> {
  return { encoding, commitment, ...(dataSlice ? { dataSlice } : {}) };
}

function truncateData(data: string, max: number): string {
  return data.length <= max ? data : `${data.slice(0, max)}… (${data.length.toLocaleString()} chars, truncated; pass dataSlice to read a range)`;
}

function formatInfoValue(value: unknown): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

// ─── Handlers ───

export function registerHistoricalAccountTools(registry: ActionRegistry) {
  registry.registerAction(
    'getHistoricalAccountInfo',
    'BEST FOR: reading one Solana account as it was at a past slot, or right after a specific transaction in that slot: debugging what a transaction changed, auditing a pool/vault/oracle at a point in time. PREFER getAccountInfo for current state. PREFER heliusWallet.getWalletBalanceAt for one token balance at a timestamp. Returns the account (balance, owner, parsed data or raw bytes) plus `lastUpdatedAt`, the write that produced that state, and the position to query next to read the state before it. To compare before and after a transaction at index N, read `transactionIndex: N` and `N - 1`; find a transaction\'s slot and index with heliusTransaction.getTransactionHistory. ' + AVAILABILITY,
    {
      address: z.string().describe('Account address (base58)'),
      ...positionParams,
      ...configParams,
    },
    async ({ address, slot, transactionIndex, encoding, dataSlice, commitment }, extra) => {
      const ctx = contextFromExtra(extra);
      if (!hasApiKey(ctx)) return noApiKeyResponse();
      if (getNetwork(ctx) === 'devnet') return devnetError();

      const position = { slot, transactionIndex };
      const invalid = positionError(position);
      if (invalid) return invalid;

      const resolvedEncoding = resolveEncoding(encoding, dataSlice);
      let result: AccountInfoResult;
      try {
        result = await rpcRequest<AccountInfoResult>(
          'getHistoricalAccountInfo',
          buildParams(address, position, buildConfig(resolvedEncoding, dataSlice, commitment)),
          ctx,
        );
      } catch (err) {
        return handleToolError(err, 'Error fetching historical account info', historicalErrors());
      }

      const lines = [
        `**Account ${address}** at ${describePosition(position)}`,
        '',
      ];

      const account = result?.value;
      if (!account) {
        lines.push(
          'The account did not exist at this position: it had not been created yet, or it had been closed.',
          '',
          'A missing account carries no `lastUpdatedAt`, so this does not say when it was created or closed. Use heliusTransaction.getTransactionHistory on the address to find those transactions.',
        );
        if (result?.context?.slot) lines.push('', `**Indexed through slot:** ${result.context.slot.toLocaleString()}`);
        return mcpText(lines.join('\n'));
      }

      const lamports = Number(account.lamports);
      lines.push(
        `**Last written:** ${describeWrite(account.lastUpdatedAt)}`,
        `**Balance:** ${formatSol(lamports)} (${lamports.toLocaleString()} lamports)`,
        `**Owner:** ${account.owner}`,
        `**Executable:** ${account.executable ? 'Yes' : 'No'}`,
        `**Data Size:** ${Number(account.space).toLocaleString()} bytes`,
      );

      if (Array.isArray(account.data)) {
        const [data, dataEncoding] = account.data;
        const fellBack = resolvedEncoding === 'jsonParsed';
        lines.push('', `**Data (${dataEncoding}${fellBack ? ', not parseable at this position' : ''}):**`);
        lines.push(data ? truncateData(data, MAX_DATA_CHARS) : '(empty)');
      } else if (account.data) {
        lines.push('', '**Parsed Data:**', `  Program: ${account.data.program}`);
        if (account.data.parsed?.type) lines.push(`  Account Type: ${account.data.parsed.type}`);
        for (const [key, value] of Object.entries(account.data.parsed?.info ?? {})) {
          lines.push(`  ${key}: ${formatInfoValue(value)}`);
        }
      }

      lines.push('', `**Indexed through slot:** ${result.context.slot.toLocaleString()} (the latest slot Helius had indexed, not the slot queried)`);

      const before = positionBefore(account.lastUpdatedAt);
      lines.push(before
        ? `**Previous state:** call again with ${formatPositionParams(before)} to read the account just before this write.`
        : '**Previous state:** none available; this is the state when history coverage began.');

      return mcpText(lines.join('\n'));
    },
  );

  registry.registerAction(
    'getHistoricalTokenAccountsByOwner',
    'BEST FOR: listing every SPL Token and Token-2022 account a wallet owned at a past slot, or right after a specific transaction: point-in-time holdings for audits, accounting, or tax reporting. With jsonParsed (default), amounts use each mint\'s decimals as of that position. PREFER heliusWallet.getTokenBalances for current holdings with prices. PREFER heliusWallet.getWalletBalanceAt for one token balance at a timestamp. Optional filter: `mint` OR `programId`, not both. Paginates with `paginationToken`; keep `slot` the same on every page so pages come from one snapshot. ' + AVAILABILITY,
    {
      address: z.string().describe('Owner wallet address (base58). Pass the wallet, not a token account.'),
      ...positionParams,
      mint: z.string().optional().describe('Return only token accounts for this mint. Can\'t be combined with programId.'),
      programId: z.string().optional().describe('Return only accounts owned by this token program (SPL Token or Token-2022). Can\'t be combined with mint.'),
      limit: z.number().int().min(1).max(MAX_TOKEN_ACCOUNTS).optional().default(100).describe(`Token accounts per page (1-${MAX_TOKEN_ACCOUNTS}, default 100)`),
      paginationToken: z.string().optional().describe('Cursor from the previous page. Keep address, slot, and filters the same.'),
      // The RPC calls the cursor paginationKey; accept that spelling too.
      paginationKey: z.string().optional().describe('Alias for paginationToken'),
      ...configParams,
    },
    async ({ address, slot, transactionIndex, mint, programId, limit, paginationToken, paginationKey, encoding, dataSlice, commitment }, extra) => {
      const ctx = contextFromExtra(extra);
      if (!hasApiKey(ctx)) return noApiKeyResponse();
      if (getNetwork(ctx) === 'devnet') return devnetError();

      const position = { slot, transactionIndex };
      const invalid = positionError(position);
      if (invalid) return invalid;

      if (mint && programId) {
        const recovery = 'Filter by `mint` or `programId`, not both.';
        return mcpError(`**Historical Token Accounts Error**\n\n${recovery}`,
          { type: 'VALIDATION', code: 'EXCLUSIVE_PARAMS', retryable: false, recovery });
      }
      if (programId && !TOKEN_PROGRAMS[programId]) {
        const recovery = `Pass one of: ${Object.keys(TOKEN_PROGRAMS).join(', ')}.`;
        return mcpError(`**Historical Token Accounts Error**\n\n\`programId\` must be a token program. ${recovery}`,
          { type: 'VALIDATION', code: 'INVALID_ENUM', retryable: false, recovery });
      }

      const resolvedEncoding = resolveEncoding(encoding, dataSlice);
      const cursor = paginationToken ?? paginationKey;
      const config = {
        ...buildConfig(resolvedEncoding, dataSlice, commitment),
        limit,
        ...(mint ? { mint } : {}),
        ...(programId ? { programId } : {}),
        ...(cursor ? { paginationKey: cursor } : {}),
      };

      let result: TokenAccountsResult;
      try {
        result = await rpcRequest<TokenAccountsResult>(
          'getHistoricalTokenAccountsByOwner',
          buildParams(address, position, config),
          ctx,
        );
      } catch (err) {
        return handleToolError(err, 'Error fetching historical token accounts', historicalErrors());
      }

      const accounts = result?.value?.accounts ?? [];
      const next = result?.value?.paginationKey ?? null;
      const filter = mint ? `mint ${mint}` : programId ? `${TOKEN_PROGRAMS[programId]} accounts` : 'all token accounts';

      const lines = [
        `**Historical Token Accounts for ${address}** at ${describePosition(position)}`,
        `Filter: ${filter} | ${accounts.length} on this page${cursor ? ' (continued)' : ''}`,
        `Indexed through slot: ${result?.context?.slot?.toLocaleString() ?? 'unknown'}`,
      ];

      if (accounts.length === 0) {
        lines.push('', next
          ? 'No token accounts on this page, but the scan stopped early (each call examines at most 100,000 accounts). More may remain; fetch the next page.'
          : 'The wallet owned no matching token accounts at this position.');
      }

      for (const { pubkey, account } of accounts) {
        lines.push('', `**${pubkey}**`);
        if (Array.isArray(account.data)) {
          const [data, dataEncoding] = account.data;
          if (resolvedEncoding === 'jsonParsed') {
            lines.push('  Not parseable at this position (the mint could not be read); returned as base64.');
          }
          lines.push(`  Data (${dataEncoding}): ${data ? truncateData(data, MAX_LIST_DATA_CHARS) : '(empty)'}`);
        } else {
          const info = account.data?.parsed?.info ?? {};
          const amount = info.tokenAmount;
          lines.push(`  Mint: ${info.mint ?? 'unknown'}`);
          if (amount) {
            lines.push(`  Balance: ${amount.uiAmountString ?? amount.uiAmount} (${amount.amount} raw, ${amount.decimals} decimals)`);
          }
          if (info.state && info.state !== 'initialized') lines.push(`  State: ${info.state}`);
          if (info.delegate) {
            lines.push(`  Delegate: ${info.delegate}${info.delegatedAmount ? ` (${info.delegatedAmount.uiAmountString} delegated)` : ''}`);
          }
          if (info.isNative) lines.push('  Wrapped SOL');
        }
        lines.push(`  Program: ${TOKEN_PROGRAMS[account.owner] ?? account.owner}`);
        lines.push(`  Last written: ${describeWrite(account.lastUpdatedAt)}`);
      }

      if (next) {
        lines.push('', `**Next page:** pass \`paginationToken: "${next}"\` with the same address, slot, and filters. Only a missing token means the end; a short page does not.`);
        if (slot === undefined) {
          lines.push('**Warning:** no `slot` was pinned, so the next page reads the latest indexed slot and can come from a later point in time than this one. Pass `slot` on every page for a consistent snapshot.');
        }
      }

      return mcpText(lines.join('\n'), next
        ? { continuation: { kind: 'paginationToken', api: 'raw', token: next } }
        : undefined);
    },
  );
}
