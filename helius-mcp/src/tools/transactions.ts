import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getHeliusClient, hasApiKey } from '../utils/helius.js';
import { formatSol, formatAddress, formatTimestamp, LAMPORTS_PER_SOL } from '../utils/formatters.js';
import { noApiKeyResponse } from './shared.js';
import { mcpText, getErrorMessage, validateEnum, handleToolError, http400Error } from '../utils/errors.js';
import bs58 from 'bs58';

// ─── Shared Types ───

type AssetInfo = {
  id: string;
  content?: { metadata?: { name?: string; symbol?: string } };
  token_info?: { symbol?: string; decimals?: number };
};

type RawInstruction = {
  programId: string;
  accounts: string[];
  data: string;
  innerInstructions?: RawInstruction[];
};

type TokenTransfer = {
  fromUserAccount: string | null;
  toUserAccount: string | null;
  fromTokenAccount: string | null;
  toTokenAccount: string | null;
  tokenAmount: number;
  decimals: number;
  tokenStandard?: string;
  mint: string;
};

type NativeTransfer = {
  fromUserAccount: string | null;
  toUserAccount: string | null;
  amount: number;
};

type EnrichedTransaction = {
  signature: string;
  type?: string;
  source?: string;
  description?: string;
  fee?: number;
  feePayer?: string;
  timestamp?: number;
  slot?: number;
  nativeTransfers?: NativeTransfer[] | null;
  tokenTransfers?: TokenTransfer[] | null;
  accountData?: Array<{ account: string; nativeBalanceChange: number; tokenBalanceChanges: unknown[] }>;
  transactionError?: unknown;
  instructions?: RawInstruction[];
  events?: {
    nft?: unknown;
    swap?: {
      nativeInput?: { account: string; amount: number } | null;
      nativeOutput?: { account: string; amount: number } | null;
      tokenInputs?: Array<{ rawTokenAmount: { tokenAmount: string; decimals: number }; mint: string }>;
      tokenOutputs?: Array<{ rawTokenAmount: { tokenAmount: string; decimals: number }; mint: string }>;
      innerSwaps?: unknown[];
    } | null;
    compressed?: unknown[] | null;
  };
};

type SignatureResult = {
  signature: string;
  slot: number;
  transactionIndex: number;
  err: unknown;
  memo: string | null;
  blockTime: number | null;
  confirmationStatus?: string;
};

type FullResult = {
  slot: number;
  transactionIndex: number;
  blockTime: number | null;
  transaction: { signatures: string[]; message: unknown };
  meta: { fee: number; err: unknown; preBalances: number[]; postBalances: number[] };
};

// ─── Helpers ───

const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';

function decodeComputeBudget(dataBase58: string): string | null {
  try {
    const bytes = bs58.decode(dataBase58);
    if (bytes.length === 0) return null;
    const instruction = bytes[0];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (instruction === 0x02 && bytes.length >= 5) {
      const units = view.getUint32(1, true);
      return `SetComputeUnitLimit: ${units.toLocaleString()} CUs`;
    }
    if (instruction === 0x03 && bytes.length >= 9) {
      const microLamports = view.getBigUint64(1, true);
      return `SetComputeUnitPrice: ${microLamports.toLocaleString()} micro-lamports`;
    }
    if (instruction === 0x00 && bytes.length >= 5) {
      const heapBytes = view.getUint32(1, true);
      return `RequestHeapFrame: ${heapBytes.toLocaleString()} bytes`;
    }
    return null;
  } catch {
    return null;
  }
}

// Shared helper: call getTransactionsForAddress via SDK (Helius custom RPC method)
async function fetchTransactionsForAddress(
  helius: ReturnType<typeof getHeliusClient>,
  address: string,
  params: {
    transactionDetails: 'signatures' | 'full';
    sortOrder: string;
    limit: number;
    paginationToken?: string;
    filters?: Record<string, unknown>;
  }
) {
  const reqParams: any = {
    transactionDetails: params.transactionDetails,
    sortOrder: params.sortOrder,
    limit: params.limit,
    maxSupportedTransactionVersion: 0
  };

  if (params.paginationToken) reqParams.paginationToken = params.paginationToken;
  if (params.filters && Object.keys(params.filters).length > 0) reqParams.filters = params.filters;

  // SDK returns { data, paginationToken } directly
  return await helius.getTransactionsForAddress([address, reqParams]);
}

