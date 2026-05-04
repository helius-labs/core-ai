import type { ActionName } from './actions.js';

/**
 * Map of actions to their required top-level parameters.
 *
 * Only actions with unambiguous required fields are listed here.
 * Actions with "one-of" requirements (e.g. getAsset needs `id` OR `ids`)
 * or no required params are omitted — those rely on bespoke handler validation.
 */
export const ACTION_REQUIRED_PARAMS: Partial<Record<ActionName, string[]>> = {
  // Wallet
  getBalance: ['address'],
  getTokenBalances: ['address'],
  getWalletBalances: ['address'],
  getWalletHistory: ['address'],
  getWalletTransfers: ['address'],
  getWalletIdentity: ['address'],
  batchWalletIdentity: ['addresses'],
  getWalletFundedBy: ['address'],
  scoreWallet: ['address'],

  // Transaction
  parseTransactions: ['signatures'],
  getTransactionHistory: ['address'],

  // Asset
  getAssetsByOwner: ['address'],
  getAssetsByGroup: ['groupKey', 'groupValue'],
  getAssetProof: ['id'],
  getAssetProofBatch: ['ids'],
  getSignaturesForAsset: ['id'],
  getNftEditions: ['mint'],

  // Chain
  getTokenHolders: ['mint'],
  getProgramAccounts: ['programId'],
  getBlock: ['slot'],
  getWithdrawableAmount: ['stakeAccount'],

  // Streaming
  createWebhook: ['webhookURL', 'accountAddresses'],
  getWebhookByID: ['webhookID'],
  updateWebhook: ['webhookID'],
  deleteWebhook: ['webhookID'],
  accountSubscribe: ['account'],

  // Knowledge
  troubleshootError: ['errorCode'],
  recommendStack: ['description'],
  getSIMD: ['number'],
  searchSolanaDocs: ['query'],
  readSolanaSourceFile: ['path'],
  compareHeliusPlans: ['category'],

  // Write
  transferSol: ['recipientAddress'],
  transferToken: ['recipientAddress', 'mintAddress'],
  stakeSOL: ['amount'],
  unstakeSOL: ['stakeAccount'],
  withdrawStake: ['stakeAccount'],

  // Compression
  getCompressedAccountsByOwner: ['owner'],
  getCompressedBalanceByOwner: ['owner'],
  getCompressedMintTokenHolders: ['mint'],
  getCompressedTokenAccountsByOwner: ['owner'],
  getCompressedTokenAccountsByDelegate: ['delegate'],
  getCompressedTokenBalancesByOwnerV2: ['owner'],
  getCompressedAccountProof: ['hash'],
  getCompressionSignaturesForAccount: ['hash'],
  getCompressionSignaturesForAddress: ['address'],
  getCompressionSignaturesForOwner: ['owner'],
  getCompressionSignaturesForTokenOwner: ['owner'],
  getTransactionWithCompressionInfo: ['signature'],
};
