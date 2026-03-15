import {
  HELIUS_ACCOUNT_ACTIONS,
  HELIUS_ASSET_ACTIONS,
  HELIUS_CHAIN_ACTIONS,
  HELIUS_COMPRESSION_ACTIONS,
  HELIUS_KNOWLEDGE_ACTIONS,
  HELIUS_STREAMING_ACTIONS,
  HELIUS_TRANSACTION_ACTIONS,
  HELIUS_WALLET_ACTIONS,
  HELIUS_WRITE_ACTIONS,
  LEGACY_ACTIONS,
  type LegacyActionName,
} from './legacy-actions.js';
import { findPublicToolForAction, type RoutedPublicToolName } from './action-groups.js';
import type {
  ActionCatalogEntry,
  AuthRequirement,
  CapabilityGate,
  ContinuationModel,
  DetailLevel,
  Mutability,
  ResponseFamily,
} from './types.js';

const always = { kind: 'always' } as const;

function gate(
  minimumPlan: CapabilityGate['baseline']['minimumPlan'],
  label: string,
  variants?: CapabilityGate['variants'],
): CapabilityGate {
  return {
    baseline: {
      id: `${minimumPlan}:${label}`,
      minimumPlan,
      predicate: always,
      label,
    },
    ...(variants ? { variants } : {}),
  };
}

function makeEntry(
  action: LegacyActionName,
  overrides: Partial<ActionCatalogEntry> = {},
): ActionCatalogEntry {
  const publicTool = overrides.publicTool ?? findPublicToolForAction(action);
  const responseFamily = overrides.responseFamily ?? 'record';
  const defaultDetail = overrides.defaultDetail ?? (
    responseFamily === 'scalar' || responseFamily === 'mutationReceipt'
      ? 'full'
      : responseFamily === 'document' || responseFamily === 'streamingConfig' || responseFamily === 'catalog'
        ? 'summary'
        : 'standard'
  );

  return {
    action,
    publicTool,
    aliases: overrides.aliases ?? [],
    authRequirement: overrides.authRequirement ?? 'apiKey',
    capabilityGate: overrides.capabilityGate ?? gate('free', 'Available on free plan'),
    mutability: overrides.mutability ?? (publicTool === 'heliusWrite' ? 'write' : 'read'),
    responseFamily,
    defaultDetail,
    handleEligibility: overrides.handleEligibility ?? !['scalar', 'mutationReceipt'].includes(responseFamily),
    normalizer: overrides.normalizer ?? responseFamily,
    continuationModel: overrides.continuationModel ?? 'none',
  };
}

function addEntries(
  target: Partial<Record<LegacyActionName, ActionCatalogEntry>>,
  actions: readonly LegacyActionName[],
  overrides: Partial<ActionCatalogEntry> = {},
): void {
  for (const action of actions) {
    target[action] = makeEntry(action, overrides);
  }
}

const catalog: Partial<Record<LegacyActionName, ActionCatalogEntry>> = {};

addEntries(catalog, HELIUS_ACCOUNT_ACTIONS, {
  authRequirement: 'none',
  capabilityGate: gate('free', 'Account setup and plan metadata'),
  responseFamily: 'record',
});

addEntries(catalog, HELIUS_WALLET_ACTIONS, {
  capabilityGate: gate('free', 'Wallet data'),
  responseFamily: 'record',
});

addEntries(catalog, HELIUS_ASSET_ACTIONS, {
  capabilityGate: gate('free', 'Asset and DAS queries'),
  responseFamily: 'record',
});

addEntries(catalog, HELIUS_TRANSACTION_ACTIONS, {
  capabilityGate: gate('free', 'Transaction parsing and history'),
  responseFamily: 'history',
});

addEntries(catalog, HELIUS_CHAIN_ACTIONS, {
  capabilityGate: gate('free', 'Core chain state'),
  responseFamily: 'record',
});

addEntries(catalog, HELIUS_STREAMING_ACTIONS, {
  capabilityGate: gate('free', 'Streaming and webhook operations'),
  responseFamily: 'record',
});

addEntries(catalog, HELIUS_KNOWLEDGE_ACTIONS, {
  authRequirement: 'none',
  capabilityGate: gate('free', 'Documentation and knowledge'),
  responseFamily: 'document',
});

addEntries(catalog, HELIUS_WRITE_ACTIONS, {
  authRequirement: 'signer',
  capabilityGate: gate('free', 'Transaction sending and staking'),
  mutability: 'write',
  responseFamily: 'mutationReceipt',
});

addEntries(catalog, HELIUS_COMPRESSION_ACTIONS, {
  capabilityGate: gate('free', 'Compression state queries'),
  responseFamily: 'record',
});

const developerWalletGate = gate('developer', 'Developer plan or higher');
const businessStreamingGate = gate('business', 'Business plan or higher');
const professionalLaserstreamGate = gate(
  'developer',
  'Developer plan on devnet',
  [
    {
      id: 'professional:laserstream-mainnet',
      minimumPlan: 'professional',
      predicate: { kind: 'network', oneOf: ['mainnet-beta'] },
      label: 'Professional plan on mainnet',
    },
  ],
);

