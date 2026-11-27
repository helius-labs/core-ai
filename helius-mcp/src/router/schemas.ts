import { z } from 'zod';
import {
  HELIUS_ACCOUNT_ACTIONS,
  HELIUS_ASSET_ACTIONS,
  HELIUS_CHAIN_ACTIONS,
  HELIUS_COMPRESSION_ACTIONS,
  HELIUS_KNOWLEDGE_ACTIONS,
  HELIUS_LANA_ACTIONS,
  HELIUS_PRIVACY_ACTIONS,
  HELIUS_STREAMING_ACTIONS,
  HELIUS_TRANSACTION_ACTIONS,
  HELIUS_WALLET_ACTIONS,
  HELIUS_WRITE_ACTIONS,
  type ActionName,
} from './actions.js';
import { ACTION_GROUPS, type PublicToolName } from './action-groups.js';
import { getActionHandlers } from './action-handlers.js';
import { ACTION_CATALOG } from './catalog.js';
import { refineSchemaFields } from './descriptions.js';
import { getStrippedParams, getSurfaceActions, type Surface } from './surface.js';
import { TELEMETRY_FIELDS, withTelemetry } from './telemetry.js';
import { LANA_MODELS } from '../tools/lana.js';

const detailField = z.enum(['summary', 'standard', 'full']).optional();
const argsField = z.union([
  z.looseObject({}),
  z.string().transform((s, ctx) => {
    try { return JSON.parse(s); } catch {
      ctx.addIssue({ code: 'custom', message: 'args must be a JSON object string' });
      return z.NEVER;
    }
  }).pipe(z.looseObject({})),
]).optional();

const stringArray = () => z.array(z.string()).optional();
const optionalString = () => z.string().optional();
const optionalNumber = () => z.coerce.number().optional();
const optionalBoolean = () => z.boolean().optional();

export const HeliusAccountActionSchema = z.enum(HELIUS_ACCOUNT_ACTIONS);
export const HeliusWalletActionSchema = z.enum(HELIUS_WALLET_ACTIONS);
export const HeliusAssetActionSchema = z.enum(HELIUS_ASSET_ACTIONS);
export const HeliusTransactionActionSchema = z.enum(HELIUS_TRANSACTION_ACTIONS);
export const HeliusChainActionSchema = z.enum(HELIUS_CHAIN_ACTIONS);
export const HeliusStreamingActionSchema = z.enum(HELIUS_STREAMING_ACTIONS);
export const HeliusKnowledgeActionSchema = z.enum(HELIUS_KNOWLEDGE_ACTIONS);
export const HeliusWriteActionSchema = z.enum(HELIUS_WRITE_ACTIONS);
export const HeliusCompressionActionSchema = z.enum(HELIUS_COMPRESSION_ACTIONS);
export const HeliusPrivacyActionSchema = z.enum(HELIUS_PRIVACY_ACTIONS);
export const HeliusLanaActionSchema = z.enum(HELIUS_LANA_ACTIONS);

export const HELIUS_ACCOUNT_SCHEMA = withTelemetry({
  action: HeliusAccountActionSchema,
  detail: detailField,
  args: argsField,
  apiKey: optionalString(),
  network: optionalString(),
  projectId: optionalString(),
  mode: optionalString(),
  paymentIntentId: optionalString(),
  plan: optionalString(),
  period: optionalString(),
  category: optionalString(),
  qty: optionalNumber(),
  couponCode: optionalString(),
  email: optionalString(),
  firstName: optionalString(),
  lastName: optionalString(),
  discoveryPath: optionalString(),
  frictionPoints: optionalString(),
});

export const HELIUS_WALLET_SCHEMA = withTelemetry({
  action: HeliusWalletActionSchema,
  detail: detailField,
  args: argsField,
  address: optionalString(),
  entries: stringArray(),
  mint: optionalString(),
  type: optionalString(),
  tokenAccounts: optionalString(),
  time: optionalNumber(),
  datetime: optionalString(),
  slot: optionalNumber(),
  limit: optionalNumber(),
  page: optionalNumber(),
  cursor: optionalString(),
  before: optionalString(),
  after: optionalString(),
  showNfts: optionalBoolean(),
  showZeroBalance: optionalBoolean(),
  showNative: optionalBoolean(),
});

export const HELIUS_ASSET_SCHEMA = withTelemetry({
  action: HeliusAssetActionSchema,
  detail: detailField,
  args: argsField,
  id: optionalString(),
  ids: stringArray(),
  address: optionalString(),
  ownerAddress: optionalString(),
  creatorAddress: optionalString(),
  authorityAddress: optionalString(),
  groupKey: optionalString(),
  groupValue: optionalString(),
  mint: optionalString(),
  limit: optionalNumber(),
  page: optionalNumber(),
  name: optionalString(),
  compressed: optionalBoolean(),
  burnt: optionalBoolean(),
  frozen: optionalBoolean(),
  onlyVerified: optionalBoolean(),
});

