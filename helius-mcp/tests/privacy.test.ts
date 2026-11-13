import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { callActionHandler } from '../src/router/action-handlers.js';
import { dispatchRoutedTool } from '../src/router/dispatch.js';
import { getSurfaceActions } from '../src/router/surface.js';
import { createServer } from '../src/server.js';
import { setApiKey, setNetwork } from '../src/utils/helius.js';

// Indexer calls are answered from a queue; anything else (telemetry) gets an empty 200.
const indexerResponses: Response[] = [];
const fetchMock = vi.fn(async (url: unknown) =>
  String(url).includes('helius-rpc.com') ? indexerResponses.shift()! : new Response('{}'));
vi.stubGlobal('fetch', fetchMock);

// Real responses recorded from the indexer while it served the previous
// history API (nextCursor / scannedThrough).
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/privacy/indexer-responses.json', import.meta.url), 'utf8'));
const { bySignature, encryptedUtxosPreviousVersion, byNullifiersPreviousVersion } = fixtures;
const event = bySignature.result.transactions[0].transaction;
const TAG: string = event.outputSlots[0].viewTag;
const TREE = '777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor';
const OWNER = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';

function respond(result: unknown) {
  indexerResponses.push(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result })));
}

function respondError(code: number, message: string) {
  indexerResponses.push(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code, message } })));
}

function indexerCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes('helius-rpc.com')) as unknown as Array<[string, RequestInit]>;
}

/** The latest indexer request. */
function request(): { url: string; body: Record<string, any> } {
  const [url, init] = indexerCalls().at(-1)!;
  return { url: String(url), body: JSON.parse(String(init.body)) };
}

async function call(params: Record<string, unknown>) {
  const result = await dispatchRoutedTool('heliusPrivacy', { detail: 'full', ...params }, {});
  return { text: result.content.map((c) => c.text).join('\n'), isError: result.isError };
}

beforeEach(() => {
  fetchMock.mockClear();
  indexerResponses.length = 0;
  setApiKey('test-key');
  setNetwork('mainnet-beta');
});

afterAll(() => {
  setApiKey('');
  vi.unstubAllGlobals();
});

describe('heliusPrivacy requests', () => {
  it('posts each method to /v1/spr/<method> on the session network with named params', async () => {
    respond({ context: { slot: 1, blockTime: 1 }, records: [null] });
    await call({ action: 'getUserRecords', owners: [OWNER] });
    expect(request().url).toBe('https://mainnet.helius-rpc.com/v1/spr/getUserRecords?api-key=test-key');
    expect(request().body).toMatchObject({ jsonrpc: '2.0', method: 'getUserRecords', params: { owners: [OWNER] } });

    setNetwork('devnet');
    respond({ context: { slot: 1, blockTime: 1 }, transactions: [] });
    await call({ action: 'getShieldedTransactionsBySignature', signature: bySignature.signature });
    expect(request().url).toBe('https://devnet.helius-rpc.com/v1/spr/getShieldedTransactionsBySignature?api-key=test-key');
    expect(request().body.params).toEqual({ txSignature: bySignature.signature });
  });

  it('rejects a call without tags or a ring before reaching the indexer', async () => {
    const { text, isError } = await call({ action: 'getEncryptedUtxosByTags' });
    expect(isError).toBe(true);
    expect(text).toContain('Pass `tags`, or `ringProgramId`');
    expect(indexerCalls()).toHaveLength(0);
  });

  it('rejects a malformed view tag before reaching the indexer', async () => {
    const { text, isError } = await call({ action: 'getEncryptedUtxosByTags', tags: ['not-a-tag'] });
    expect(isError).toBe(true);
    expect(text).toContain('base58');
    expect(indexerCalls()).toHaveLength(0);
  });
});

