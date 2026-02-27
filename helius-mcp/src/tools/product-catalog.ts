// ─── Product Catalog ───
//
// Centralized product definitions — each Helius product defined once with its
// invariant properties. Templates reference products by catalog key and only
// carry project-specific fields (plainEnglish, why, callPattern).

export interface CatalogProduct {
  name: string;
  mcpTools: string[];
  creditCostPerCall: string;
  minimumPlan: string;
}

export const PRODUCT_CATALOG: Record<string, CatalogProduct> = {
  'das-api': {
    name: 'DAS API',
    mcpTools: ['getAssetsByOwner', 'getAssetsByGroup', 'searchAssets', 'getAsset', 'getTokenBalances', 'getTokenAccounts'],
    creditCostPerCall: '10 credits',
    minimumPlan: 'free',
  },
  'standard-rpc': {
    name: 'Standard RPC',
    mcpTools: ['getBalance', 'getAccountInfo', 'getBlock', 'getNetworkStatus'],
    creditCostPerCall: '1-10 credits',
    minimumPlan: 'free',
  },
  'enhanced-transactions': {
    name: 'Enhanced Transactions API',
    mcpTools: ['parseTransactions', 'getTransactionHistory'],
    creditCostPerCall: '100 credits',
    minimumPlan: 'free',
  },
  'wallet-api': {
    name: 'Wallet API',
    mcpTools: ['getWalletBalances', 'getWalletHistory', 'getWalletTransfers', 'getWalletIdentity', 'batchWalletIdentity', 'getWalletFundedBy'],
    creditCostPerCall: '100 credits',
    minimumPlan: 'developer',
  },
  'webhooks': {
    name: 'Webhooks',
    mcpTools: ['createWebhook', 'getAllWebhooks', 'updateWebhook', 'deleteWebhook'],
    creditCostPerCall: '100 credits to create, 1 credit per event',
    minimumPlan: 'free',
  },
  'enhanced-websockets': {
    name: 'Enhanced WebSockets',
    mcpTools: ['transactionSubscribe', 'accountSubscribe', 'getEnhancedWebSocketInfo'],
    creditCostPerCall: '3 credits per 0.1 MB streamed',
    minimumPlan: 'business',
  },
  'helius-sender': {
    name: 'Helius Sender',
    mcpTools: ['getSenderInfo'],
    creditCostPerCall: '0 credits',
    minimumPlan: 'free',
  },
  'priority-fee': {
    name: 'Priority Fee API',
    mcpTools: ['getPriorityFeeEstimate'],
    creditCostPerCall: '1 credit',
    minimumPlan: 'free',
  },
  'standard-websockets': {
    name: 'Standard WebSockets',
    mcpTools: ['transactionSubscribe'],
    creditCostPerCall: '3 credits per 0.1 MB streamed',
    minimumPlan: 'free',
  },
  'laserstream-devnet': {
    name: 'Laserstream (Devnet)',
    mcpTools: ['laserstreamSubscribe', 'getLaserstreamInfo'],
    creditCostPerCall: '3 credits per 0.1 MB streamed',
    minimumPlan: 'developer',
  },
  'laserstream-mainnet': {
    name: 'Laserstream (Mainnet)',
    mcpTools: ['laserstreamSubscribe', 'getLaserstreamInfo'],
    creditCostPerCall: '3 credits per 0.1 MB streamed',
    minimumPlan: 'professional',
  },
  'token-holders': {
    name: 'Token Holders',
    mcpTools: ['getTokenHolders'],
    creditCostPerCall: '20 credits',
    minimumPlan: 'free',
  },
};
