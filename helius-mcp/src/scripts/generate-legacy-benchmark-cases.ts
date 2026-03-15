#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPublicToolForAction, type RoutedPublicToolName } from '../router/action-groups.js';
import { type LegacyActionName, LEGACY_ACTIONS } from '../router/legacy-actions.js';
import {
  HELIUS_ACCOUNT_SCHEMA,
  HELIUS_ASSET_SCHEMA,
  HELIUS_CHAIN_SCHEMA,
  HELIUS_COMPRESSION_SCHEMA,
  HELIUS_KNOWLEDGE_SCHEMA,
  HELIUS_STREAMING_SCHEMA,
  HELIUS_TRANSACTION_SCHEMA,
  HELIUS_WALLET_SCHEMA,
  HELIUS_WRITE_SCHEMA,
} from '../router/schemas.js';

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };
type StepExpectation = 'success' | 'error' | 'any';

type CaseStep = {
  name: string;
  arguments?: JsonObject;
  expectation?: StepExpectation;
};

type BenchmarkScenario = {
  id: string;
  description: string;
  baseline: CaseStep[];
  candidate: CaseStep[];
};

type FixtureStep = {
  action: LegacyActionName;
  args?: JsonObject;
  expectation?: StepExpectation;
};

type Fixture = {
  description: string;
  expectation?: StepExpectation;
  args?: JsonObject;
  setup?: FixtureStep[];
};

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT_PATH = resolve(PACKAGE_ROOT, 'benchmarks/legacy-actions.dummy.json');

const DUMMY_ADDRESS = '11111111111111111111111111111111';
const DUMMY_MINT = 'So11111111111111111111111111111111111111112';
const DUMMY_SIGNATURE = '1'.repeat(88);
const DUMMY_HASH = '1'.repeat(44);

const shapeKeys = (shape: Record<string, unknown>): Set<string> => new Set(Object.keys(shape));

const PUBLIC_TOOL_FIELDS: Record<RoutedPublicToolName, Set<string>> = {
  heliusAccount: shapeKeys(HELIUS_ACCOUNT_SCHEMA),
  heliusWallet: shapeKeys(HELIUS_WALLET_SCHEMA),
  heliusAsset: shapeKeys(HELIUS_ASSET_SCHEMA),
  heliusTransaction: shapeKeys(HELIUS_TRANSACTION_SCHEMA),
  heliusChain: shapeKeys(HELIUS_CHAIN_SCHEMA),
  heliusStreaming: shapeKeys(HELIUS_STREAMING_SCHEMA),
  heliusKnowledge: shapeKeys(HELIUS_KNOWLEDGE_SCHEMA),
  heliusWrite: shapeKeys(HELIUS_WRITE_SCHEMA),
  heliusCompression: shapeKeys(HELIUS_COMPRESSION_SCHEMA),
};

const anyFixture = (description: string, args: JsonObject = {}, setup: FixtureStep[] = []): Fixture => ({
  description,
  expectation: 'any',
  args,
  setup,
});

const successFixture = (description: string, args: JsonObject = {}, setup: FixtureStep[] = []): Fixture => ({
  description,
  expectation: 'success',
  args,
  setup,
});

const errorFixture = (description: string, args: JsonObject = {}, setup: FixtureStep[] = []): Fixture => ({
  description,
  expectation: 'error',
  args,
  setup,
});

