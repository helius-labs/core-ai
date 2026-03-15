export const HELIUS_ACCOUNT_ACTIONS = [
  'getStarted',
  'setHeliusApiKey',
  'generateKeypair',
  'checkSignupBalance',
  'agenticSignup',
  'getAccountStatus',
  'getAccountPlan',
  'getHeliusPlanInfo',
  'compareHeliusPlans',
  'previewUpgrade',
  'upgradePlan',
  'payRenewal',
] as const;

export const HELIUS_WALLET_ACTIONS = [
  'getBalance',
  'getTokenBalances',
  'getWalletBalances',
  'getWalletHistory',
  'getWalletTransfers',
  'getWalletIdentity',
  'batchWalletIdentity',
  'getWalletFundedBy',
] as const;

export const HELIUS_ASSET_ACTIONS = [
  'getAsset',
  'getAssetsByOwner',
  'searchAssets',
  'getAssetsByGroup',
  'getAssetProof',
  'getAssetProofBatch',
  'getSignaturesForAsset',
  'getNftEditions',
  'getTokenHolders',
] as const;

export const HELIUS_TRANSACTION_ACTIONS = [
  'parseTransactions',
  'getTransactionHistory',
] as const;

export const HELIUS_CHAIN_ACTIONS = [
  'getAccountInfo',
  'getTokenAccounts',
  'getProgramAccounts',
  'getBlock',
  'getNetworkStatus',
  'getPriorityFeeEstimate',
  'getStakeAccounts',
  'getWithdrawableAmount',
] as const;

export const HELIUS_STREAMING_ACTIONS = [
  'createWebhook',
  'getAllWebhooks',
  'getWebhookByID',
  'updateWebhook',
  'deleteWebhook',
  'transactionSubscribe',
  'accountSubscribe',
  'laserstreamSubscribe',
] as const;

export const HELIUS_KNOWLEDGE_ACTIONS = [
  'lookupHeliusDocs',
  'listHeliusDocTopics',
  'getHeliusCreditsInfo',
  'getRateLimitInfo',
  'troubleshootError',
  'recommendStack',
  'getSIMD',
  'listSIMDs',
  'searchSolanaDocs',
  'readSolanaSourceFile',
  'fetchHeliusBlog',
  'getPumpFunGuide',
  'getSenderInfo',
  'getWebhookGuide',
  'getLatencyComparison',
  'getEnhancedWebSocketInfo',
  'getLaserstreamInfo',
] as const;

export const HELIUS_WRITE_ACTIONS = [
  'transferSol',
  'transferToken',
  'stakeSOL',
  'unstakeSOL',
  'withdrawStake',
] as const;

export const HELIUS_COMPRESSION_ACTIONS = [
  'getCompressedAccount',
  'getCompressedAccountsByOwner',
  'getMultipleCompressedAccounts',
  'getCompressedBalance',
  'getCompressedBalanceByOwner',
  'getCompressedMintTokenHolders',
  'getCompressedTokenAccountBalance',
  'getCompressedTokenAccountsByOwner',
  'getCompressedTokenAccountsByDelegate',
  'getCompressedTokenBalancesByOwnerV2',
  'getCompressedAccountProof',
  'getMultipleCompressedAccountProofs',
  'getMultipleNewAddressProofs',
  'getCompressionSignaturesForAccount',
  'getCompressionSignaturesForAddress',
  'getCompressionSignaturesForOwner',
  'getCompressionSignaturesForTokenOwner',
  'getLatestCompressionSignatures',
  'getLatestNonVotingSignatures',
  'getTransactionWithCompressionInfo',
  'getValidityProof',
  'getIndexerHealth',
  'getIndexerSlot',
] as const;

export const LEGACY_ACTIONS = [
  ...HELIUS_ACCOUNT_ACTIONS,
  ...HELIUS_WALLET_ACTIONS,
  ...HELIUS_ASSET_ACTIONS,
  ...HELIUS_TRANSACTION_ACTIONS,
  ...HELIUS_CHAIN_ACTIONS,
  ...HELIUS_STREAMING_ACTIONS,
  ...HELIUS_KNOWLEDGE_ACTIONS,
  ...HELIUS_WRITE_ACTIONS,
  ...HELIUS_COMPRESSION_ACTIONS,
] as const;

export type LegacyActionName = typeof LEGACY_ACTIONS[number];

export const LEGACY_ACTION_SET = new Set<string>(LEGACY_ACTIONS);