describe('heliusPrivacy history pages', () => {
  it('reads the previous API: groups flat matches by transaction and pages with its cursor', async () => {
    respond(encryptedUtxosPreviousVersion);
    const { text } = await call({ action: 'getEncryptedUtxosByTags', tags: [TAG], limit: 1 });

    const match = encryptedUtxosPreviousVersion.matches[0];
    expect(request().body.params).toEqual({ tags: [TAG], limit: 1 });
    expect(text).toContain(`Sig: \`${match.txSignature}\``);
    expect(text).toContain(`UTXO \`${match.outputSlot.outputContext.hash}\` | tree 0, leaf ${match.outputSlot.outputContext.leafIndex}`);
    expect(text).toContain(`**Next Page Token:** \`${encryptedUtxosPreviousVersion.nextCursor}\``);
    expect(text).toContain(match.outputSlot.payload);

    respond({ ...encryptedUtxosPreviousVersion, matches: [], nextCursor: null });
    await call({ action: 'getEncryptedUtxosByTags', tags: [TAG], limit: 1, paginationToken: encryptedUtxosPreviousVersion.nextCursor });
    expect(request().body.params).toEqual({ tags: [TAG], limit: 1, cursor: encryptedUtxosPreviousVersion.nextCursor });
  });

  it('treats a previous-API page with scannedThrough as the end, and offers it to resume from', async () => {
    respond(byNullifiersPreviousVersion);
    const nullifier = byNullifiersPreviousVersion.transactions[0].nullifiers[0];
    const { text } = await call({ action: 'getShieldedTransactionsByNullifiers', nullifiers: [nullifier] });

    expect(text).toContain('1 event(s) in 1 transaction(s)');
    expect(text).toContain(`Nullifier \`${nullifier}\``);
    expect(text).not.toContain('Next Page Token');
    expect(text).toContain(`call again with paginationToken \`${byNullifiersPreviousVersion.scannedThrough}\``);
  });

  it('reads the current API: per-transaction data and paginationToken', async () => {
    const token = `1:${event.slot}:${event.txSignature}`;
    respond({
      context: bySignature.result.context,
      outputTreeId: 0,
      data: [{ slot: event.slot, signature: event.txSignature, events: [event] }],
      paginationToken: token,
    });
    const { text } = await call({ action: 'getShieldedTransactionsByTags', tags: [TAG], limit: 1 });
    expect(text).toContain('1 event(s) in 1 transaction(s)');
    expect(text).toContain('| proofless');
    expect(text).toContain(`**Next Page Token:** \`${token}\``);

    respond({ context: bySignature.result.context, data: [], paginationToken: null });
    const end = await call({ action: 'getShieldedTransactionsByTags', tags: [TAG], limit: 1, paginationToken: token });
    expect(request().body.params).toEqual({ tags: [TAG], limit: 1, paginationToken: token });
    expect(end.text).toContain('No matching shielded transactions.');
    expect(end.text).toContain('End of indexed history.');
  });
});

describe('heliusPrivacy single reads', () => {
  it('shows a transaction\'s shielded events, or says when it has none', async () => {
    respond(bySignature.result);
    const { text } = await call({ action: 'getShieldedTransactionsBySignature', signature: bySignature.signature });
    expect(text).toContain('1 shielded event(s)');
    expect(text).toContain(`UTXO \`${event.outputSlots[0].outputContext.hash}\``);
    expect(text).toContain('txViewingPk `none`');

    respond({ context: bySignature.result.context, outputTreeId: 0, transactions: [] });
    const empty = await call({ action: 'getShieldedTransactionsBySignature', signature: bySignature.signature });
    expect(empty.text).toContain('No shielded events.');
  });

  it('labels registered and unregistered wallets', async () => {
    const other = '3zNWpeRBZY7c5eS5fYboheQP5juPqD525qixxbjiVhEQ';
    respond({
      context: { slot: 1, blockTime: 1 },
      records: [null, { owner: other, nullifierPubkey: TAG, viewingPubkey: 'BO/uWcETmVpKH5weKPgzWtjFMdje30MZ+tgL5sD61V1i', mergeEncryption: 1 }],
    });
    const { text } = await call({ action: 'getUserRecords', owners: [OWNER, other] });
    expect(text).toContain('1 of 2 wallet(s) registered');
    expect(text).toContain(`\`${OWNER}\`: not registered`);
    expect(text).toContain('merge encryption: PoseidonCtrV1 (anyone can merge this owner\'s UTXOs)');
  });

  it('shows a proof\'s root index and path', async () => {
    respond({
      context: { slot: 1, blockTime: 1 },
      proofs: [{ leaf: TAG, merkleContext: { treeType: 1, tree: TREE }, path: [TREE, OWNER], leafIndex: 1817, root: OWNER, rootSeq: 465890330, rootIndex: 151 }],
    });
    const { text } = await call({ action: 'getMerkleProofs', treeAccount: TREE, leaves: [TAG] });
    expect(request().body.params).toEqual({ treeAccount: TREE, leaves: [TAG] });
    expect(text).toContain('rootIndex 151 | rootSeq 465890330 | path length 2');
    expect(text).toContain(`1. \`${TREE}\`, \`${OWNER}\``);
  });

  it.each(['getMerkleProofs', 'getNonInclusionProofs'])('refuses more than 64 leaves to %s before reaching the indexer', async (action) => {
    const { isError } = await call({ action, treeAccount: TREE, leaves: Array(65).fill(TAG) });
    expect(isError).toBe(true);
    expect(indexerCalls()).toHaveLength(0);
  });
});

