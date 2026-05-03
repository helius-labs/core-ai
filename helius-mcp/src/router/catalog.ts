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
  ACTION_NAMES,
  type ActionName,
} from './actions.js';
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
  action: ActionName,
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
    capabilityGate: overrides.capabilityGate ?? gate('agent', 'Available on every plan'),
    mutability: overrides.mutability ?? (publicTool === 'heliusWrite' ? 'write' : 'read'),
    responseFamily,
    defaultDetail,
    handleEligibility: overrides.handleEligibility ?? !['scalar', 'mutationReceipt'].includes(responseFamily),
    normalizer: overrides.normalizer ?? responseFamily,
    continuationModel: overrides.continuationModel ?? 'none',
  };
}

function addEntries(
  target: Partial<Record<ActionName, ActionCatalogEntry>>,
  actions: readonly ActionName[],
  overrides: Partial<ActionCatalogEntry> = {},
): void {
  for (const action of actions) {
    target[action] = makeEntry(action, overrides);
  }
}

const catalog: Partial<Record<ActionName, ActionCatalogEntry>> = {};

addEntries(catalog, HELIUS_ACCOUNT_ACTIONS, {
  authRequirement: 'none',
  capabilityGate: gate('agent', 'Account setup and plan metadata'),
  responseFamily: 'record',
});

addEntries(catalog, HELIUS_WALLET_ACTIONS, {
  capabilityGate: gate('agent', 'Wallet data'),
  responseFamily: 'record',
});

addEntries(catalog, HELIUS_ASSET_ACTIONS, {
  capabilityGate: gate('agent', 'Asset and DAS queries'),
  responseFamily: 'record',
});

addEntries(catalog, HELIUS_TRANSACTION_ACTIONS, {
  capabilityGate: gate('agent', 'Transaction parsing and history'),
  responseFamily: 'history',
});

addEntries(catalog, HELIUS_CHAIN_ACTIONS, {
  capabilityGate: gate('agent', 'Core chain state'),
  responseFamily: 'record',
});

addEntries(catalog, HELIUS_STREAMING_ACTIONS, {
  capabilityGate: gate('agent', 'Streaming and webhook operations'),
  responseFamily: 'record',
});

addEntries(catalog, HELIUS_KNOWLEDGE_ACTIONS, {
  authRequirement: 'none',
  capabilityGate: gate('agent', 'Documentation and knowledge'),
  responseFamily: 'document',
});

addEntries(catalog, HELIUS_WRITE_ACTIONS, {
  authRequirement: 'signer',
  capabilityGate: gate('agent', 'Transaction sending and staking'),
  mutability: 'write',
  responseFamily: 'mutationReceipt',
});

addEntries(catalog, HELIUS_COMPRESSION_ACTIONS, {
  capabilityGate: gate('agent', 'Compression state queries'),
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

const scalarActions: ActionName[] = [
  'getBalance',
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

const mutationActions: ActionName[] = [
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

const listActions: ActionName[] = [
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

const historyActions: ActionName[] = [
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

const documentActions: ActionName[] = [
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
  capabilityGate: gate('agent', 'API key configuration'),
  responseFamily: 'record',
  defaultDetail: 'standard',
  handleEligibility: false,
});

catalog.generateKeypair = makeEntry('generateKeypair', {
  authRequirement: 'none',
  capabilityGate: gate('agent', 'Local keypair generation'),
  responseFamily: 'record',
  defaultDetail: 'standard',
  handleEligibility: false,
});

catalog.getStarted = makeEntry('getStarted', {
  authRequirement: 'none',
  capabilityGate: gate('agent', 'Setup instructions'),
  responseFamily: 'record',
  defaultDetail: 'standard',
  handleEligibility: false,
});

catalog.signup = makeEntry('signup', {
  authRequirement: 'signer',
  capabilityGate: gate('agent', 'Signup flow'),
  responseFamily: 'record',
  defaultDetail: 'standard',
  handleEligibility: false,
});

catalog.purchaseCredits = makeEntry('purchaseCredits', {
  authRequirement: 'jwt',
  capabilityGate: gate('agent', 'Prepaid credits top-up'),
  responseFamily: 'record',
  defaultDetail: 'standard',
  handleEligibility: false,
});

catalog.getAccountStatus = makeEntry('getAccountStatus', {
  authRequirement: 'jwt',
  capabilityGate: gate('agent', 'Authenticated account status'),
  responseFamily: 'record',
});

catalog.previewUpgrade = makeEntry('previewUpgrade', {
  authRequirement: 'jwt',
  capabilityGate: gate('agent', 'Upgrade preview'),
  responseFamily: 'record',
  handleEligibility: false,
});

catalog.upgradePlan = makeEntry('upgradePlan', {
  authRequirement: 'jwtAndSigner',
  capabilityGate: gate('agent', 'Upgrade checkout'),
  mutability: 'write',
  responseFamily: 'mutationReceipt',
  handleEligibility: false,
});

catalog.payRenewal = makeEntry('payRenewal', {
  authRequirement: 'jwtAndSigner',
  capabilityGate: gate('agent', 'Renewal checkout'),
  mutability: 'write',
  responseFamily: 'mutationReceipt',
  handleEligibility: false,
});

catalog.compareHeliusPlans = makeEntry('compareHeliusPlans', {
  authRequirement: 'none',
  capabilityGate: gate('agent', 'Plan comparison'),
  responseFamily: 'catalog',
  defaultDetail: 'summary',
});

catalog.getHeliusPlanInfo = makeEntry('getHeliusPlanInfo', {
  authRequirement: 'none',
  capabilityGate: gate('agent', 'Plan details'),
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
  capabilityGate: gate('agent', 'Enhanced WebSocket info', [
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
  capabilityGate: gate('agent', 'Laserstream info', [
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

for (const action of ACTION_NAMES) {
  if (!catalog[action]) {
    throw new Error(`Missing action catalog entry for ${action}`);
  }
}

export const ACTION_CATALOG: Record<ActionName, ActionCatalogEntry> =
  catalog as Record<ActionName, ActionCatalogEntry>;

export function getActionCatalogEntry(action: ActionName): ActionCatalogEntry {
  return ACTION_CATALOG[action];
}

export function getActionsForTool(tool: RoutedPublicToolName): ActionName[] {
  return (Object.values(ACTION_CATALOG)
    .filter((entry) => entry.publicTool === tool)
    .map((entry) => entry.action)
    .sort()) as ActionName[];
}