const FIXTURES: Record<LegacyActionName, Fixture> = {
  getStarted: successFixture('Onboarding/status flow with no external inputs.'),
  setHeliusApiKey: errorFixture('Config write path with an invalid API key in an isolated benchmark home.', {
    apiKey: 'invalid-api-key',
    network: 'mainnet-beta',
  }),
  generateKeypair: successFixture('Keypair generation in an isolated benchmark home.'),
  checkSignupBalance: anyFixture('Signup balance check after generating a temporary keypair.', {}, [
    { action: 'generateKeypair', expectation: 'success' },
  ]),
  agenticSignup: errorFixture('Agentic signup with a temporary unfunded keypair should fail safely.', {
    plan: 'basic',
    discoveryPath: 'benchmark',
  }, [
    { action: 'generateKeypair', expectation: 'success' },
  ]),
  getAccountStatus: anyFixture('Account status lookup with whatever auth state the benchmark target has.'),
  getAccountPlan: anyFixture('Plan preflight/feature check.'),
  getHeliusPlanInfo: anyFixture('Plan catalog lookup.', { plan: 'all' }),
  compareHeliusPlans: anyFixture('Plan comparison lookup.', { category: 'pricing' }),
  previewUpgrade: anyFixture('Upgrade preview lookup with synthetic plan inputs.', { plan: 'developer', period: 'monthly' }),
  upgradePlan: errorFixture('Upgrade should fail safely with synthetic plan data in an isolated benchmark home.', {
    plan: 'developer',
    period: 'monthly',
  }),
  payRenewal: errorFixture('Renewal payment should fail safely with a dummy payment intent id.', {
    paymentIntentId: 'pi_dummy',
  }),

  getBalance: anyFixture('SOL balance lookup for a synthetic address.', { address: DUMMY_ADDRESS }),
  getTokenBalances: anyFixture('Token-balance lookup for a synthetic wallet.', { address: DUMMY_ADDRESS }),
  getWalletBalances: anyFixture('Portfolio lookup with a bounded synthetic wallet query.', {
    address: DUMMY_ADDRESS,
    limit: 5,
    showNative: true,
    showNfts: false,
    showZeroBalance: false,
  }),
  getWalletHistory: anyFixture('Wallet-history lookup with bounded synthetic inputs.', {
    address: DUMMY_ADDRESS,
    limit: 5,
    tokenAccounts: 'balanceChanged',
  }),
  getWalletTransfers: anyFixture('Wallet-transfer lookup with bounded synthetic inputs.', {
    address: DUMMY_ADDRESS,
    limit: 5,
  }),
  getWalletIdentity: anyFixture('Wallet-identity lookup for a synthetic address.', { address: DUMMY_ADDRESS }),
  batchWalletIdentity: anyFixture('Batch wallet-identity lookup for a synthetic address list.', {
    addresses: [DUMMY_ADDRESS, DUMMY_MINT],
  }),
  getWalletFundedBy: anyFixture('Funding-source lookup for a synthetic address.', { address: DUMMY_ADDRESS }),

  getAsset: anyFixture('Single-asset lookup for a synthetic mint.', { id: DUMMY_MINT }),
  getAssetsByOwner: anyFixture('Assets-by-owner lookup for a synthetic wallet.', {
    address: DUMMY_ADDRESS,
    limit: 5,
    page: 1,
  }),
  searchAssets: anyFixture('Filtered asset search with bounded synthetic filters.', {
    ownerAddress: DUMMY_ADDRESS,
    limit: 5,
    page: 1,
  }),
  getAssetsByGroup: anyFixture('Collection/group asset lookup with synthetic collection values.', {
    groupKey: 'collection',
    groupValue: DUMMY_MINT,
    limit: 5,
    page: 1,
  }),
  getAssetProof: anyFixture('Single asset-proof lookup for a synthetic mint.', { id: DUMMY_MINT }),
  getAssetProofBatch: anyFixture('Batch asset-proof lookup for synthetic mints.', { ids: [DUMMY_MINT] }),
  getSignaturesForAsset: anyFixture('Asset-signature lookup for a synthetic mint.', {
    id: DUMMY_MINT,
    limit: 5,
    page: 1,
  }),
  getNftEditions: anyFixture('NFT-edition lookup for a synthetic mint.', {
    mint: DUMMY_MINT,
    limit: 5,
    page: 1,
  }),
  getTokenHolders: anyFixture('Token-holder lookup for a synthetic mint.', { mint: DUMMY_MINT }),

  parseTransactions: anyFixture('Transaction parsing for a synthetic signature.', {
    signatures: [DUMMY_SIGNATURE],
  }),
  getTransactionHistory: anyFixture('Transaction-history lookup with bounded synthetic inputs.', {
    address: DUMMY_ADDRESS,
    mode: 'signatures',
    limit: 5,
  }),

  getAccountInfo: anyFixture('Account-info lookup for a synthetic address.', { address: DUMMY_ADDRESS }),
  getTokenAccounts: anyFixture('Token-account lookup for a synthetic owner.', {
    owner: DUMMY_ADDRESS,
    limit: 5,
    page: 1,
  }),
  getProgramAccounts: anyFixture('Program-account lookup for a synthetic program id.', {
    programId: DUMMY_ADDRESS,
    limit: 5,
  }),
  getBlock: anyFixture('Block lookup for a low synthetic slot.', { slot: 1 }),
  getNetworkStatus: anyFixture('Network-status snapshot lookup.'),
  getPriorityFeeEstimate: anyFixture('Priority-fee estimate with bounded synthetic account keys.', {
    accountKeys: [DUMMY_ADDRESS],
    includeAllLevels: true,
  }),
  getStakeAccounts: anyFixture('Stake-account lookup for a synthetic wallet.', { wallet: DUMMY_ADDRESS }),
  getWithdrawableAmount: anyFixture('Withdrawable-stake lookup for a synthetic stake account.', {
    stakeAccount: DUMMY_ADDRESS,
  }),

  createWebhook: errorFixture('Webhook creation should fail safely with intentionally incomplete synthetic input.', {
    accountAddresses: [DUMMY_ADDRESS],
    webhookType: 'enhanced',
  }),
  getAllWebhooks: anyFixture('List-webhooks lookup for the current auth state.'),
  getWebhookByID: errorFixture('Webhook-id lookup should fail safely with intentionally missing required fields.'),
  updateWebhook: errorFixture('Webhook update should fail safely with intentionally incomplete synthetic input.', {
    webhookType: 'enhanced',
  }),
  deleteWebhook: errorFixture('Webhook delete should fail safely with intentionally missing required fields.'),
  transactionSubscribe: anyFixture('Enhanced WebSocket transaction subscription config with a synthetic account filter.', {
    accountInclude: [DUMMY_ADDRESS],
    commitment: 'confirmed',
    encoding: 'jsonParsed',
  }),
  accountSubscribe: anyFixture('Enhanced WebSocket account subscription config for a synthetic account.', {
    account: DUMMY_ADDRESS,
    commitment: 'confirmed',
    encoding: 'jsonParsed',
  }),
  laserstreamSubscribe: anyFixture('Laserstream config lookup with bounded synthetic filters.', {
    subscribeTransactions: true,
    transactionAccountInclude: [DUMMY_ADDRESS],
    region: 'ewr',
  }),

  lookupHeliusDocs: anyFixture('Targeted docs lookup.', {
    topic: 'billing',
    section: 'credits',
  }),
  listHeliusDocTopics: anyFixture('List of docs topics.'),
  getHeliusCreditsInfo: anyFixture('Credits info lookup.'),
  getRateLimitInfo: anyFixture('Rate-limit info lookup.'),
  troubleshootError: anyFixture('Error-code troubleshooting lookup.', { errorCode: '429' }),
  recommendStack: anyFixture('Architecture recommendation lookup.', {
    description: 'Build a wallet dashboard with live balances and transaction history.',
    budget: 'free',
    complexity: 'low',
    scale: 'prototype',
    remember: false,
  }),
  getSIMD: anyFixture('SIMD lookup for a known proposal number.', { number: '228' }),
  listSIMDs: anyFixture('SIMD index lookup.'),
  searchSolanaDocs: anyFixture('Solana docs search query.', { query: 'PDAs' }),
  readSolanaSourceFile: anyFixture('Solana source-file lookup for a known Agave file.', {
    repo: 'agave',
    branch: 'master',
    path: 'runtime/src/bank.rs',
  }),
  fetchHeliusBlog: anyFixture('Helius blog listing lookup.', {
    action: 'list',
  }),
  getPumpFunGuide: anyFixture('Pump.fun guide lookup.'),
  getSenderInfo: anyFixture('Sender guide lookup.'),
  getWebhookGuide: anyFixture('Webhook guide lookup.'),
  getLatencyComparison: anyFixture('Streaming latency comparison lookup.'),
  getEnhancedWebSocketInfo: anyFixture('Enhanced WebSocket guide lookup.'),
  getLaserstreamInfo: anyFixture('Laserstream guide lookup.'),

  transferSol: errorFixture('SOL transfer should fail safely with a synthetic recipient and no valid signing context.', {
    recipientAddress: DUMMY_ADDRESS,
  }),
  transferToken: errorFixture('Token transfer should fail safely with synthetic args and no valid signing context.', {
    recipientAddress: DUMMY_ADDRESS,
    mintAddress: DUMMY_MINT,
  }),
  stakeSOL: errorFixture('Stake flow should fail safely with no valid signing context.', {
    amount: 0.01,
  }),
  unstakeSOL: errorFixture('Unstake flow should fail safely with no valid signing context.', {
    stakeAccount: DUMMY_ADDRESS,
  }),
  withdrawStake: errorFixture('Stake-withdraw flow should fail safely with no valid signing context.', {
    stakeAccount: DUMMY_ADDRESS,
  }),

  getCompressedAccount: anyFixture('Compressed-account lookup for a synthetic address.', { address: DUMMY_ADDRESS }),
  getCompressedAccountsByOwner: anyFixture('Compressed-account owner lookup for a synthetic wallet.', {
    owner: DUMMY_ADDRESS,
    limit: 5,
  }),
  getMultipleCompressedAccounts: anyFixture('Batch compressed-account lookup for a synthetic address list.', {
    addresses: [DUMMY_ADDRESS],
  }),
  getCompressedBalance: anyFixture('Compressed balance lookup for a synthetic address.', { address: DUMMY_ADDRESS }),
  getCompressedBalanceByOwner: anyFixture('Compressed balance by owner lookup for a synthetic wallet.', {
    owner: DUMMY_ADDRESS,
  }),
  getCompressedMintTokenHolders: anyFixture('Compressed token-holder lookup for a synthetic mint.', {
    mint: DUMMY_MINT,
    limit: 5,
  }),
  getCompressedTokenAccountBalance: anyFixture('Compressed token-account balance lookup for a synthetic address.', {
    address: DUMMY_ADDRESS,
  }),
  getCompressedTokenAccountsByOwner: anyFixture('Compressed token-account lookup by owner for a synthetic wallet.', {
    owner: DUMMY_ADDRESS,
    limit: 5,
  }),
  getCompressedTokenAccountsByDelegate: anyFixture('Compressed token-account lookup by delegate for a synthetic wallet.', {
    delegate: DUMMY_ADDRESS,
    limit: 5,
  }),
  getCompressedTokenBalancesByOwnerV2: anyFixture('Compressed token-balance summary lookup for a synthetic wallet.', {
    owner: DUMMY_ADDRESS,
    limit: 5,
  }),
  getCompressedAccountProof: anyFixture('Compressed account-proof lookup for a synthetic hash.', {
    hash: DUMMY_HASH,
  }),
  getMultipleCompressedAccountProofs: anyFixture('Batch compressed account-proof lookup for a synthetic hash list.', {
    hashes: [DUMMY_HASH],
  }),
  getMultipleNewAddressProofs: anyFixture('Non-inclusion proof lookup for a synthetic address/tree pair.', {
    addresses: [{ address: DUMMY_ADDRESS, tree: DUMMY_ADDRESS }],
  }),
  getCompressionSignaturesForAccount: anyFixture('Compression signatures lookup for a synthetic hash.', {
    hash: DUMMY_HASH,
    limit: 5,
  }),
  getCompressionSignaturesForAddress: anyFixture('Compression signatures lookup for a synthetic address.', {
    address: DUMMY_ADDRESS,
    limit: 5,
  }),
  getCompressionSignaturesForOwner: anyFixture('Compression signatures lookup for a synthetic owner.', {
    owner: DUMMY_ADDRESS,
    limit: 5,
  }),
  getCompressionSignaturesForTokenOwner: anyFixture('Compression token-owner signatures lookup for a synthetic owner.', {
    owner: DUMMY_ADDRESS,
    limit: 5,
  }),
  getLatestCompressionSignatures: anyFixture('Latest compression signatures lookup.', {
    limit: 5,
  }),
  getLatestNonVotingSignatures: anyFixture('Latest non-voting compression signatures lookup.', {
    limit: 5,
  }),
  getTransactionWithCompressionInfo: anyFixture('Compression transaction-detail lookup for a synthetic signature.', {
    signature: DUMMY_SIGNATURE,
  }),
  getValidityProof: anyFixture('Compression validity-proof lookup for a synthetic hash list.', {
    hashes: [DUMMY_HASH],
  }),
  getIndexerHealth: anyFixture('Compression indexer health lookup.'),
  getIndexerSlot: anyFixture('Compression indexer slot lookup.'),
};