describe('heliusPrivacy errors', () => {
  it.each([
    [-32600, `Validation Error: Nullifier leaf ${TAG} is already used or queued for tree ${TREE}`, 'NULLIFIER_SPENT', false],
    [-32600, 'StaleRoot: retry once the indexer catches up', 'STALE_ROOT', true],
    [-32602, 'Invalid params', 'INDEXER_REJECTED', false],
  ])('maps %i "%s" to %s', async (code, message, expected, retryable) => {
    respondError(code, message);
    const result = await callActionHandler('getNonInclusionProofs', { treeAccount: TREE, leaves: [TAG] }, {});
    const text = result.content?.[0]?.text ?? '';
    expect(result.isError).toBe(true);
    expect(text).toContain(`"code":"${expected}"`);
    expect(text).toContain(`"retryable":${retryable}`);
    expect(text).toContain(message);
  });

  it('keeps the recovery advice in the text the router passes on', async () => {
    respondError(-32600, `Validation Error: Nullifier leaf ${TAG} is already used or queued for tree ${TREE}`);
    const { text, isError } = await call({ action: 'getNonInclusionProofs', treeAccount: TREE, leaves: [TAG] });
    expect(isError).toBe(true);
    expect(text).not.toContain('"code"');
    expect(text).toContain('The UTXO behind that nullifier is spent');
  });
});

describe('heliusPrivacy on the read-only surface', () => {
  it('keeps every action, and leaves the operator-only queue method out', () => {
    expect(getSurfaceActions('heliusPrivacy', 'readOnly')).toEqual([
      'getEncryptedUtxosByTags',
      'getShieldedTransactionsByTags',
      'getShieldedTransactionsByNullifiers',
      'getShieldedTransactionsBySignature',
      'getMerkleProofs',
      'getNonInclusionProofs',
      'getUserRecords',
    ]);
  });

  it('continues a history read through expandResult with the indexer\'s cursor', async () => {
    const server = createServer({ surface: 'readOnly' });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'privacy-test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const telemetry = { _feedback: 'test', _feedbackTool: 'heliusPrivacy.getEncryptedUtxosByTags', _model: 'test' };

    respond(encryptedUtxosPreviousVersion);
    const first = await client.callTool({
      name: 'heliusPrivacy',
      arguments: { action: 'getEncryptedUtxosByTags', detail: 'summary', tags: [TAG], limit: 1, ...telemetry },
    });
    const text = (first.content as Array<{ text: string }>).map((c) => c.text).join('\n');
    const resultId = text.match(/resultId:\s+(\S+)/)?.[1];
    expect(resultId, text).toBeTruthy();

    respond({ ...encryptedUtxosPreviousVersion, matches: [], nextCursor: null });
    await client.callTool({ name: 'expandResult', arguments: { resultId, continuation: 'next', ...telemetry, _feedbackTool: 'expandResult' } });
    expect(request().body.params).toEqual({ tags: [TAG], limit: 1, cursor: encryptedUtxosPreviousVersion.nextCursor });
  });
});
