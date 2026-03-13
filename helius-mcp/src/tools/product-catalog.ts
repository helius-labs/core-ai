// ─── Product Catalog ───
//
// Centralized product definitions — each Helius product defined once with its
// invariant properties. The recommend tool groups products by minimumPlan into
// tiers and uses the description field to give AI consumers rich context.

export interface CatalogProduct {
  name: string;
  mcpTools: string[];
  creditCostPerCall: string;
  minimumPlan: string;
  docKey: string;
  referenceFile?: string;
  description: string;
}

// ─── Plan Ranking ───
// Pure data constant — lives here (zero imports) to avoid circular dependencies.

export const PLAN_RANK: Record<string, number> = { free: 0, developer: 1, business: 2, professional: 3 };

export const PRODUCT_CATALOG: Record<string, CatalogProduct> = {
  'das-api': {
    name: 'DAS API',
    mcpTools: ['getAssetsByOwner', 'getAssetsByGroup', 'searchAssets', 'getAsset', 'getTokenBalances', 'getTokenAccounts'],
    creditCostPerCall: '10 credits',
    minimumPlan: 'free',
    docKey: 'das',
    referenceFile: 'references/das.md',
    description: 'Query tokens, NFTs, collections, and digital assets. Fetches wallet token holdings with names, symbols, and prices. Browse NFT collections, search assets by creator/authority/owner.',
  },
  'standard-rpc': {
    name: 'Standard RPC',
    mcpTools: ['getBalance', 'getAccountInfo', 'getBlock', 'getNetworkStatus'],
    creditCostPerCall: '1-10 credits',
    minimumPlan: 'free',
    docKey: 'rpc',
    description: 'Core Solana RPC for native SOL balances, account data, block info, and network status. Foundation for any Solana app.',
  },
  'enhanced-transactions': {
    name: 'Enhanced Transactions API',
    mcpTools: ['parseTransactions', 'getTransactionHistory'],
    creditCostPerCall: '100 credits',
    minimumPlan: 'free',
    docKey: 'enhanced-transactions',
    referenceFile: 'references/enhanced-transactions.md',
    description: 'Parse any transaction into human-readable format with types (SWAP, TRANSFER, NFT_SALE), descriptions, token transfers, and fees. Powers transaction history views and trade verification.',
  },
  'wallet-api': {
    name: 'Wallet API',
    mcpTools: ['getWalletBalances', 'getWalletHistory', 'getWalletTransfers', 'getWalletIdentity', 'batchWalletIdentity', 'getWalletFundedBy'],
    creditCostPerCall: '100 credits',
    minimumPlan: 'developer',
    docKey: 'wallet-api',
    referenceFile: 'references/wallet-api.md',
    description: 'Portfolio balances with USD prices sorted by value, transfer history with sender/receiver, entity identification (exchanges, protocols, whales), and wallet funding source tracking. Purpose-built for wallet-centric features \u2014 more data in fewer calls than DAS + RPC.',
  },
  'webhooks': {
    name: 'Webhooks',
    mcpTools: ['createWebhook', 'getAllWebhooks', 'updateWebhook', 'deleteWebhook'],
    creditCostPerCall: '100 credits to create, 1 credit per event',
    minimumPlan: 'free',
    docKey: 'webhooks',
    referenceFile: 'references/webhooks.md',
    description: 'HTTP POST notifications when monitored addresses have on-chain activity. Event-driven architecture without polling. Monitor up to 100k addresses per webhook. Filter by 150+ transaction types (SWAP, NFT_SALE, TRANSFER, etc.).',
  },
  'enhanced-websockets': {
    name: 'Enhanced WebSockets',
    mcpTools: ['transactionSubscribe', 'accountSubscribe', 'getEnhancedWebSocketInfo'],
    creditCostPerCall: '3 credits per 0.1 MB streamed',
    minimumPlan: 'business',
    docKey: 'enhanced-websockets',
    referenceFile: 'references/websockets.md',
    description: 'Real-time transaction and account streaming over persistent WebSocket connections. 1.5-2x faster than standard WebSockets with advanced filtering (up to 50k addresses per filter). Powers live dashboards and real-time UIs.',
  },
  'helius-sender': {
    name: 'Helius Sender',
    mcpTools: ['getSenderInfo'],
    creditCostPerCall: '0 credits',
    minimumPlan: 'free',
    docKey: 'sender',
    referenceFile: 'references/sender.md',
    description: 'Submit transactions with SWQoS routing, staked connections, and Jito tip integration for optimal landing rates. Essential for trading bots, token launches, and any app that sends transactions.',
  },
  'priority-fee': {
    name: 'Priority Fee API',
    mcpTools: ['getPriorityFeeEstimate'],
    creditCostPerCall: '1 credit',
    minimumPlan: 'free',
    docKey: 'priority-fee',
    referenceFile: 'references/priority-fees.md',
    description: 'Real-time fee estimates for transaction prioritization during network congestion. Returns recommended fees at multiple priority levels (Min, Low, Medium, High, VeryHigh).',
  },
  'standard-websockets': {
    name: 'Standard WebSockets',
    mcpTools: ['transactionSubscribe'],
    creditCostPerCall: '3 credits per 0.1 MB streamed',
    minimumPlan: 'free',
    docKey: 'websocket',
    referenceFile: 'references/websockets.md',
    description: 'Persistent connection for real-time transaction and account updates using standard Solana WebSocket subscriptions. Good for confirmation tracking and basic streaming.',
  },
  'laserstream-devnet': {
    name: 'Laserstream (Devnet)',
    mcpTools: ['laserstreamSubscribe', 'getLaserstreamInfo'],
    creditCostPerCall: '3 credits per 0.1 MB streamed',
    minimumPlan: 'developer',
    docKey: 'laserstream',
    referenceFile: 'references/laserstream.md',
    description: 'High-performance gRPC streaming for development and testing. Subscribe to slots, accounts, transactions, blocks, or entries. Test streaming pipelines with production-grade infrastructure on devnet.',
  },
  'laserstream-mainnet': {
    name: 'Laserstream (Mainnet)',
    mcpTools: ['laserstreamSubscribe', 'getLaserstreamInfo'],
    creditCostPerCall: '3 credits per 0.1 MB streamed',
    minimumPlan: 'professional',
    docKey: 'laserstream',
    referenceFile: 'references/laserstream.md',
    description: 'Lowest-latency gRPC streaming with 24h historical replay for production indexers, trading infrastructure, and data pipelines. Subscribe to all transactions, accounts, blocks, or entries on mainnet.',
  },
  'token-transfers': {
    name: 'Token Transfers',
    mcpTools: ['transferSol', 'transferToken'],
    creditCostPerCall: '~3-13 credits + on-chain fees',
    minimumPlan: 'free',
    docKey: 'sender',
    referenceFile: 'references/sender.md',
    description: 'Send native SOL or SPL tokens from the MCP keypair to any Solana address. Uses Helius Sender for optimal landing rates. Requires a configured keypair.',
  },
  'zk-compression': {
    name: 'ZK Compression',
    mcpTools: [
      'getCompressedAccount', 'getCompressedAccountsByOwner', 'getMultipleCompressedAccounts',
      'getCompressedBalance', 'getCompressedBalanceByOwner',
      'getCompressedMintTokenHolders', 'getCompressedTokenAccountBalance',
      'getCompressedTokenAccountsByOwner', 'getCompressedTokenAccountsByDelegate',
      'getCompressedTokenBalancesByOwnerV2',
      'getCompressedAccountProof', 'getMultipleCompressedAccountProofs', 'getMultipleNewAddressProofs',
      'getCompressionSignaturesForAccount', 'getCompressionSignaturesForAddress',
      'getCompressionSignaturesForOwner', 'getCompressionSignaturesForTokenOwner',
      'getLatestCompressionSignatures', 'getLatestNonVotingSignatures',
      'getTransactionWithCompressionInfo', 'getValidityProof',
      'getIndexerHealth', 'getIndexerSlot',
    ],
    creditCostPerCall: '10 credits',
    minimumPlan: 'free',
    docKey: 'zk-compression',
    referenceFile: 'references/zk-compression.md',
    description: 'Query compressed accounts, token balances, Merkle proofs, validity proofs, and compression transaction history via the ZK Compression / Light Protocol indexer. Powers state compression for cost-efficient on-chain data storage.',
  },
  'token-holders': {
    name: 'Token Holders',
    mcpTools: ['getTokenHolders'],
    creditCostPerCall: '20 credits',
    minimumPlan: 'free',
    docKey: 'das',
    referenceFile: 'references/das.md',
    description: 'Top 20 holders of any SPL token. Check token distribution, find whale wallets, verify decentralization. Useful for token launches and analytics.',
  },
};
