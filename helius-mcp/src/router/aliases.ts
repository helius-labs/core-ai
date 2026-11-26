import type { ActionName } from './actions.js';

export type ActionAlias = {
  action: ActionName;
  /** What to pass so the action does the alias's job, when that is not obvious. */
  note?: string;
};

/**
 * Method names models reach for from the Solana RPC, DAS, and Helius APIs,
 * mapped to the action that does that job here.
 *
 * Dispatch never runs an alias. It answers with the call to make instead,
 * because an alias rarely means exactly the same thing: getSignaturesForAddress
 * returns signatures, while getTransactionHistory parses by default. One extra
 * round trip is cheaper than a confident wrong result.
 */
export const ACTION_ALIASES: Readonly<Record<string, ActionAlias>> = {
  // Solana RPC
  getSignaturesForAddress: { action: 'getTransactionHistory', note: 'mode "signatures" returns signatures only' },
  getTransaction: { action: 'parseTransactions', note: 'pass the signature in signatures' },
  getParsedTransaction: { action: 'parseTransactions', note: 'pass the signature in signatures' },
  getParsedTransactions: { action: 'parseTransactions' },
  getTokenAccountsByOwner: { action: 'getTokenAccounts', note: 'pass the wallet as owner' },
  getParsedTokenAccountsByOwner: { action: 'getTokenAccounts', note: 'pass the wallet as owner' },
  getMultipleAccounts: { action: 'getAccountInfo', note: 'pass up to 100 addresses' },
  getParsedAccountInfo: { action: 'getAccountInfo', note: 'encoding "jsonParsed"' },
  getTokenLargestAccounts: { action: 'getTokenHolders' },
  getRecentPrioritizationFees: { action: 'getPriorityFeeEstimate' },
  getSlot: { action: 'getNetworkStatus' },
  getEpochInfo: { action: 'getNetworkStatus' },
  getBlockHeight: { action: 'getNetworkStatus' },
  getVersion: { action: 'getNetworkStatus' },
  getSupply: { action: 'getNetworkStatus' },

  // Helius RPC extensions
  getTransactionsForAddress: { action: 'getTransactionHistory', note: 'mode "raw" returns the same raw data' },
  getProgramAccountsV2: { action: 'getProgramAccounts' },
  getTokenAccountsByOwnerV2: { action: 'getTokenAccounts', note: 'pass the wallet as owner' },

  // DAS
  getAssetBatch: { action: 'getAsset', note: 'pass ids' },
  getAssetsByCreator: { action: 'searchAssets', note: 'pass creatorAddress' },
  getAssetsByAuthority: { action: 'searchAssets', note: 'pass authorityAddress' },

  // ZK Compression
  getCompressedTokenBalancesByOwner: { action: 'getCompressedTokenBalancesByOwnerV2' },

  // Webhooks
  getWebhooks: { action: 'getAllWebhooks' },
  getWebhook: { action: 'getWebhookByID' },
};