const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{86,88}$/;

function validateSignatures(sigs: string[]): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const sig of sigs) {
    (BASE58_REGEX.test(sig) ? valid : invalid).push(sig);
  }
  return { valid, invalid };
}

function collectMints(transactions: EnrichedTransaction[]): Set<string> {
  const mints = new Set<string>();
  for (const tx of transactions) {
    tx.tokenTransfers?.forEach((t) => mints.add(t.mint));
    if (tx.events?.swap) {
      tx.events.swap.tokenInputs?.forEach((t) => mints.add(t.mint));
      tx.events.swap.tokenOutputs?.forEach((t) => mints.add(t.mint));
    }
  }
  return mints;
}

async function fetchTokenMetadata(
  helius: ReturnType<typeof getHeliusClient>,
  mints: Set<string>
): Promise<Map<string, AssetInfo>> {
  const metadata = new Map<string, AssetInfo>();
  if (mints.size === 0) return metadata;

  // Filter out empty/invalid mint strings before calling the API
  const validMints = [...mints].filter(m => m && m.trim().length > 0);
  if (validMints.length === 0) return metadata;

  try {
    const assets = await helius.getAssetBatch({ ids: validMints });
    for (const asset of assets as AssetInfo[]) {
      if (asset?.id) metadata.set(asset.id, asset);
    }
  } catch {
    // If batch fails (e.g. invalid pubkeys in mint list), return empty metadata
    // rather than crashing the entire tool call
    return metadata;
  }

  // Enrich tokens missing symbol/name (batch response can have incomplete metadata)
  const unknownMints = [...metadata.entries()]
    .filter(([, asset]) => !asset.token_info?.symbol && !asset.content?.metadata?.symbol && !asset.content?.metadata?.name)
    .map(([mint]) => mint);

  if (unknownMints.length > 0 && unknownMints.length <= 10) {
    const enriched = await Promise.allSettled(
      unknownMints.map((mint) => helius.getAsset({ id: mint }))
    );
    for (const result of enriched) {
      if (result.status === 'fulfilled' && result.value) {
        const asset = result.value as AssetInfo;
        if (asset.id) metadata.set(asset.id, asset);
      }
    }
  }

  return metadata;
}

const MAX_RESPONSE_CHARS = 50_000;

function truncateResponse(text: string): string {
  if (text.length <= MAX_RESPONSE_CHARS) return text;
  // Find the last transaction separator before the limit
  const truncated = text.slice(0, MAX_RESPONSE_CHARS);
  const lastSep = truncated.lastIndexOf('\n---\n');
  const cutPoint = lastSep > 0 ? lastSep : MAX_RESPONSE_CHARS;
  return truncated.slice(0, cutPoint) + '\n\n---\n**Response truncated** — reduce `limit`, add time/slot filters, or use `signatures` mode first to identify specific transactions.';
}

function formatSwapSummary(
  swap: NonNullable<EnrichedTransaction['events']>['swap'],
  tokenMetadata: Map<string, AssetInfo>
): string | null {
  if (!swap) return null;
  const parts: string[] = [];

  // Input side
  if (swap.nativeInput && swap.nativeInput.amount > 0) {
    parts.push(formatSol(swap.nativeInput.amount));
  }
  if (swap.tokenInputs) {
    for (const input of swap.tokenInputs) {
      const asset = tokenMetadata.get(input.mint);
      const symbol = asset?.token_info?.symbol || asset?.content?.metadata?.symbol || asset?.content?.metadata?.name || formatAddress(input.mint);
      const amount = Number(input.rawTokenAmount.tokenAmount) / Math.pow(10, input.rawTokenAmount.decimals);
      parts.push(`${amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${symbol}`);
    }
  }

  if (parts.length === 0) return null;
  const inputSide = parts.join(' + ');
  parts.length = 0;

  // Output side
  if (swap.nativeOutput && swap.nativeOutput.amount > 0) {
    parts.push(formatSol(swap.nativeOutput.amount));
  }
  if (swap.tokenOutputs) {
    for (const output of swap.tokenOutputs) {
      const asset = tokenMetadata.get(output.mint);
      const symbol = asset?.token_info?.symbol || asset?.content?.metadata?.symbol || asset?.content?.metadata?.name || formatAddress(output.mint);
      const amount = Number(output.rawTokenAmount.tokenAmount) / Math.pow(10, output.rawTokenAmount.decimals);
      parts.push(`${amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${symbol}`);
    }
  }

  if (parts.length === 0) return null;
  const outputSide = parts.join(' + ');

  return `${inputSide} → ${outputSide}`;
}