const scalarActions: LegacyActionName[] = [
  'getBalance',
  'checkSignupBalance',
  'getAccountPlan',
  'getNetworkStatus',
  'getPriorityFeeEstimate',
  'getCompressedBalance',
  'getCompressedBalanceByOwner',
  'getCompressedTokenAccountBalance',
  'getIndexerHealth',
  'getIndexerSlot',
  'getWithdrawableAmount',
];

for (const action of scalarActions) {
  catalog[action] = makeEntry(action, {
    ...catalog[action],
    responseFamily: 'scalar',
    defaultDetail: 'full',
    handleEligibility: false,
  });
}

const mutationActions: LegacyActionName[] = [
  'createWebhook',
  'updateWebhook',
  'deleteWebhook',
  'transferSol',
  'transferToken',
  'stakeSOL',
  'unstakeSOL',
  'withdrawStake',
];

for (const action of mutationActions) {
  catalog[action] = makeEntry(action, {
    ...catalog[action],
    responseFamily: 'mutationReceipt',
    defaultDetail: 'full',
    handleEligibility: false,
  });
}

const listActions: LegacyActionName[] = [
  'getTokenBalances',
  'getWalletBalances',
  'getWalletHistory',
  'getWalletTransfers',
  'batchWalletIdentity',
  'getAssetsByOwner',
  'searchAssets',
  'getAssetsByGroup',
  'getNftEditions',
  'getTokenHolders',
  'getTokenAccounts',
  'getProgramAccounts',
  'getStakeAccounts',
  'getAllWebhooks',
  'listHeliusDocTopics',
  'listSIMDs',
  'getCompressedAccountsByOwner',
  'getMultipleCompressedAccounts',
  'getCompressedMintTokenHolders',
  'getCompressedTokenAccountsByOwner',
  'getCompressedTokenAccountsByDelegate',
  'getCompressedTokenBalancesByOwnerV2',
];

for (const action of listActions) {
  catalog[action] = makeEntry(action, {
    ...catalog[action],
    responseFamily: 'list',
    defaultDetail: 'standard',
  });
}

const historyActions: LegacyActionName[] = [
  'parseTransactions',
  'getTransactionHistory',
  'getSignaturesForAsset',
  'getCompressionSignaturesForAccount',
  'getCompressionSignaturesForAddress',
  'getCompressionSignaturesForOwner',
  'getCompressionSignaturesForTokenOwner',
  'getLatestCompressionSignatures',
  'getLatestNonVotingSignatures',
];

for (const action of historyActions) {
  catalog[action] = makeEntry(action, {
    ...catalog[action],
    responseFamily: 'history',
    defaultDetail: 'standard',
  });
}

const documentActions: LegacyActionName[] = [
  'lookupHeliusDocs',
  'getHeliusCreditsInfo',
  'getRateLimitInfo',
  'getSIMD',
  'searchSolanaDocs',
  'readSolanaSourceFile',
  'fetchHeliusBlog',
  'getSenderInfo',
  'getWebhookGuide',
  'getLatencyComparison',
  'getEnhancedWebSocketInfo',
  'getLaserstreamInfo',
  'getPumpFunGuide',
];

for (const action of documentActions) {
  catalog[action] = makeEntry(action, {
    ...catalog[action],
    responseFamily: 'document',
    defaultDetail: 'summary',
  });
}

catalog.recommendStack = makeEntry('recommendStack', {
  responseFamily: 'catalog',
  defaultDetail: 'summary',
});

for (const action of ['transactionSubscribe', 'accountSubscribe', 'laserstreamSubscribe'] as const) {
  catalog[action] = makeEntry(action, {
    ...catalog[action],
    responseFamily: 'streamingConfig',
    defaultDetail: 'summary',
  });
}

catalog.setHeliusApiKey = makeEntry('setHeliusApiKey', {
  authRequirement: 'none',
  capabilityGate: gate('free', 'API key configuration'),
  responseFamily: 'record',
  defaultDetail: 'standard',
  handleEligibility: false,
});

catalog.generateKeypair = makeEntry('generateKeypair', {
  authRequirement: 'none',
  capabilityGate: gate('free', 'Local keypair generation'),
  responseFamily: 'record',
  defaultDetail: 'standard',
  handleEligibility: false,
});

catalog.getStarted = makeEntry('getStarted', {
  authRequirement: 'none',
  capabilityGate: gate('free', 'Setup instructions'),
  responseFamily: 'record',
  defaultDetail: 'standard',
  handleEligibility: false,
});

catalog.agenticSignup = makeEntry('agenticSignup', {
  authRequirement: 'signer',
  capabilityGate: gate('free', 'Agentic signup flow'),
  responseFamily: 'record',
  defaultDetail: 'standard',
  handleEligibility: false,
});

catalog.getAccountStatus = makeEntry('getAccountStatus', {
  authRequirement: 'jwt',
  capabilityGate: gate('free', 'Authenticated account status'),
  responseFamily: 'record',
});

