// ─── Product Catalog ───
//
// Centralized product definitions — each Helius product defined once with its
// invariant properties. The recommend tool groups products by minimumPlan into
// tiers and uses the description field to give AI consumers rich context.

export interface CatalogProduct {
  name: string;
  /** MCP actions that use this product. Empty only when `integration` says how an app uses it instead. */
  mcpTools: string[];
  creditCostPerCall: string;
  minimumPlan: string;
  docKey: string;
  referenceFile?: string;
  description: string;
  /** Lifecycle label shown next to the name. Omitted for generally available products. */
  status?: 'beta' | 'legacy';
  /** How an app calls the product directly (endpoint or SDK entry point). Required when no MCP action uses it. */
  integration?: string;
}

// ─── Plan Ranking ───
// Pure data constant — lives here (zero imports) to avoid circular dependencies.

// Plan tiers, lowest to highest. The MCP/CLI signup flow uses Agent as the
// entry tier (the dashboard's Free tier is not reachable through this surface).
export const PLAN_RANK: Record<string, number> = { agent: 0, developer: 1, business: 2, professional: 3 };

export const PRODUCT_CATALOG: Record<string, CatalogProduct> = {
  'das-api': {
    name: 'DAS API',
    mcpTools: ['getAssetsByOwner', 'getAssetsByGroup', 'searchAssets', 'getAsset', 'getTokenBalances', 'getTokenAccounts'],
    creditCostPerCall: '10 credits',
    minimumPlan: 'agent',
    docKey: 'das',
    referenceFile: 'references/das.md',
    description: 'Query tokens, NFTs, collections, and digital assets. Fetches wallet token holdings with names, symbols, and prices. Browse NFT collections, search assets by creator/authority/owner.',
  },
  'standard-rpc': {
    name: 'Standard RPC',
    mcpTools: ['getBalance', 'getAccountInfo', 'getBlock', 'getNetworkStatus'],
    creditCostPerCall: '1-10 credits',
    minimumPlan: 'agent',
    docKey: 'rpc',
    description: 'Core Solana RPC for native SOL balances, account data, block info, and network status. Foundation for any Solana app.',
  },
  'enhanced-transactions': {
    name: 'Enhanced Transactions API',
    mcpTools: [],
    creditCostPerCall: '100 credits',
    minimumPlan: 'agent',
    docKey: 'enhanced-transactions',
    referenceFile: 'references/enhanced-transactions.md',
    status: 'legacy',
    integration: 'REST `POST /v0/transactions` and `GET /v0/addresses/{address}/transactions`, or `helius.enhanced` in helius-sdk (deprecated since 3.3.0). The MCP uses it only on devnet, where Parsed Events is unavailable.',
    description: 'Parse any transaction into human-readable format with types (SWAP, TRANSFER, NFT_SALE), descriptions, token transfers, and fees. In maintenance mode: prefer Parsed Events for new builds, at a tenth of the credit cost.',
  },
  'parsed-events': {
    name: 'Parsed Events API',
    mcpTools: ['parseTransactions', 'getTransactionHistory'],
    creditCostPerCall: '10 credits per request',
    minimumPlan: 'agent',
    docKey: 'parsed-events',
    integration: 'REST `POST https://mainnet.helius-rpc.com/v1/parsed-events/transactions` and `/v1/parsed-events/transaction-history`, or `helius.parsedEvents.parseTransactions()` / `getTransactionHistory()` in helius-sdk 3.3.0+. Mainnet only.',
    description: 'Decode transactions through the IDL catalog into named instructions, arguments, and accounts, and fetch parsed transaction history for an address. Replaces the legacy Enhanced Transactions API.',
  },
  'wallet-api': {
    name: 'Wallet API',
    mcpTools: ['getWalletBalances', 'getWalletBalanceAt', 'getWalletHistory', 'getWalletTransfers'],
    creditCostPerCall: '100 credits',
    minimumPlan: 'agent',
    docKey: 'wallet-api',
    referenceFile: 'references/wallet-api.md',
    status: 'beta',
    description: 'Portfolio balances with USD prices sorted by value, exact historical balances at a point in time, balance changes per transaction, and transfer history with sender/receiver. Purpose-built for wallet-centric features \u2014 more data in fewer calls than DAS + RPC. Open on all plans.',
  },
  'wallet-identity': {
    name: 'Wallet Identity & Funding Source',
    mcpTools: ['getWalletIdentity', 'batchWalletIdentity', 'getWalletFundedBy'],
    creditCostPerCall: '100 credits',
    minimumPlan: 'developer',
    docKey: 'wallet-api',
    referenceFile: 'references/wallet-api.md',
    status: 'beta',
    description: 'Identify known entities behind an address (exchanges, protocols, whales), in bulk or one at a time, and trace who first funded a wallet. Part of the Wallet API; these endpoints return 403 on the Free plan.',
  },
  'webhooks': {
    name: 'Webhooks',
    mcpTools: ['createWebhook', 'getAllWebhooks', 'getWebhookByID', 'updateWebhook', 'deleteWebhook'],
    creditCostPerCall: '100 credits to create, 1 credit per event',
    minimumPlan: 'agent',
    docKey: 'webhooks',
    referenceFile: 'references/webhooks.md',
    description: 'HTTP POST notifications when monitored addresses have on-chain activity. Event-driven architecture without polling. Monitor up to 100k addresses per webhook. Filter by 150+ transaction types (SWAP, NFT_SALE, TRANSFER, etc.). For parsed real-time data in new builds, prefer Parsed Streams.',
  },
  'parsed-streams': {
    name: 'Parsed Streams',
    mcpTools: [],
    creditCostPerCall: '1 credit per delivered event',
    minimumPlan: 'agent',
    docKey: 'parsed-streams',
    integration: 'WebSocket `parsedTransactionSubscribe` on `wss://beta.helius-rpc.com`, or `makeParsedStreamsClient` from `helius-sdk/websockets/parsedStreams` (3.3.0+). `describeProgram` lists the instructions you can filter on.',
    description: 'Decoded transactions pushed over WebSocket as they land, filtered server-side by program, instruction name, and account role. Successor to Enhanced Transaction webhooks for parsed real-time pipelines. Up to 25 subscriptions per connection.',
  },
  'enhanced-websockets': {
    name: 'Enhanced WebSockets',
    mcpTools: ['transactionSubscribe', 'accountSubscribe', 'getEnhancedWebSocketInfo'],
    creditCostPerCall: '2 credits per 0.1 MB streamed',
    minimumPlan: 'developer',
    docKey: 'enhanced-websockets',
    referenceFile: 'references/websockets.md',
    description: 'Real-time transaction and account streaming over persistent WebSocket connections. 1.5-2x faster than standard WebSockets with advanced filtering (up to 50k addresses per filter). Powers live dashboards and real-time UIs.',
  },
  'helius-sender': {
    name: 'Helius Sender',
    mcpTools: ['getSenderInfo'],
    creditCostPerCall: '0 credits',
    minimumPlan: 'agent',
    docKey: 'sender',
    referenceFile: 'references/sender.md',
    description: 'Submit transactions with SWQoS routing, staked connections, and Jito tip integration for optimal landing rates. Essential for trading bots, token launches, and any app that sends transactions.',
  },
  'mev-protect': {
    name: 'MEV Protect',
    mcpTools: [],
    creditCostPerCall: 'Standard send pricing',
    minimumPlan: 'agent',
    docKey: 'mev-protect',
    integration: 'Add `mev-protect=true` to the send endpoint URL, or pass `mevProtect: true` to `createHelius()` or the Sender helpers in helius-sdk 3.3.0+.',
    description: 'Opt-in routing that keeps transactions away from validators statistically linked to sandwich attacks. Works with basic sendTransaction, sendBundle, Sender Max, and Sender SWQOS-only.',
  },
  'backrun-rebates': {
    name: 'Backrun Rebates',
    mcpTools: [],
    creditCostPerCall: 'Standard send pricing',
    minimumPlan: 'agent',
    docKey: 'backrun-rebates',
    integration: 'Add `rebate-address=<SOL address>` to a mainnet `sendTransaction` URL, or pass `rebateAddress` to `createHelius()`.',
    description: 'Earn 50% of the MEV your transaction creates, paid automatically to an address you choose. Opt-in; only single-transaction requests on mainnet qualify.',
  },
  'priority-fee': {
    name: 'Priority Fee API',
    mcpTools: ['getPriorityFeeEstimate'],
    creditCostPerCall: '1 credit',
    minimumPlan: 'agent',
    docKey: 'priority-fee',
    referenceFile: 'references/priority-fees.md',
    description: 'Real-time fee estimates for transaction prioritization during network congestion. Returns recommended fees at multiple priority levels (Min, Low, Medium, High, VeryHigh).',
  },
  'standard-websockets': {
    name: 'Standard WebSockets',
    mcpTools: ['transactionSubscribe'],
    creditCostPerCall: '2 credits per 0.1 MB streamed',
    minimumPlan: 'agent',
    docKey: 'websocket',
    referenceFile: 'references/websockets.md',
    description: 'Persistent connection for real-time transaction and account updates using standard Solana WebSocket subscriptions. Good for confirmation tracking and basic streaming.',
  },
  'laserstream-devnet': {
    name: 'Laserstream (Devnet)',
    mcpTools: ['laserstreamSubscribe', 'getLaserstreamInfo'],
    creditCostPerCall: '2 credits per 0.1 MB streamed',
    minimumPlan: 'developer',
    docKey: 'laserstream',
    referenceFile: 'references/laserstream.md',
    description: 'High-performance gRPC streaming for development and testing. Subscribe to slots, accounts, transactions, blocks, or entries. Test streaming pipelines with production-grade infrastructure on devnet.',
  },
  'laserstream-mainnet': {
    name: 'Laserstream (Mainnet)',
    mcpTools: ['laserstreamSubscribe', 'getLaserstreamInfo'],
    creditCostPerCall: '2 credits per 0.1 MB streamed',
    minimumPlan: 'business',
    docKey: 'laserstream',
    referenceFile: 'references/laserstream.md',
    description: 'Lowest-latency gRPC streaming with 48-hour historical replay for production indexers, trading infrastructure, and data pipelines. Subscribe to all transactions, accounts, blocks, or entries on mainnet.',
  },
  'pre-confirmations': {
    name: 'Preconfirmations',
    mcpTools: [],
    creditCostPerCall: '10 credits per message, 300-credit minimum per subscription in slots that deliver messages',
    minimumPlan: 'developer',
    docKey: 'pre-confirmations',
    integration: 'WebSocket `preconfSubscribe` on `wss://beta.helius-rpc.com`, or `makePreconfWsClientForApiKey` from `helius-sdk/websockets/preconfWs` (3.1.0+). `getPreConfCoverage` reports current coverage.',
    description: 'The earliest transaction signal on Solana: transactions streamed before they are shredded, with execution status from Helius and pre-execution signals from Jito BAM. Filter by account, signer, signature, instruction, region, and source. Built for latency-critical trading.',
  },
  'preprocessed-transactions': {
    name: 'Preprocessed Transactions',
    mcpTools: [],
    creditCostPerCall: '0.1 credits per message',
    minimumPlan: 'developer',
    docKey: 'preprocessed-transactions',
    status: 'beta',
    integration: 'WebSocket `preprocessedSubscribe` on `wss://beta.helius-rpc.com`. No SDK helper yet. 10 concurrent connections per API key.',
    description: 'Pre-execution transaction data over WebSocket without deshredding, filtered by included, excluded, or required accounts. Successor to the preprocessed LaserStream gRPC feed, which will be deprecated.',
  },
  'gatekeeper': {
    name: 'Gatekeeper',
    mcpTools: [],
    creditCostPerCall: 'No additional cost',
    minimumPlan: 'agent',
    docKey: 'gatekeeper',
    status: 'beta',
    integration: 'Replace `mainnet.helius-rpc.com` with `beta.helius-rpc.com` for HTTP and WebSocket traffic. LaserStream is not yet available on it.',
    description: 'Opt-in next-generation endpoint for Helius RPC, WebSockets, DAS, ZK Compression, and Priority Fees, slated to become the default. It is also the only host for Parsed Streams, Preconfirmations, and Preprocessed Transactions.',
  },
  'token-transfers': {
    name: 'Token Transfers',
    mcpTools: ['transferSol', 'transferToken'],
    creditCostPerCall: '~3-13 credits + on-chain fees',
    minimumPlan: 'agent',
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
    minimumPlan: 'agent',
    docKey: 'zk-compression',
    referenceFile: 'references/zk-compression.md',
    description: 'Query compressed accounts, token balances, Merkle proofs, validity proofs, and compression transaction history via the ZK Compression / Light Protocol indexer. Powers state compression for cost-efficient on-chain data storage.',
  },
  'native-staking': {
    name: 'Native Staking',
    mcpTools: ['stakeSOL', 'unstakeSOL', 'withdrawStake', 'getStakeAccounts', 'getWithdrawableAmount'],
    creditCostPerCall: '~3-10 credits + on-chain fees',
    minimumPlan: 'agent',
    docKey: 'sender',
    referenceFile: 'references/sender.md',
    description: 'Stake, unstake, and withdraw native SOL via the Helius validator. Earn staking yield with one-click delegation. Query stake accounts and withdrawable amounts.',
  },
  'token-holders': {
    name: 'Token Holders',
    mcpTools: ['getTokenHolders'],
    creditCostPerCall: '20 credits',
    minimumPlan: 'agent',
    docKey: 'das',
    referenceFile: 'references/das.md',
    description: 'Top 20 holders of any SPL token. Check token distribution, find whale wallets, verify decentralization. Useful for token launches and analytics.',
  },
  'admin-api': {
    name: 'Admin API',
    mcpTools: [],
    creditCostPerCall: 'Rate-limited to 5 requests/s per project',
    minimumPlan: 'agent',
    docKey: 'admin-api',
    integration: '`GET https://admin-api.helius.xyz/v0/admin/projects/{projectId}/usage` with an `X-Api-Key` header, or `helius.admin.getProjectUsage(projectId)`. The key must belong to that project.',
    description: 'Credits used and remaining, the current credit cycle, subscription details, and per-service request counts for a project. For internal dashboards, usage alerts, and billing pipelines.',
  },
  'waas': {
    name: 'Wallet-as-a-Service',
    mcpTools: [],
    creditCostPerCall: '200 credits per signature',
    minimumPlan: 'developer',
    docKey: 'waas',
    status: 'beta',
    integration: '`HeliusWalletProvider` and `useHeliusWallet` from the `helius-wallet-kit` npm package (React 18+). Signing happens client-side, so an API key alone cannot sign.',
    description: 'Non-custodial embedded Solana wallets with passkey or email sign-in and no seed phrases. Keys are secured in Turnkey enclaves. For consumer apps that need wallets without a browser extension.',
  },
  'privacy': {
    name: 'Helius Privacy',
    mcpTools: [],
    creditCostPerCall: 'Devnet beta; pricing not published',
    minimumPlan: 'agent',
    docKey: 'privacy',
    status: 'beta',
    integration: '`@heliuslabs/zolana` (TypeScript, with @solana/kit) or `zolana-client` (Rust), against devnet.',
    description: 'Confidential transfers secured by zero-knowledge proofs that settle onchain in a single Solana transaction. Devnet only; mainnet has not launched.',
  },
};