function buildCandidateArguments(publicTool: RoutedPublicToolName, action: LegacyActionName, args: JsonObject): JsonObject {
  const supported = PUBLIC_TOOL_FIELDS[publicTool];
  const directArgs: JsonObject = { action };
  const nestedArgs: JsonObject = {};

  for (const [key, value] of Object.entries(args)) {
    if (key === 'action' || key === 'detail' || !supported.has(key)) {
      nestedArgs[key] = value;
    } else {
      directArgs[key] = value;
    }
  }

  if (Object.keys(nestedArgs).length > 0) {
    directArgs.args = nestedArgs;
  }

  return directArgs;
}

function stepForAction(step: FixtureStep): CaseStep {
  return {
    name: step.action,
    arguments: step.args,
    expectation: step.expectation,
  };
}

function candidateStepForAction(step: FixtureStep): CaseStep {
  const publicTool = findPublicToolForAction(step.action);
  return {
    name: publicTool,
    arguments: buildCandidateArguments(publicTool, step.action, step.args ?? {}),
    expectation: step.expectation,
  };
}

function buildScenario(action: LegacyActionName, fixture: Fixture): BenchmarkScenario {
  const finalStep: FixtureStep = {
    action,
    args: fixture.args,
    expectation: fixture.expectation,
  };
  const allSteps = [...(fixture.setup ?? []), finalStep];

  return {
    id: action,
    description: fixture.description,
    baseline: allSteps.map(stepForAction),
    candidate: allSteps.map(candidateStepForAction),
  };
}

async function main(): Promise<void> {
  const missing = LEGACY_ACTIONS.filter((action) => !FIXTURES[action]);
  if (missing.length > 0) {
    throw new Error(`Missing benchmark fixtures for actions: ${missing.join(', ')}`);
  }

  const scenarios = LEGACY_ACTIONS.map((action) => buildScenario(action, FIXTURES[action]));

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(
    OUTPUT_PATH,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), scenarioCount: scenarios.length, scenarios }, null, 2)}\n`,
    'utf8',
  );

  console.log(`Wrote ${scenarios.length} benchmark scenarios to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