catalog.previewUpgrade = makeEntry('previewUpgrade', {
  authRequirement: 'jwt',
  capabilityGate: gate('free', 'Upgrade preview'),
  responseFamily: 'record',
  handleEligibility: false,
});

catalog.upgradePlan = makeEntry('upgradePlan', {
  authRequirement: 'jwtAndSigner',
  capabilityGate: gate('free', 'Upgrade checkout'),
  mutability: 'write',
  responseFamily: 'mutationReceipt',
  handleEligibility: false,
});

catalog.payRenewal = makeEntry('payRenewal', {
  authRequirement: 'jwtAndSigner',
  capabilityGate: gate('free', 'Renewal checkout'),
  mutability: 'write',
  responseFamily: 'mutationReceipt',
  handleEligibility: false,
});

catalog.compareHeliusPlans = makeEntry('compareHeliusPlans', {
  authRequirement: 'none',
  capabilityGate: gate('free', 'Plan comparison'),
  responseFamily: 'catalog',
  defaultDetail: 'summary',
});

catalog.getHeliusPlanInfo = makeEntry('getHeliusPlanInfo', {
  authRequirement: 'none',
  capabilityGate: gate('free', 'Plan details'),
  responseFamily: 'catalog',
  defaultDetail: 'summary',
});

catalog.getWalletBalances = makeEntry('getWalletBalances', {
  capabilityGate: developerWalletGate,
  responseFamily: 'list',
  defaultDetail: 'standard',
});

catalog.getWalletHistory = makeEntry('getWalletHistory', {
  capabilityGate: developerWalletGate,
  responseFamily: 'history',
  defaultDetail: 'standard',
});

catalog.getWalletTransfers = makeEntry('getWalletTransfers', {
  capabilityGate: developerWalletGate,
  responseFamily: 'history',
  defaultDetail: 'standard',
});

catalog.getWalletIdentity = makeEntry('getWalletIdentity', {
  capabilityGate: developerWalletGate,
  responseFamily: 'record',
  defaultDetail: 'standard',
  handleEligibility: false,
});

catalog.batchWalletIdentity = makeEntry('batchWalletIdentity', {
  capabilityGate: developerWalletGate,
  responseFamily: 'list',
  defaultDetail: 'standard',
});

catalog.getWalletFundedBy = makeEntry('getWalletFundedBy', {
  capabilityGate: developerWalletGate,
  responseFamily: 'record',
  defaultDetail: 'standard',
  handleEligibility: false,
});

catalog.transactionSubscribe = makeEntry('transactionSubscribe', {
  capabilityGate: businessStreamingGate,
  responseFamily: 'streamingConfig',
  defaultDetail: 'summary',
});

catalog.accountSubscribe = makeEntry('accountSubscribe', {
  capabilityGate: businessStreamingGate,
  responseFamily: 'streamingConfig',
  defaultDetail: 'summary',
});

catalog.laserstreamSubscribe = makeEntry('laserstreamSubscribe', {
  capabilityGate: professionalLaserstreamGate,
  responseFamily: 'streamingConfig',
  defaultDetail: 'summary',
});

catalog.getEnhancedWebSocketInfo = makeEntry('getEnhancedWebSocketInfo', {
  authRequirement: 'none',
  capabilityGate: gate('free', 'Enhanced WebSocket info', [
    {
      id: 'business:enhanced-websockets',
      minimumPlan: 'business',
      predicate: always,
      label: 'Enhanced WebSockets require Business plan or higher',
    },
  ]),
  responseFamily: 'document',
  defaultDetail: 'summary',
});

catalog.getLaserstreamInfo = makeEntry('getLaserstreamInfo', {
  authRequirement: 'none',
  capabilityGate: gate('free', 'Laserstream info', [
    {
      id: 'developer:laserstream-devnet',
      minimumPlan: 'developer',
      predicate: { kind: 'network', oneOf: ['devnet'] },
      label: 'Laserstream on devnet requires Developer plan or higher',
    },
    {
      id: 'professional:laserstream-mainnet-info',
      minimumPlan: 'professional',
      predicate: { kind: 'network', oneOf: ['mainnet-beta'] },
      label: 'Laserstream on mainnet requires Professional plan',
    },
  ]),
  responseFamily: 'document',
  defaultDetail: 'summary',
});

catalog.getTransactionHistory = makeEntry('getTransactionHistory', {
  responseFamily: 'history',
  defaultDetail: 'standard',
  continuationModel: 'transactionHistory',
});

for (const action of LEGACY_ACTIONS) {
  if (!catalog[action]) {
    throw new Error(`Missing action catalog entry for ${action}`);
  }
}

export const ACTION_CATALOG: Record<LegacyActionName, ActionCatalogEntry> =
  catalog as Record<LegacyActionName, ActionCatalogEntry>;

export function getActionCatalogEntry(action: LegacyActionName): ActionCatalogEntry {
  return ACTION_CATALOG[action];
}

export function getActionsForTool(tool: RoutedPublicToolName): LegacyActionName[] {
  return (Object.values(ACTION_CATALOG)
    .filter((entry) => entry.publicTool === tool)
    .map((entry) => entry.action)
    .sort()) as LegacyActionName[];
}
