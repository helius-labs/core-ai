import { z } from 'zod';
import type { ActionRegistry } from '../router/action-registry.js';
import { getNetwork, hasApiKey, sprRequest } from '../utils/helius.js';
import { noApiKeyResponse } from './shared.js';
import { mcpError, mcpText, handleToolError, type ErrorMeta } from '../utils/errors.js';
import { formatTimestamp } from '../utils/formatters.js';
import { contextFromExtra, type RequestContext } from '../utils/request-context.js';

// Solana Privacy Rings indexer reads. The indexer returns ciphertext and proofs;
// deriving view tags, decrypting outputs, and proving happen client-side in
// @heliuslabs/spr, so these handlers only shape what the indexer returns.

const MAX_ITEMS = 1000;
const MAX_OWNERS = 100;
const COST = 'Cost: 10 credits per request.';
const PRIVACY_SDK_NOTE = 'Decrypting outputs and building proofs happen client-side with @heliuslabs/spr; this tool cannot do either.';

const BASE58_32 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

const hash = (what: string) => z.string().regex(BASE58_32, `${what} must be a base58-encoded 32-byte value`);
const pubkey = (what: string) => z.string().regex(BASE58_32, `${what} must be a base58 Solana address`);

// Two indexer versions page history differently, and both are in service
// during the rollout of gTFA-style pagination (helius-labs/zolana#284):
// - current: `paginationToken` ("1:<slot>:<signature>") in and out, results
//   grouped per transaction in `data`.
// - previous: base64 `cursor` in, `nextCursor` out, flat `matches` or
//   `transactions`, and `scannedThrough` on the last page to resume from later.
// Callers see one opaque `paginationToken`; its format says which field it is.
// Slot filters and minContextSlot exist only on the current version, so they
// are left out until every deployment serves it.

const historyParams = {
  limit: z.number().int().min(1).max(MAX_ITEMS).optional().default(100).describe('Most results per page (1-1000, default 100)'),
  paginationToken: z.string().optional().describe('Token from a previous response: the next page, or where to resume once the history is caught up. Keep the other parameters the same.'),
};

const CURRENT_TOKEN = /^\d+:\d+:/;

function historyRequest(p: { limit: number; paginationToken?: string }): Record<string, unknown> {
  if (!p.paginationToken) return { limit: p.limit };
  return CURRENT_TOKEN.test(p.paginationToken)
    ? { limit: p.limit, paginationToken: p.paginationToken }
    : { limit: p.limit, cursor: p.paginationToken };
}

// ─── Indexer response shapes (sdk-libs/indexer-api in helius-labs/zolana) ───

type IndexerContext = { slot: number; blockTime: number };

type OutputSlot = {
  viewTag: string;
  outputContext: { hash: string; treeId: number; leafIndex: number };
  payload: string;
};

type EncryptedUtxoMatch = {
  slot: number;
  txSignature: string;
  outputSlot: OutputSlot;
  txViewingPk: string | null;
  salt: string | null;
};

type ShieldedTransaction = {
  slot: number;
  txSignature: string;
  eventIndex?: number;
  txViewingPk: string | null;
  salt: string | null;
  outputSlots: OutputSlot[];
  messages: Array<{ viewTag: string; payload: string }>;
  nullifiers: string[];
  proofless: boolean;
  ringConfig?: unknown;
  ringProgramId?: string;
};

/** A history page from either indexer version (see the note on historyParams). */
type RawHistoryPage = {
  context: IndexerContext;
  data?: Array<{ slot: number; signature: string; outputs?: EncryptedUtxoMatch[]; events?: ShieldedTransaction[] }>;
  paginationToken?: string | null;
  matches?: EncryptedUtxoMatch[];
  transactions?: ShieldedTransaction[];
  nextCursor?: string | null;
  scannedThrough?: string | null;
};

type TxGroup<T> = { slot: number; signature: string; items: T[] };

type HistoryPage<T> = {
  context: IndexerContext;
  groups: TxGroup<T>[];
  /** Token for the next page; null once the history is caught up. */
  next: string | null;
  /** Token to resume from later, when the indexer gives one on the last page. */
  resume: string | null;
};

function groupBySignature<T extends { slot: number; txSignature: string }>(rows: T[]): TxGroup<T>[] {
  const groups: TxGroup<T>[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last?.signature === row.txSignature) last.items.push(row);
    else groups.push({ slot: row.slot, signature: row.txSignature, items: [row] });
  }
  return groups;
}