export const HELIUS_TRANSACTION_SCHEMA = withTelemetry({
  action: HeliusTransactionActionSchema,
  detail: detailField,
  args: argsField,
  address: optionalString(),
  signatures: stringArray(),
  showRaw: optionalBoolean(),
  limit: optionalNumber(),
  before: optionalString(),
  until: optionalString(),
  paginationToken: optionalString(),
  sortOrder: optionalString(),
  status: optionalString(),
  mode: optionalString(),
  transactionDetails: optionalString(),
  tokenAccounts: optionalString(),
  blockTimeGte: optionalNumber(),
  blockTimeLte: optionalNumber(),
  slotGte: optionalNumber(),
  slotLte: optionalNumber(),
  // getTransfersByAddress
  with: optionalString(),
  direction: optionalString(),
  mint: optionalString(),
  solMode: optionalString(),
  commitment: optionalString(),
  amountGte: optionalString(),
  amountLte: optionalString(),
  topLevelInstruction: optionalBoolean(),
  // scanTransactionHistory
  programs: z.array(z.looseObject({})).optional(),
  mints: z.array(z.looseObject({})).optional(),
  returnShape: optionalString(),
  maxScannedTransactions: optionalNumber(),
});

export const HELIUS_CHAIN_SCHEMA = withTelemetry({
  action: HeliusChainActionSchema,
  detail: detailField,
  args: argsField,
  address: optionalString(),
  addresses: stringArray(),
  programId: optionalString(),
  slot: optionalNumber(),
  limit: optionalNumber(),
  page: optionalNumber(),
  stakeAccount: optionalString(),
  wallet: optionalString(),
  includeRentExempt: optionalBoolean(),
  transactionDetails: optionalString(),
  samples: optionalNumber(),
  accountKeys: stringArray(),
  priorityLevel: optionalString(),
  includeAllLevels: optionalBoolean(),
  encoding: optionalString(),
  dataSize: optionalNumber(),
  owner: optionalString(),
  mint: optionalString(),
  // getHistoricalAccountInfo, getHistoricalTokenAccountsByOwner
  transactionIndex: optionalNumber(),
  dataSlice: z.object({ offset: z.coerce.number(), length: z.coerce.number() }).optional(),
  paginationToken: optionalString(),
  paginationKey: optionalString(),
  // simulateTransaction, simulateBundle, getBundleStatuses
  transaction: optionalString(),
  transactions: stringArray(),
  bundleIds: stringArray(),
  sigVerify: optionalBoolean(),
  replaceRecentBlockhash: optionalBoolean(),
  commitment: optionalString(),
});

export const HELIUS_STREAMING_SCHEMA = withTelemetry({
  action: HeliusStreamingActionSchema,
  detail: detailField,
  args: argsField,
  account: optionalString(),
  accountAddresses: stringArray(),
  webhookID: optionalString(),
  active: optionalBoolean(),
  webhookURL: optionalString(),
  transactionTypes: stringArray(),
  signature: optionalString(),
  encoding: optionalString(),
  commitment: optionalString(),
  region: optionalString(),
  webhookType: optionalString(),
  accountInclude: stringArray(),
  accountExclude: stringArray(),
  accountRequired: stringArray(),
  subscribeAccounts: stringArray(),
  accountOwners: stringArray(),
  transactionAccountInclude: stringArray(),
  transactionAccountExclude: stringArray(),
  transactionAccountRequired: stringArray(),
  program: optionalString(),
  // transactionSubscribe
  vote: optionalBoolean(),
  transactionDetails: optionalString(),
  showRewards: optionalBoolean(),
  maxSupportedTransactionVersion: optionalNumber(),
  // laserstreamSubscribe
  subscribeSlots: optionalBoolean(),
  filterByCommitment: optionalBoolean(),
  subscribeTransactions: optionalBoolean(),
  subscribeBlocks: optionalBoolean(),
  subscribeBlocksMeta: optionalBoolean(),
  subscribeEntries: optionalBoolean(),
  fromSlot: optionalString(),
  keepalive: optionalBoolean(),
  // parsedTransactionSubscribe
  programs: stringArray(),
  instructionNames: stringArray(),
  accountRoles: z.record(z.string(), z.string()).optional(),
  includeFailed: optionalBoolean(),
  includeCpi: optionalBoolean(),
  notificationDetails: optionalString(),
  // preconfSubscribe
  includeSource: stringArray(),
  failed: optionalBoolean(),
  regionInclude: stringArray(),
  signerInclude: stringArray(),
  signerExclude: stringArray(),
  signatures: stringArray(),
  instructions: z.array(z.looseObject({})).optional(),
  slots: optionalBoolean(),
});

export const HELIUS_KNOWLEDGE_SCHEMA = withTelemetry({
  action: HeliusKnowledgeActionSchema,
  detail: detailField,
  args: argsField,
  topic: optionalString(),
  section: optionalString(),
  query: optionalString(),
  slug: optionalString(),
  number: optionalString(),
  path: optionalString(),
  category: optionalString(),
  repo: optionalString(),
  branch: optionalString(),
  description: optionalString(),
  budget: optionalString(),
  complexity: optionalString(),
  scale: optionalString(),
  remember: optionalBoolean(),
  errorCode: optionalString(),
});