export function registerTransactionTools(server: McpServer) {
  // Parse Transactions (Enhanced API)
  server.tool(
    'parseTransactions',
    'BEST FOR: decoding specific transaction(s) by signature into human-readable format. Parse one or more Solana transactions into human-readable format. Returns transaction type (SWAP, TRANSFER, NFT_SALE, etc.), source program (Jupiter, Raydium, Magic Eden, etc.), SOL and token transfers with token names and proper decimal formatting, fees (in both SOL and lamports), timestamp, program IDs involved, and a plain-English description. Use showRaw=true to see all program IDs, instruction accounts, instruction data bytes, inner instructions, and auto-decoded ComputeBudget instructions (CU limit, priority fee, heap frame). Credit cost: 100 credits/call (Enhanced Transactions API). To fetch and parse wallet transaction history, use getTransactionHistory instead.',
    {
      signatures: z.array(z.string()).describe('Array of transaction signatures (base58 encoded). Can be 1 or more.'),
      showRaw: z.boolean().optional().default(false).describe('Include raw instruction data: program IDs, accounts, inner instructions. Useful for debugging or tracing fund flows.')
    },
    async ({ signatures, showRaw }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      const helius = getHeliusClient();

      // Validate signature formats before hitting the API
      const { valid: validSigs, invalid: invalidSigs } = validateSignatures(signatures);

      if (validSigs.length === 0) {
        const lines = ['**Invalid Signature Format**', '', 'None of the provided signatures are valid base58-encoded transaction signatures (expected 86-88 characters).', ''];
        invalidSigs.forEach(sig => lines.push(`- \`${sig}\``));
        return mcpText(lines.join('\n'));
      }

      let transactions: EnrichedTransaction[];
      try {
        transactions = await helius.enhanced.getTransactions({
          transactions: validSigs
        }) as EnrichedTransaction[];
      } catch (err) {
        return handleToolError(err, 'Error fetching transactions', [
          http400Error('Parse Transactions Error'),
        ]);
      }

      // Identify valid signatures that weren't returned (not found on-chain)
      const returnedSigs = new Set((transactions || []).map(tx => tx.signature));
      const notFoundSigs = validSigs.filter(sig => !returnedSigs.has(sig));

      if (!transactions || transactions.length === 0) {
        const lines = ['**No Transactions Found on Mainnet**', ''];
        if (invalidSigs.length > 0) {
          lines.push('**Invalid format** (not valid base58 signatures):');
          invalidSigs.forEach(sig => lines.push(`- \`${sig}\``));
          lines.push('');
        }
        if (notFoundSigs.length > 0) {
          lines.push('**Not found on Solana mainnet** (may be pending, very old, or nonexistent):');
          notFoundSigs.forEach(sig => lines.push(`- \`${sig}\``));
        }
        return mcpText(lines.join('\n'));
      }

      const tokenMetadata = await fetchTokenMetadata(helius, collectMints(transactions));

      const outputLines: string[] = [];

      transactions.forEach((tx, index) => {
        if (index > 0) outputLines.push('', '---', '');

        // Fee in both formats
        const feeDisplay = tx.fee
          ? `${formatSol(tx.fee)} (${tx.fee.toLocaleString()} lamports)`
          : 'N/A';

        outputLines.push(
          `**Transaction: ${tx.signature}**`,
          '',
          `**Type:** ${tx.type || 'UNKNOWN'}`,
          `**Source:** ${tx.source || 'N/A'}`,
          `**Fee:** ${feeDisplay}`,
          `**Fee Payer:** ${tx.feePayer || 'N/A'}`,
          `**Timestamp:** ${tx.timestamp ? formatTimestamp(tx.timestamp) : 'N/A'}`,
          `**Status:** ${tx.transactionError ? '❌ Failed' : '✅ Success'}`,
        );

        // Show error details for failed transactions
        if (tx.transactionError) {
          let errDetail: string;
          const err = tx.transactionError as Record<string, unknown>;
          if (err.InstructionError && Array.isArray(err.InstructionError)) {
            const [idx, reason] = err.InstructionError;
            const reasonStr = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
            errDetail = `Instruction ${idx} failed: ${reasonStr}`;
          } else {
            errDetail = typeof tx.transactionError === 'object'
              ? JSON.stringify(tx.transactionError)
              : String(tx.transactionError);
          }
          outputLines.push(`**Error:** ${errDetail}`);
        }

        if (tx.description) {
          outputLines.push('', `**Description:** ${tx.description}`);
        }

        // Extract unique program IDs from instructions
        if (tx.instructions && tx.instructions.length > 0) {
          const programIds = new Set<string>();
          const collectProgramIds = (instructions: RawInstruction[]) => {
            instructions.forEach(ix => {
              programIds.add(ix.programId);
              if (ix.innerInstructions) collectProgramIds(ix.innerInstructions);
            });
          };
          collectProgramIds(tx.instructions);

          outputLines.push('', '**Programs Involved:**');
          programIds.forEach(pid => {
            outputLines.push(`- ${pid}`);
          });
        }

        // Swap summary from events.swap
        if (tx.events?.swap) {
          const swapSummary = formatSwapSummary(tx.events.swap, tokenMetadata);
          if (swapSummary) {
            outputLines.push('', `**Swap:** ${swapSummary}`);
          }
        }

        if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
          outputLines.push('', '**Token Transfers:**');
          tx.tokenTransfers.forEach((t) => {
            const from = t.fromUserAccount || 'unknown';
            const to = t.toUserAccount || 'unknown';

            const asset = tokenMetadata.get(t.mint);
            const symbol = asset?.token_info?.symbol || asset?.content?.metadata?.symbol;
            const name = asset?.content?.metadata?.name;
            const decimals = asset?.token_info?.decimals ?? t.decimals ?? 0;

            const formattedAmount = t.tokenAmount.toLocaleString(undefined, { maximumFractionDigits: Math.min(decimals || 6, 6) });

            const tokenDisplay = symbol || name || formatAddress(t.mint);

            outputLines.push(`- ${from} → ${to}: ${formattedAmount} ${tokenDisplay}`);
          });
        }

        if (tx.nativeTransfers && tx.nativeTransfers.length > 0) {
          outputLines.push('', '**SOL Transfers:**');
          tx.nativeTransfers.forEach((t) => {
            const from = t.fromUserAccount || 'unknown';
            const to = t.toUserAccount || 'unknown';
            outputLines.push(`- ${from} → ${to}: ${formatSol(t.amount)} (${t.amount.toLocaleString()} lamports)`);
          });
        }

        // Show raw instruction data if requested
        if (showRaw && tx.instructions) {
          outputLines.push('', '**Raw Instructions:**');
          tx.instructions.forEach((ix, i) => {
            outputLines.push(`\n[${i}] Program: ${ix.programId}`);

            // Auto-decode ComputeBudget instructions
            if (ix.programId === COMPUTE_BUDGET_PROGRAM && ix.data) {
              const decoded = decodeComputeBudget(ix.data);
              if (decoded) {
                outputLines.push(`    >> ${decoded}`);
              }
            }

            outputLines.push(`    Accounts (${ix.accounts.length}):`);
            ix.accounts.slice(0, 10).forEach((acc, j) => {
              outputLines.push(`      ${j}: ${acc}`);
            });
            if (ix.accounts.length > 10) {
              outputLines.push(`      ... +${ix.accounts.length - 10} more accounts`);
            }

            // Show instruction data (truncated)
            if (ix.data) {
              const dataDisplay = ix.data.length > 200 ? ix.data.slice(0, 200) + '...' : ix.data;
              outputLines.push(`    Data: ${dataDisplay}`);
            }

            // Expand inner instructions
            if (ix.innerInstructions && ix.innerInstructions.length > 0) {
              outputLines.push(`    Inner Instructions (${ix.innerInstructions.length}):`);
              ix.innerInstructions.slice(0, 5).forEach((inner, j) => {
                outputLines.push(`      [${i}.${j}] Program: ${inner.programId}`);
                if (inner.data) {
                  const innerData = inner.data.length > 100 ? inner.data.slice(0, 100) + '...' : inner.data;
                  outputLines.push(`             Data: ${innerData}`);
                }
                // Decode ComputeBudget in inner instructions too
                if (inner.programId === COMPUTE_BUDGET_PROGRAM && inner.data) {
                  const decoded = decodeComputeBudget(inner.data);
                  if (decoded) outputLines.push(`             >> ${decoded}`);
                }
              });
              if (ix.innerInstructions.length > 5) {
                outputLines.push(`      ... +${ix.innerInstructions.length - 5} more inner instructions`);
              }
            }
          });
        }

        // Account Balance Changes (from Enhanced API accountData)
        if (tx.accountData && tx.accountData.length > 0) {
          const significantChanges = tx.accountData
            .filter(a => a.nativeBalanceChange !== 0)
            .sort((a, b) => Math.abs(b.nativeBalanceChange) - Math.abs(a.nativeBalanceChange))
            .slice(0, 10);

          if (significantChanges.length > 0) {
            outputLines.push('', '**Account Balance Changes:**');
            significantChanges.forEach(a => {
              const change = a.nativeBalanceChange > 0
                ? `+${formatSol(a.nativeBalanceChange)}`
                : formatSol(a.nativeBalanceChange);
              outputLines.push(`- ${formatAddress(a.account)}: ${change}`);
            });
          }
        }
      });

      // Append warnings for any invalid or not-found signatures
      if (invalidSigs.length > 0 || notFoundSigs.length > 0) {
        outputLines.push('', '---', '', '**Warnings:**');
        if (invalidSigs.length > 0) {
          outputLines.push('', '*Invalid signature format:*');
          invalidSigs.forEach(sig => outputLines.push(`- \`${sig}\``));
        }
        if (notFoundSigs.length > 0) {
          outputLines.push('', '*Not found on Solana mainnet (may be pending, very old, or nonexistent):*');
          notFoundSigs.forEach(sig => outputLines.push(`- \`${sig}\``));
        }
      }

      const fullText = outputLines.join('\n');
      return mcpText(truncateResponse(fullText));
    }
  );

  // Get Transaction History (unified: parsed, signatures, or raw mode)
  server.tool(
    'getTransactionHistory',
    'BEST FOR: general-purpose transaction history (default choice for "show transactions"). PREFER getWalletTransfers for sends/receives specifically. PREFER getWalletHistory for balance changes per transaction. Get transaction history for a Solana wallet. Supports three modes: "parsed" (default) returns human-readable decoded data with types, descriptions, actions, and fees. "signatures" returns a lightweight list of transaction signatures with slot/time/status. "raw" returns full raw data with advanced Helius filters (time/slot ranges, status, token accounts). All modes support sortOrder="asc" for finding wallet funding sources — no pagination needed. By default only successful transactions are shown; set status="any" or status="failed" to include failed ones. Credit cost varies by mode: "parsed" ~110 credits/call (signatures fetch + Enhanced API enrichment); "signatures" and "raw" ~10 credits/call.',
    {
      address: z.string().describe('Solana wallet address (base58 encoded)'),
      mode: z.string().optional().default('parsed').describe('"parsed" = decoded human-readable history (default), "signatures" = lightweight signature list, "raw" = full data with advanced Helius filters'),
      limit: z.number().optional().default(10).describe('Number of results (1-1000 for signatures, 1-100 for full/parsed)'),
      sortOrder: z.string().optional().default('desc').describe('"desc" = newest first (default), "asc" = oldest first (great for finding funding sources)'),
      before: z.string().optional().describe('[signatures mode, desc only] Cursor: start searching backwards from this signature'),
      until: z.string().optional().describe('[signatures mode, desc only] Cursor: search until this signature'),
      paginationToken: z.string().optional().describe('Pagination token from previous response for fetching next page'),
      transactionDetails: z.string().optional().default('signatures').describe('[raw mode] "signatures" for basic info (up to 1000), "full" for complete transaction data (up to 100)'),
      status: z.string().optional().default('succeeded').describe('Filter by transaction status. Defaults to "succeeded" — set to "failed" or "any" to include failed transactions.'),
      tokenAccounts: z.string().optional().describe('"none" = only direct transactions, "balanceChanged" = include token transfers, "all" = all token account activity'),
      blockTimeGte: z.number().optional().describe('Filter: block time >= this Unix timestamp'),
      blockTimeLte: z.number().optional().describe('Filter: block time <= this Unix timestamp'),
      slotGte: z.number().optional().describe('Filter: slot >= this value'),
      slotLte: z.number().optional().describe('Filter: slot <= this value')
    },
    async ({ address, mode, limit, sortOrder, before, until, paginationToken, transactionDetails, status, tokenAccounts, blockTimeGte, blockTimeLte, slotGte, slotLte }) => {
      if (!hasApiKey()) return noApiKeyResponse();
      const helius = getHeliusClient();

      let err;
      err = validateEnum(mode, ['parsed', 'signatures', 'raw'], 'Transaction History Error', 'mode');
      if (err) return err;
      err = validateEnum(sortOrder, ['asc', 'desc'], 'Transaction History Error', 'sortOrder');
      if (err) return err;
      err = validateEnum(transactionDetails, ['signatures', 'full'], 'Transaction History Error', 'transactionDetails');
      if (err) return err;
      err = validateEnum(status, ['succeeded', 'failed', 'any'], 'Transaction History Error', 'status');
      if (err) return err;
      if (tokenAccounts) {
        err = validateEnum(tokenAccounts, ['none', 'balanceChanged', 'all'], 'Transaction History Error', 'tokenAccounts');
        if (err) return err;
      }

      // Build filters object (shared across modes that use getTransactionsForAddress)
      type Filters = {
        status?: string;
        tokenAccounts?: string;
        blockTime?: { gte?: number; lte?: number };
        slot?: { gte?: number; lte?: number };
      };

      const filters: Filters = {};
      if (status) filters.status = status;
      if (tokenAccounts) filters.tokenAccounts = tokenAccounts;
      if (blockTimeGte !== undefined || blockTimeLte !== undefined) {
        filters.blockTime = {};
        if (blockTimeGte !== undefined) filters.blockTime.gte = blockTimeGte;
        if (blockTimeLte !== undefined) filters.blockTime.lte = blockTimeLte;
      }
      if (slotGte !== undefined || slotLte !== undefined) {
        filters.slot = {};
        if (slotGte !== undefined) filters.slot.gte = slotGte;
        if (slotLte !== undefined) filters.slot.lte = slotLte;
      }

      const statusNote = status === 'any' ? '' : status === 'failed' ? ', failed only' : ', succeeded only — use status="any" or "failed" to include failed txs';

      // ─── SIGNATURES MODE ───
      if (mode === 'signatures') {
        const hasAdvancedFilters = Object.keys(filters).length > 0 || paginationToken;
        const useQuickPath = sortOrder === 'desc' && !hasAdvancedFilters;

        // Fast path: getSignaturesForAddress — cheap RPC call for latest sigs (desc only, no filters)
        if (useQuickPath) {
          try {
            type QuickSigParams = { limit: number; before?: string; until?: string };
            const rpcParams: QuickSigParams = { limit };
            if (before) rpcParams.before = before;
            if (until) rpcParams.until = until;

            // Kit returns bigint for slot/blockTime fields
            const sigs = await (helius as any).getSignaturesForAddress(address, rpcParams).send();

            if (!sigs || sigs.length === 0) {
              return mcpText(`**Signatures for ${formatAddress(address)}**\n\nNo signatures found.`);
            }

            const lines = [`**Signatures for ${formatAddress(address)}** (${sigs.length} results, newest first${statusNote})`, ''];

            sigs.forEach((sig: any) => {
              const sigStatus = sig.err ? '❌' : '✅';
              const blockTime = sig.blockTime != null ? Number(sig.blockTime) : null;
              const time = blockTime ? new Date(blockTime * 1000).toISOString() : 'N/A';
              lines.push(`${sigStatus} ${sig.signature}`);
              lines.push(`   Slot: ${Number(sig.slot).toLocaleString()} | Time: ${time}`);
              if (sig.memo) {
                lines.push(`   Memo: ${sig.memo}`);
              }
            });

            return mcpText(lines.join('\n'));
          } catch (err) {
            return handleToolError(err, 'Error fetching signatures');
          }
        }

        // Full path: getTransactionsForAddress — needed for asc sort, filters, or paginationToken
        try {
          const result = await fetchTransactionsForAddress(helius, address, {
            transactionDetails: 'signatures',
            sortOrder,
            limit,
            ...(paginationToken && { paginationToken }),
            ...(Object.keys(filters).length > 0 && { filters })
          });

          if (!result || !result.data || result.data.length === 0) {
            return mcpText(`**Signatures for ${formatAddress(address)}**\n\nNo signatures found.`);
          }

          const items = result.data as unknown as SignatureResult[];
          const orderLabel = sortOrder === 'asc' ? 'oldest first' : 'newest first';
          const lines = [`**Signatures for ${formatAddress(address)}** (${items.length} results, ${orderLabel}${statusNote})`, ''];

          items.forEach((item) => {
            const txStatus = item.err ? '❌' : '✅';
            const time = item.blockTime ? new Date(item.blockTime * 1000).toISOString() : 'N/A';
            lines.push(`${txStatus} ${item.signature}`);
            lines.push(`   Slot: ${item.slot.toLocaleString()} | Time: ${time}`);
            if (item.memo) {
              lines.push(`   Memo: ${item.memo}`);
            }
          });

          if (result.paginationToken) {
            lines.push('', `**Next Page Token:** \`${result.paginationToken}\``);
          }

          return mcpText(lines.join('\n'));
        } catch (err) {
          return handleToolError(err, 'Error fetching signatures');
        }
      }

      // ─── RAW MODE ───
      if (mode === 'raw') {
        try {
          const result = await fetchTransactionsForAddress(helius, address, {
            transactionDetails: transactionDetails! as 'signatures' | 'full',
            sortOrder,
            limit,
            ...(paginationToken && { paginationToken }),
            ...(Object.keys(filters).length > 0 && { filters })
          });

          if (!result || !result.data || result.data.length === 0) {
            return mcpText(`**Transactions for ${formatAddress(address)}**\n\nNo transactions found.`);
          }

          const orderLabel = sortOrder === 'asc' ? 'oldest first' : 'newest first';
          const lines = [`**Transactions for ${formatAddress(address)}** (${result.data.length} results, ${orderLabel}${statusNote})`, ''];

          if (transactionDetails === 'signatures') {
            const items = result.data as unknown as SignatureResult[];
            items.forEach((item) => {
              const txStatus = item.err ? '❌' : '✅';
              const time = item.blockTime ? new Date(item.blockTime * 1000).toISOString() : 'N/A';
              lines.push(`${txStatus} ${item.signature}`);
              lines.push(`   Slot: ${item.slot.toLocaleString()} | Index: ${item.transactionIndex} | Time: ${time}`);
              if (item.memo) {
                lines.push(`   Memo: ${item.memo}`);
              }
            });
          } else {
            const items = result.data as unknown as FullResult[];
            items.forEach((item) => {
              const sig = item.transaction.signatures[0];
              const txStatus = item.meta.err ? '❌' : '✅';
              const time = item.blockTime ? new Date(item.blockTime * 1000).toISOString() : 'N/A';
              const fee = formatSol(item.meta.fee);

              lines.push(`${txStatus} ${sig}`);
              lines.push(`   Slot: ${item.slot.toLocaleString()} | Index: ${item.transactionIndex} | Time: ${time}`);
              lines.push(`   Fee: ${fee}`);

              // Show balance changes
              const balanceChanges: string[] = [];
              item.meta.preBalances.forEach((pre, idx) => {
                const post = item.meta.postBalances[idx];
                const change = post - pre;
                if (change !== 0) {
                  const changeStr = change > 0 ? `+${formatSol(change)}` : formatSol(change);
                  balanceChanges.push(changeStr);
                }
              });
              if (balanceChanges.length > 0) {
                lines.push(`   Balance changes: ${balanceChanges.slice(0, 3).join(', ')}${balanceChanges.length > 3 ? '...' : ''}`);
              }
            });
          }

          if (result.paginationToken) {
            lines.push('', `**Next Page Token:** \`${result.paginationToken}\``);
          }

          return mcpText(lines.join('\n'));
        } catch (err) {
          return handleToolError(err, 'Error fetching transactions');
        }
      }

      // ─── PARSED MODE (default) ───
      try {
        // Step 1: Use getTransactionsForAddress to get sorted signatures in one call
        const sigResult = await fetchTransactionsForAddress(helius, address, {
          transactionDetails: 'signatures',
          sortOrder,
          limit: Math.min(limit, 100),
          ...(paginationToken && { paginationToken }),
          ...(Object.keys(filters).length > 0 && { filters })
        });

        if (!sigResult || !sigResult.data || sigResult.data.length === 0) {
          return mcpText(`**Transaction History for ${formatAddress(address)}**\n\nNo transactions found.`);
        }

        type SigItem = { signature: string };
        const sortedSigs = (sigResult.data as unknown as SigItem[]).map(item => item.signature);

        // Step 2: Send sorted signatures to Enhanced API for rich data
        // Batch in chunks of 100 (Enhanced API limit)
        const allTransactions: EnrichedTransaction[] = [];
        for (let i = 0; i < sortedSigs.length; i += 100) {
          const batch = sortedSigs.slice(i, i + 100);
          const enriched = await helius.enhanced.getTransactions({
            transactions: batch
          }) as EnrichedTransaction[];
          if (enriched) allTransactions.push(...enriched);
        }

        if (allTransactions.length === 0) {
          return mcpText(`**Transaction History for ${formatAddress(address)}**\n\nNo transactions could be enriched.`);
        }

        // Re-sort to match original order (Enhanced API may return in different order)
        const sigOrder = new Map(sortedSigs.map((sig, idx) => [sig, idx]));
        allTransactions.sort((a, b) => (sigOrder.get(a.signature) ?? 999) - (sigOrder.get(b.signature) ?? 999));

        const tokenMetadata = await fetchTokenMetadata(helius, collectMints(allTransactions));

        const orderLabel = sortOrder === 'asc' ? 'oldest first' : 'newest first';
        const lines = [`**Transaction History for ${formatAddress(address)}** (${allTransactions.length} transactions, ${orderLabel}${statusNote})`, ''];

        allTransactions.forEach((tx) => {
          const time = tx.timestamp ? formatTimestamp(tx.timestamp) : 'N/A';
          const txStatus = tx.transactionError ? '❌' : '✅';
          const type = tx.type || 'UNKNOWN';
          const source = tx.source || '';

          lines.push(`${txStatus} **${type}**${source ? ` (${source})` : ''} - ${time}`);
          lines.push(`   Sig: \`${tx.signature}\``);

          if (tx.description) {
            lines.push(`   ${tx.description}`);
          }

          // Swap summary
          if (tx.events?.swap) {
            const swapSummary = formatSwapSummary(tx.events.swap, tokenMetadata);
            if (swapSummary) {
              lines.push(`   Swap: ${swapSummary}`);
            }
          }

          // Compact token transfer summary (for non-swap transactions)
          if (!tx.events?.swap && tx.tokenTransfers && tx.tokenTransfers.length > 0) {
            const transferParts = tx.tokenTransfers.slice(0, 3).map((t) => {
              const asset = tokenMetadata.get(t.mint);
              const symbol = asset?.token_info?.symbol || asset?.content?.metadata?.symbol || asset?.content?.metadata?.name || formatAddress(t.mint);
              const decimals = asset?.token_info?.decimals ?? t.decimals ?? 0;
              const amount = t.tokenAmount.toLocaleString(undefined, { maximumFractionDigits: Math.min(decimals || 4, 4) });
              return `${amount} ${symbol}`;
            });
            const moreCount = tx.tokenTransfers.length > 3 ? ` +${tx.tokenTransfers.length - 3} more` : '';
            lines.push(`   Transfers: ${transferParts.join(', ')}${moreCount}`);
          }

          if (tx.fee) {
            lines.push(`   Fee: ${formatSol(tx.fee)}`);
          }

          lines.push('');
        });

        if (sigResult.paginationToken) {
          lines.push(`**Next Page Token:** \`${sigResult.paginationToken}\``);
        }

        const fullText = lines.join('\n');
        return mcpText(truncateResponse(fullText));
      } catch (err) {
        return handleToolError(err, 'Error fetching transaction history');
      }
    }
  );
}