/** The previous version marks its last page with scannedThrough. */
function previousVersionTokens(raw: RawHistoryPage): { next: string | null; resume: string | null } {
  return raw.scannedThrough
    ? { next: null, resume: raw.scannedThrough }
    : { next: raw.nextCursor ?? null, resume: null };
}

function utxoPage(raw: RawHistoryPage): HistoryPage<EncryptedUtxoMatch> {
  if (raw.data) {
    const groups = raw.data.map((tx) => ({ slot: tx.slot, signature: tx.signature, items: tx.outputs ?? [] }));
    return { context: raw.context, groups, next: raw.paginationToken ?? null, resume: null };
  }
  return { context: raw.context, groups: groupBySignature(raw.matches ?? []), ...previousVersionTokens(raw) };
}

function shieldedPage(raw: RawHistoryPage): HistoryPage<ShieldedTransaction> {
  if (raw.data) {
    const groups = raw.data.map((tx) => ({ slot: tx.slot, signature: tx.signature, items: tx.events ?? [] }));
    return { context: raw.context, groups, next: raw.paginationToken ?? null, resume: null };
  }
  return { context: raw.context, groups: groupBySignature(raw.transactions ?? []), ...previousVersionTokens(raw) };
}

type MerkleProof = {
  leaf: string;
  merkleContext: { tree: string };
  path: string[];
  leafIndex: number;
  root: string;
  rootSeq: number;
  rootIndex: number;
};

type NonInclusionProof = {
  leaf: string;
  merkleContext: { tree: string };
  path: string[];
  lowElement: string;
  lowElementIndex: number;
  highElement: string;
  highElementIndex: number;
  root: string;
  rootSeq: number;
  rootIndex: number;
};

type UserRecord = {
  owner: string;
  nullifierPubkey: string;
  viewingPubkey: string;
  mergeEncryption: number;
};

// ─── Formatting ───

function networkLabel(ctx: RequestContext | null): string {
  return getNetwork(ctx) === 'devnet' ? 'devnet' : 'mainnet';
}

function header(title: string, ctx: RequestContext | null, context: IndexerContext): string[] {
  return [
    `**${title}** (${networkLabel(ctx)})`,
    '',
    `Indexed through slot ${context.slot.toLocaleString()} (${formatTimestamp(context.blockTime)})`,
  ];
}

/** Next-page or resume guidance for a history page. */
function pageFooter(page: HistoryPage<unknown>): string[] {
  if (page.next) return ['', `**Next Page Token:** \`${page.next}\``];
  if (page.resume) return ['', `End of indexed history. To pick up newer activity later, call again with paginationToken \`${page.resume}\`.`];
  return ['', 'End of indexed history.'];
}

function noMatches(page: HistoryPage<unknown>, none: string): string {
  return page.next ? 'No matches in this page. The history continues; call again with the token below.' : none;
}

function outputLine(output: OutputSlot): string {
  const { hash: outputHash, treeId, leafIndex } = output.outputContext;
  return `UTXO \`${outputHash}\` | tree ${treeId}, leaf ${leafIndex} | view tag \`${output.viewTag}\``;
}

function eventLines(event: ShieldedTransaction, indent: string): string[] {
  const lines: string[] = [];
  const ring = event.ringProgramId
    ? ` | ring \`${event.ringProgramId}\``
    : event.ringConfig ? ' | ring-authorized' : '';
  const label = event.eventIndex !== undefined ? `Event ${event.eventIndex}` : 'Event';
  lines.push(`${indent}${label}: ${event.outputSlots.length} output(s), ${event.messages.length} message(s), ${event.nullifiers.length} nullifier(s)${event.proofless ? ' | proofless' : ''}${ring}`);
  for (const output of event.outputSlots) lines.push(`${indent}  - ${outputLine(output)}`);
  for (const nullifier of event.nullifiers) lines.push(`${indent}  - Nullifier \`${nullifier}\``);
  return lines;
}

function eventCiphertexts(event: ShieldedTransaction): string[] {
  const lines = [`- \`${event.txSignature}\`${event.eventIndex !== undefined ? ` event ${event.eventIndex}` : ''}: txViewingPk \`${event.txViewingPk ?? 'none'}\` | salt \`${event.salt ?? 'none'}\``];
  for (const output of event.outputSlots) lines.push(`  - UTXO \`${output.outputContext.hash}\`: \`${output.payload}\``);
  for (const message of event.messages) lines.push(`  - Message (view tag \`${message.viewTag}\`): \`${message.payload}\``);
  return lines;
}