export const HELIUS_WRITE_SCHEMA = withTelemetry({
  action: HeliusWriteActionSchema,
  detail: detailField,
  args: argsField,
  recipientAddress: optionalString(),
  mintAddress: optionalString(),
  amount: optionalNumber(),
  sendMax: optionalBoolean(),
  stakeAccount: optionalString(),
  destination: optionalString(),
  owsWallet: optionalString(),
});

export const HELIUS_COMPRESSION_SCHEMA = withTelemetry({
  action: HeliusCompressionActionSchema,
  detail: detailField,
  args: argsField,
  address: optionalString(),
  // Account addresses, or {address, tree} pairs for getMultipleNewAddressProofs.
  addresses: z.array(z.union([z.string(), z.looseObject({})])).optional(),
  hash: optionalString(),
  hashes: stringArray(),
  newAddressesWithTrees: z.array(z.looseObject({})).optional(),
  signature: optionalString(),
  owner: optionalString(),
  delegate: optionalString(),
  mint: optionalString(),
  limit: optionalNumber(),
  cursor: optionalString(),
});

export const HELIUS_PRIVACY_SCHEMA = withTelemetry({
  action: HeliusPrivacyActionSchema,
  detail: detailField,
  args: argsField,
  tags: stringArray(),
  ringProgramId: optionalString(),
  nullifiers: stringArray(),
  signature: optionalString(),
  treeAccount: optionalString(),
  leaves: stringArray(),
  owners: stringArray(),
  limit: optionalNumber(),
  paginationToken: optionalString(),
});

export const HELIUS_LANA_SCHEMA = withTelemetry({
  action: HeliusLanaActionSchema,
  args: argsField,
  question: optionalString(),
  wallet: optionalString(),
  model: z.enum(LANA_MODELS).optional(),
});

export const EXPAND_RESULT_SCHEMA = withTelemetry({
  resultId: z.string().describe('The resultId from a summary-first response.'),
  section: optionalString().describe('Return only the section whose heading matches this name.'),
  item: optionalNumber().describe('Return only this item of the result, counting from 1.'),
  page: optionalNumber().describe('Page of the original action to fetch, for actions that page by number.'),
  range: optionalString().describe('Return only these characters of the result, as "start:end".'),
  continuation: optionalString().describe('"next" for the next page of a paginated result.'),
  detail: detailField.describe('How much to return: "summary", "standard", or "full" (default).'),
});

const TOOL_SCHEMAS: Record<PublicToolName, Record<string, z.ZodType>> = {
  heliusAccount: HELIUS_ACCOUNT_SCHEMA,
  heliusWallet: HELIUS_WALLET_SCHEMA,
  heliusAsset: HELIUS_ASSET_SCHEMA,
  heliusTransaction: HELIUS_TRANSACTION_SCHEMA,
  heliusChain: HELIUS_CHAIN_SCHEMA,
  heliusStreaming: HELIUS_STREAMING_SCHEMA,
  heliusKnowledge: HELIUS_KNOWLEDGE_SCHEMA,
  heliusWrite: HELIUS_WRITE_SCHEMA,
  heliusCompression: HELIUS_COMPRESSION_SCHEMA,
  heliusPrivacy: HELIUS_PRIVACY_SCHEMA,
  heliusLana: HELIUS_LANA_SCHEMA,
  expandResult: EXPAND_RESULT_SCHEMA,
};

/** Fields every routed tool takes regardless of action. */
const ROUTING_FIELDS = new Set(['action', 'detail', 'args', ...Object.keys(TELEMETRY_FIELDS)]);

/**
 * A public tool's input schema on a surface, with fields typed and described
 * by `refineSchemaFields`.
 *
 * The full surface uses the fields above unchanged. On a narrower surface the
 * `action` enum lists only the surface's actions, and a field is removed when
 * every action that reads it is off the surface (`email` goes with `signup`),
 * or when the surface strips it (`remember`).
 */
export function getToolSchema(tool: PublicToolName, surface: Surface): Record<string, z.ZodType> {
  const schema = narrowToSurface(tool, surface);
  return tool === 'expandResult' ? schema : refineSchemaFields(tool, surface, schema);
}

function narrowToSurface(tool: PublicToolName, surface: Surface): Record<string, z.ZodType> {
  const schema = TOOL_SCHEMAS[tool];
  if (surface === 'full' || tool === 'expandResult') {
    return schema;
  }

  const handlers = getActionHandlers();
  const actions = getSurfaceActions(tool, surface);
  const kept = new Set<string>();
  for (const action of actions) {
    const stripped = getStrippedParams(ACTION_CATALOG[action], surface);
    for (const field of Object.keys((handlers.get(action)?.inputSchema ?? {}) as object)) {
      if (!stripped.includes(field)) kept.add(field);
    }
  }

  const narrowed: Record<string, z.ZodType> = {};
  for (const [field, type] of Object.entries(schema)) {
    if (field === 'action') {
      narrowed.action = z.enum(actions as [ActionName, ...ActionName[]]);
    } else if (ROUTING_FIELDS.has(field) || kept.has(field)) {
      narrowed[field] = type;
    }
  }
  return narrowed;
}