const CIPHERTEXT_HEADING = '**Ciphertexts** (base64; the recipient decrypts them with their viewing key)';

function shieldedHistoryText(title: string, ctx: RequestContext | null, page: HistoryPage<ShieldedTransaction>): string {
  const lines = header(title, ctx, page.context);
  const events = page.groups.flatMap((tx) => tx.items);
  if (page.groups.length === 0) {
    lines.push('', noMatches(page, 'No matching shielded transactions.'), ...pageFooter(page));
    return lines.join('\n');
  }

  lines.push(`Matches: ${events.length} event(s) in ${page.groups.length} transaction(s), oldest first`, '');
  page.groups.forEach((tx, i) => {
    lines.push(`${i + 1}. Slot ${tx.slot.toLocaleString()} | Sig: \`${tx.signature}\``);
    for (const event of tx.items) lines.push(...eventLines(event, '   '));
  });
  lines.push(...pageFooter(page));
  lines.push('', CIPHERTEXT_HEADING, ...events.flatMap(eventCiphertexts));
  return lines.join('\n');
}

// ─── Errors ───

/** The router drops the meta block before the model sees it, so the recovery is repeated in the text. */
function privacyError(title: string, summary: string, meta: ErrorMeta) {
  return mcpError(`**${title}**\n\n${summary}\n\n${meta.recovery}`, meta);
}

function rpcDetail(msg: string): string {
  return msg.replace(/^RPC error -?\d+:\s*/, '');
}

/**
 * The indexer reports bad params as -32602 and rejected requests (validation,
 * unknown tree, missing leaf, a nullifier already spent) as -32600.
 */
function indexerErrors(title: string) {
  return [
    {
      match: (msg: string) => /RPC error -32600\b/.test(msg) && /stale|catches up/i.test(msg),
      respond: (msg: string) => privacyError(title, rpcDetail(msg), {
        type: 'API',
        code: 'STALE_ROOT',
        retryable: true,
        recovery: 'Retry once the indexer catches up, usually within a few seconds.',
      }),
    },
    {
      match: (msg: string) => /RPC error -32600\b/.test(msg) && /already used or queued/i.test(msg),
      respond: (msg: string) => privacyError(title, `A nullifier is already spent or queued to be: ${rpcDetail(msg)}`, {
        type: 'VALIDATION',
        code: 'NULLIFIER_SPENT',
        retryable: false,
        recovery: 'The UTXO behind that nullifier is spent; drop it from the spend. getShieldedTransactionsByNullifiers shows the spending transaction once it lands.',
      }),
    },
    {
      match: (msg: string) => /RPC error -3260[02]\b/.test(msg),
      respond: (msg: string) => privacyError(title, `The indexer rejected the request: ${rpcDetail(msg)}`, {
        type: 'VALIDATION',
        code: 'INDEXER_REJECTED',
        retryable: false,
        recovery: 'Fix the parameters named in the message. Tags, nullifiers, and leaves are base58 32-byte values, at most 1,000 per request.',
      }),
    },
  ];
}

async function callIndexer<T>(method: string, params: Record<string, unknown>, ctx: RequestContext | null, title: string): Promise<{ ok: true; result: T } | { ok: false; response: ReturnType<typeof mcpError> }> {
  try {
    return { ok: true, result: await sprRequest<T>(method, params, ctx) };
  } catch (err) {
    return { ok: false, response: handleToolError(err, `${title} Error`, indexerErrors(`${title} Error`)) };
  }
}

function continuationFor(page: HistoryPage<unknown>) {
  return page.next
    ? { continuation: { kind: 'paginationToken' as const, api: 'raw' as const, token: page.next } }
    : undefined;
}

// ─── Actions ───

export function registerPrivacyTools(registry: ActionRegistry) {
  registry.registerAction(
    'getEncryptedUtxosByTags',
    `BEST FOR: discovering a wallet's Solana Privacy Rings UTXOs. Returns the encrypted outputs whose view tag matches, oldest first, for the wallet to decrypt with its viewing key. Results include UTXOs that are already spent; check spends with getShieldedTransactionsByNullifiers. PREFER getShieldedTransactionsByTags for whole transactions (messages and nullifiers too). In the default ring, an owner's view tag is their wallet address. ${PRIVACY_SDK_NOTE} ${COST}`,
    {
      tags: z.array(hash('Each view tag')).max(MAX_ITEMS).optional().describe('View tags to match, base58, up to 1,000. In the default ring, a wallet address is its own view tag. Leave empty only with ringProgramId to read that ring\'s full history.'),
      ringProgramId: pubkey('ringProgramId').optional().describe('Only outputs of this ring program. With no tags, returns every output of the ring.'),
      ...historyParams,
    },
    async ({ tags, ringProgramId, ...history }, extra) => {
      const ctx = contextFromExtra(extra);
      if (!hasApiKey(ctx)) return noApiKeyResponse();
      const title = 'Encrypted UTXOs by View Tag';

      if (!tags?.length && !ringProgramId) {
        return privacyError(`${title} Error`, 'Pass `tags`, or `ringProgramId` to read a ring\'s full history.', {
          type: 'VALIDATION',
          code: 'MISSING_TAGS',
          retryable: false,
          recovery: 'Pass view tags (in the default ring, a wallet address is its own view tag).',
        });
      }

      const call = await callIndexer<RawHistoryPage>(
        'getEncryptedUtxosByTags',
        { tags: tags ?? [], ...(ringProgramId ? { ringProgramId } : {}), ...historyRequest(history) },
        ctx,
        title,
      );
      if (!call.ok) return call.response;
      const page = utxoPage(call.result);

      const lines = header(title, ctx, page.context);
      const outputs = page.groups.flatMap((tx) => tx.items);
      if (page.groups.length === 0) {
        lines.push('', noMatches(page, 'No encrypted UTXOs match these tags.'), ...pageFooter(page));
        return mcpText(lines.join('\n'), continuationFor(page));
      }

      lines.push(`Matches: ${outputs.length} output(s) in ${page.groups.length} transaction(s), oldest first`, '');
      page.groups.forEach((tx, i) => {
        lines.push(`${i + 1}. Slot ${tx.slot.toLocaleString()} | Sig: \`${tx.signature}\``);
        for (const match of tx.items) lines.push(`   - ${outputLine(match.outputSlot)}`);
      });
      lines.push(...pageFooter(page));
      lines.push('', CIPHERTEXT_HEADING);
      for (const match of outputs) {
        lines.push(`- UTXO \`${match.outputSlot.outputContext.hash}\`: \`${match.outputSlot.payload}\` | txViewingPk \`${match.txViewingPk ?? 'none'}\` | salt \`${match.salt ?? 'none'}\``);
      }
      return mcpText(lines.join('\n'), continuationFor(page));
    },
  );

  registry.registerAction(
    'getShieldedTransactionsByTags',
    `BEST FOR: syncing a wallet's Solana Privacy Rings history. Returns the shielded transactions with an output or message whose view tag matches, oldest first, with every event's encrypted outputs, messages, and nullifiers. PREFER getEncryptedUtxosByTags when only the outputs are needed, getShieldedTransactionsBySignature for one known transaction. ${PRIVACY_SDK_NOTE} ${COST}`,
    {
      tags: z.array(hash('Each view tag')).max(MAX_ITEMS).optional().describe('View tags to match against outputs and messages, base58, up to 1,000. Leave empty only with ringProgramId to read that ring\'s full history.'),
      ringProgramId: pubkey('ringProgramId').optional().describe('Only events of this ring program. With no tags, returns every event of the ring.'),
      ...historyParams,
    },
    async ({ tags, ringProgramId, ...history }, extra) => {
      const ctx = contextFromExtra(extra);
      if (!hasApiKey(ctx)) return noApiKeyResponse();
      const title = 'Shielded Transactions by View Tag';

      if (!tags?.length && !ringProgramId) {
        return privacyError(`${title} Error`, 'Pass `tags`, or `ringProgramId` to read a ring\'s full history.', {
          type: 'VALIDATION',
          code: 'MISSING_TAGS',
          retryable: false,
          recovery: 'Pass view tags (in the default ring, a wallet address is its own view tag).',
        });
      }

      const call = await callIndexer<RawHistoryPage>(
        'getShieldedTransactionsByTags',
        { tags: tags ?? [], ...(ringProgramId ? { ringProgramId } : {}), ...historyRequest(history) },
        ctx,
        title,
      );
      if (!call.ok) return call.response;
      const page = shieldedPage(call.result);
      return mcpText(shieldedHistoryText(title, ctx, page), continuationFor(page));
    },
  );

  registry.registerAction(
    'getShieldedTransactionsByNullifiers',
    `BEST FOR: finding which Solana Privacy Rings UTXOs are spent. Returns the shielded transactions that consumed any of the given nullifiers, oldest first; a nullifier with no match is unspent. ${PRIVACY_SDK_NOTE} ${COST}`,
    {
      nullifiers: z.array(hash('Each nullifier')).min(1).max(MAX_ITEMS).describe('Nullifiers to look up, base58, 1 to 1,000. A wallet derives each from its UTXO and nullifier secret.'),
      ...historyParams,
    },
    async ({ nullifiers, ...history }, extra) => {
      const ctx = contextFromExtra(extra);
      if (!hasApiKey(ctx)) return noApiKeyResponse();
      const title = 'Shielded Transactions by Nullifier';

      const call = await callIndexer<RawHistoryPage>(
        'getShieldedTransactionsByNullifiers',
        { nullifiers, ...historyRequest(history) },
        ctx,
        title,
      );
      if (!call.ok) return call.response;
      const page = shieldedPage(call.result);
      return mcpText(shieldedHistoryText(title, ctx, page), continuationFor(page));
    },
  );

  registry.registerAction(
    'getShieldedTransactionsBySignature',
    `BEST FOR: inspecting or confirming the Solana Privacy Rings effects of one Solana transaction: its shielded events, encrypted outputs, messages, and nullifiers. A transaction with no shielded events, or not indexed yet, returns none rather than an error. PREFER heliusTransaction.parseTransactions for the transaction's ordinary instructions. ${COST}`,
    {
      signature: z.string().regex(BASE58_SIGNATURE, 'signature must be a base58 transaction signature').describe('Solana transaction signature (base58)'),
    },
    async ({ signature }, extra) => {
      const ctx = contextFromExtra(extra);
      if (!hasApiKey(ctx)) return noApiKeyResponse();
      const title = 'Shielded Transaction';

      const call = await callIndexer<{ context: IndexerContext; transactions: Array<{ eventIndex: number; transaction: ShieldedTransaction }> }>(
        'getShieldedTransactionsBySignature',
        { txSignature: signature },
        ctx,
        title,
      );
      if (!call.ok) return call.response;
      const { context, transactions } = call.result;

      const lines = header(title, ctx, context);
      lines.push(`Sig: \`${signature}\``);
      if (transactions.length === 0) {
        lines.push('', `No shielded events. Either the transaction has none, or it lands after slot ${context.slot.toLocaleString()} and is not indexed yet.`);
        return mcpText(lines.join('\n'));
      }

      const events = transactions.map((t) => ({ ...t.transaction, eventIndex: t.eventIndex }));
      lines.push(`Slot ${events[0].slot.toLocaleString()} | ${events.length} shielded event(s)`, '');
      for (const event of events) lines.push(...eventLines(event, ''));
      lines.push('', CIPHERTEXT_HEADING, ...events.flatMap(eventCiphertexts));
      return mcpText(lines.join('\n'));
    },
  );

  registry.registerAction(
    'getMerkleProofs',
    `BEST FOR: fetching the inclusion proofs a Solana Privacy Rings spend needs: a Merkle path from each UTXO hash to the current root of the UTXO tree, with the root index the instruction expects. Fails if any UTXO is not in the tree. ${PRIVACY_SDK_NOTE} ${COST}`,
    {
      treeAccount: pubkey('treeAccount').describe('The Rings tree account (PDA) holding the UTXO tree'),
      leaves: z.array(hash('Each leaf')).min(1).max(MAX_ITEMS).describe('UTXO hashes to prove, base58, 1 to 1,000'),
    },
    async ({ treeAccount, leaves }, extra) => {
      const ctx = contextFromExtra(extra);
      if (!hasApiKey(ctx)) return noApiKeyResponse();
      const title = 'UTXO Merkle Proofs';

      const call = await callIndexer<{ context: IndexerContext; proofs: MerkleProof[] }>('getMerkleProofs', { treeAccount, leaves }, ctx, title);
      if (!call.ok) return call.response;
      const { context, proofs } = call.result;

      const lines = header(title, ctx, context);
      lines.push(`Tree: \`${treeAccount}\` | ${proofs.length} proof(s)`, '');
      proofs.forEach((p, i) => {
        lines.push(`${i + 1}. Leaf \`${p.leaf}\` at index ${p.leafIndex}`);
        lines.push(`   Root \`${p.root}\` | rootIndex ${p.rootIndex} | rootSeq ${p.rootSeq} | path length ${p.path.length}`);
      });
      lines.push('', '**Paths** (sibling hashes from leaf to root)');
      proofs.forEach((p, i) => lines.push(`${i + 1}. ${p.path.map((h) => `\`${h}\``).join(', ')}`));
      return mcpText(lines.join('\n'));
    },
  );

  registry.registerAction(
    'getNonInclusionProofs',
    `BEST FOR: fetching the proofs a Solana Privacy Rings spend needs that its nullifiers are not yet in the nullifier tree: for each, the neighbouring low and high elements, their Merkle path, and the root index the instruction expects. Fails if any nullifier is already used or queued, which means that UTXO is spent. ${PRIVACY_SDK_NOTE} ${COST}`,
    {
      treeAccount: pubkey('treeAccount').describe('The Rings tree account (PDA) holding the nullifier tree'),
      leaves: z.array(hash('Each leaf')).min(1).max(MAX_ITEMS).describe('Nullifiers to prove absent, base58, 1 to 1,000'),
    },
    async ({ treeAccount, leaves }, extra) => {
      const ctx = contextFromExtra(extra);
      if (!hasApiKey(ctx)) return noApiKeyResponse();
      const title = 'Nullifier Non-Inclusion Proofs';

      const call = await callIndexer<{ context: IndexerContext; proofs: NonInclusionProof[] }>('getNonInclusionProofs', { treeAccount, leaves }, ctx, title);
      if (!call.ok) return call.response;
      const { context, proofs } = call.result;

      const lines = header(title, ctx, context);
      lines.push(`Tree: \`${treeAccount}\` | ${proofs.length} proof(s); none of these nullifiers is spent`, '');
      proofs.forEach((p, i) => {
        lines.push(`${i + 1}. Nullifier \`${p.leaf}\``);
        lines.push(`   Between low \`${p.lowElement}\` (index ${p.lowElementIndex}) and high \`${p.highElement}\` (index ${p.highElementIndex})`);
        lines.push(`   Root \`${p.root}\` | rootIndex ${p.rootIndex} | rootSeq ${p.rootSeq} | path length ${p.path.length}`);
      });
      lines.push('', '**Paths** (sibling hashes from the low element to the root)');
      proofs.forEach((p, i) => lines.push(`${i + 1}. ${p.path.map((h) => `\`${h}\``).join(', ')}`));
      return mcpText(lines.join('\n'));
    },
  );

  registry.registerAction(
    'getUserRecords',
    `BEST FOR: checking whether wallets are registered for Solana Privacy Rings, and reading the public keys a sender needs to encrypt a private transfer to them. Unregistered wallets come back as not registered rather than as an error. ${COST}`,
    {
      owners: z.array(pubkey('Each owner')).min(1).max(MAX_OWNERS).describe('Wallet addresses to look up, 1 to 100'),
    },
    async ({ owners }, extra) => {
      const ctx = contextFromExtra(extra);
      if (!hasApiKey(ctx)) return noApiKeyResponse();
      const title = 'Privacy User Records';

      const call = await callIndexer<{ context: IndexerContext; records: Array<UserRecord | null> }>('getUserRecords', { owners }, ctx, title);
      if (!call.ok) return call.response;
      const { context, records } = call.result;

      const registered = records.filter((r) => r !== null).length;
      const lines = header(title, ctx, context);
      lines.push(`${registered} of ${owners.length} wallet(s) registered`, '');
      owners.forEach((owner, i) => {
        const record = records[i];
        if (!record) {
          lines.push(`- \`${owner}\`: not registered`);
          return;
        }
        const merge = record.mergeEncryption === 0
          ? 'disabled'
          : record.mergeEncryption === 1
            ? 'PoseidonCtrV1 (anyone can merge this owner\'s UTXOs)'
            : `unknown mode ${record.mergeEncryption}`;
        lines.push(`- \`${owner}\`: registered`);
        lines.push(`  Nullifier pubkey \`${record.nullifierPubkey}\` | viewing pubkey \`${record.viewingPubkey}\` (base64) | merge encryption: ${merge}`);
      });
      return mcpText(lines.join('\n'));
    },
  );
}
