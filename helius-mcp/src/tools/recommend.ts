import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpText } from '../utils/errors.js';
import { hasApiKey } from '../utils/helius.js';
import { getPreferences, savePreferences, getJwt } from '../utils/config.js';
import { HELIUS_PLANS } from './plans.js';
import { listProjects } from 'helius-sdk/auth/listProjects';
import { getProject } from 'helius-sdk/auth/getProject';
import { MCP_USER_AGENT } from '../http.js';

// ─── Types ───

interface ProductRecommendation {
  product: string;
  plainEnglish: string;
  why: string;
  mcpTools: string[];
  creditCostPerCall: string;
  callPattern: string;
  minimumPlan: string;
}

interface TierRecommendation {
  tier: 'budget' | 'standard' | 'production';
  minimumPlan: string;
  complexity: 'low' | 'medium' | 'high';
  products: ProductRecommendation[];
  limitations: string[];
  references: string[];
}

interface ProjectTemplate {
  name: string;
  description: string;
  tiers: TierRecommendation[];
}

// ─── Known MCP Tools (for validation script) ───

export const KNOWN_TOOLS = new Set([
  'getStarted', 'setHeliusApiKey', 'generateKeypair', 'checkSignupBalance',
  'agenticSignup', 'getAccountStatus', 'previewUpgrade', 'upgradePlan', 'payRenewal',
  'getBalance', 'getTokenBalances', 'getWalletBalances',
  'parseTransactions', 'getTransactionHistory', 'getWalletHistory', 'getWalletTransfers',
  'getAsset', 'getAssetsByOwner', 'searchAssets', 'getAssetsByGroup',
  'getAssetProof', 'getAssetProofBatch', 'getSignaturesForAsset', 'getNftEditions',
  'getAccountInfo', 'getTokenAccounts', 'getProgramAccounts', 'getTokenHolders',
  'getBlock', 'getNetworkStatus',
  'getPriorityFeeEstimate',
  'createWebhook', 'getAllWebhooks', 'getWebhookByID', 'updateWebhook', 'deleteWebhook',
  'transactionSubscribe', 'accountSubscribe', 'getEnhancedWebSocketInfo',
  'laserstreamSubscribe', 'getLaserstreamInfo',
  'getWalletIdentity', 'batchWalletIdentity', 'getWalletFundedBy',
  'getHeliusPlanInfo', 'compareHeliusPlans',
  'lookupHeliusDocs', 'listHeliusDocTopics', 'getHeliusCreditsInfo', 'getRateLimitInfo',
  'troubleshootError', 'getSenderInfo', 'getWebhookGuide', 'getLatencyComparison', 'getPumpFunGuide',
  'recommendStack',
]);

// ─── Plan Ranking ───

const PLAN_RANK: Record<string, number> = { free: 0, developer: 1, business: 2, professional: 3 };

function planAtOrBelow(plan: string, maxPlan: string): boolean {
  return (PLAN_RANK[plan] ?? 99) <= (PLAN_RANK[maxPlan] ?? 99);
}

// ─── Template Catalog ───

const PROJECT_TEMPLATES: Record<string, ProjectTemplate> = {
  'portfolio-tracker': {
    name: 'Portfolio Tracker',
    description: 'Track wallet balances, token holdings, and transaction history with optional real-time updates.',
    tiers: [
      {
        tier: 'budget',
        minimumPlan: 'free',
        complexity: 'low',
        products: [
          {
            product: 'DAS API',
            plainEnglish: 'Fetches all tokens in a wallet with names, symbols, and prices',
            why: 'One call gets the complete token list for a wallet',
            mcpTools: ['getTokenBalances', 'getAssetsByOwner'],
            creditCostPerCall: '10 credits',
            callPattern: '1 call per portfolio view',
            minimumPlan: 'free',
          },
          {
            product: 'Standard RPC',
            plainEnglish: 'Gets native SOL balance',
            why: 'DAS doesn\'t include SOL; this fills the gap',
            mcpTools: ['getBalance'],
            creditCostPerCall: '1 credit',
            callPattern: '1 call per portfolio view',
            minimumPlan: 'free',
          },
          {
            product: 'Enhanced Transactions API',
            plainEnglish: 'Parses transaction history into human-readable format',
            why: 'Shows users what happened in their past transactions',
            mcpTools: ['getTransactionHistory', 'parseTransactions'],
            creditCostPerCall: '100 credits',
            callPattern: '1 call per history page load',
            minimumPlan: 'free',
          },
        ],
        limitations: [
          'No real-time updates — users must refresh manually',
          '1M credits/month cap (Free plan)',
          'Rate limit: 10 RPS',
        ],
        references: ['references/das.md'],
      },
      {
        tier: 'standard',
        minimumPlan: 'developer',
        complexity: 'medium',
        products: [
          {
            product: 'Wallet API',
            plainEnglish: 'Gets all token balances with USD prices sorted by value in one call',
            why: 'Single call replaces DAS + RPC combo, includes USD pricing',
            mcpTools: ['getWalletBalances', 'getWalletHistory'],
            creditCostPerCall: '100 credits',
            callPattern: '1 call per portfolio view',
            minimumPlan: 'developer',
          },
          {
            product: 'Webhooks',
            plainEnglish: 'Sends notifications to your server when wallet activity happens',
            why: 'Event-driven updates instead of polling — more efficient and timely',
            mcpTools: ['createWebhook', 'getAllWebhooks'],
            creditCostPerCall: '100 credits to create, 1 credit per event',
            callPattern: '1 webhook per monitored wallet',
            minimumPlan: 'free',
          },
        ],
        limitations: [
          'Webhook delivery is near-real-time but not instant',
          '10M credits/month cap (Developer plan)',
          'No live UI streaming — webhooks are server-to-server',
        ],
        references: ['references/wallet-api.md', 'references/webhooks.md'],
      },
      {
        tier: 'production',
        minimumPlan: 'business',
        complexity: 'high',
        products: [
          {
            product: 'Wallet API',
            plainEnglish: 'Gets all token balances with USD prices sorted by value in one call',
            why: 'Production-grade portfolio data with built-in USD pricing',
            mcpTools: ['getWalletBalances', 'getWalletHistory', 'getWalletTransfers'],
            creditCostPerCall: '100 credits',
            callPattern: '1 call per portfolio view',
            minimumPlan: 'developer',
          },
          {
            product: 'Enhanced WebSockets',
            plainEnglish: 'Streams live transaction data to your app over a persistent connection',
            why: 'Real-time UI updates without polling — users see changes instantly',
            mcpTools: ['transactionSubscribe', 'accountSubscribe'],
            creditCostPerCall: '3 credits per 0.1 MB streamed',
            callPattern: '1 subscription per monitored wallet',
            minimumPlan: 'business',
          },
          {
            product: 'Webhooks',
            plainEnglish: 'Sends notifications to your server when wallet activity happens',
            why: 'Backend event processing while WebSockets handle the live UI',
            mcpTools: ['createWebhook'],
            creditCostPerCall: '100 credits to create, 1 credit per event',
            callPattern: '1 webhook per monitored wallet',
            minimumPlan: 'free',
          },
        ],
        limitations: [
          'Enhanced WebSockets require Business+ plan ($499/month)',
          'More complex architecture — WebSockets for frontend, webhooks for backend',
          '100M credits/month cap (Business plan)',
        ],
        references: ['references/wallet-api.md', 'references/websockets.md', 'references/webhooks.md'],
      },
    ],
  },

  'trading-bot': {
    name: 'Trading Bot',
    description: 'Automated trading with transaction sending, priority fees, and market data streaming.',
    tiers: [
      {
        tier: 'budget',
        minimumPlan: 'free',
        complexity: 'medium',
        products: [
          {
            product: 'Helius Sender',
            plainEnglish: 'Submits transactions with SWQoS routing for better landing rates',
            why: 'Optimal transaction submission is critical for trading — Sender provides staked connections and Jito integration',
            mcpTools: ['getSenderInfo'],
            creditCostPerCall: '0 credits',
            callPattern: '1 call per trade',
            minimumPlan: 'free',
          },
          {
            product: 'Priority Fee API',
            plainEnglish: 'Gets real-time fee estimates so your transactions land faster',
            why: 'Correct priority fees are essential for competitive trading',
            mcpTools: ['getPriorityFeeEstimate'],
            creditCostPerCall: '1 credit',
            callPattern: '1 call per transaction',
            minimumPlan: 'free',
          },
          {
            product: 'Enhanced Transactions API',
            plainEnglish: 'Parses swap/trade transactions into human-readable format',
            why: 'Verify trade results and track P&L',
            mcpTools: ['parseTransactions'],
            creditCostPerCall: '100 credits',
            callPattern: '1 call per trade verification',
            minimumPlan: 'free',
          },
        ],
        limitations: [
          'sendTransaction rate: 1/sec (Free plan) — limits trading frequency',
          'No real-time market data streaming',
          '1M credits/month cap',
        ],
        references: ['references/sender.md', 'references/priority-fees.md'],
      },
      {
        tier: 'standard',
        minimumPlan: 'developer',
        complexity: 'medium',
        products: [
          {
            product: 'Helius Sender',
            plainEnglish: 'Submits transactions with SWQoS routing for better landing rates',
            why: 'Higher send rate (5/sec) enables more frequent trading',
            mcpTools: ['getSenderInfo'],
            creditCostPerCall: '0 credits',
            callPattern: '1 call per trade',
            minimumPlan: 'free',
          },
          {
            product: 'Priority Fee API',
            plainEnglish: 'Gets real-time fee estimates so your transactions land faster',
            why: 'Correct priority fees are essential for competitive trading',
            mcpTools: ['getPriorityFeeEstimate'],
            creditCostPerCall: '1 credit',
            callPattern: '1 call per transaction',
            minimumPlan: 'free',
          },
          {
            product: 'Standard WebSockets',
            plainEnglish: 'Persistent connection for tracking transaction confirmations',
            why: 'Confirm trades landed without polling — saves credits and reduces latency',
            mcpTools: ['transactionSubscribe'],
            creditCostPerCall: '3 credits per 0.1 MB streamed',
            callPattern: '1 subscription for confirmation tracking',
            minimumPlan: 'free',
          },
        ],
        limitations: [
          'sendTransaction rate: 5/sec (Developer plan)',
          'Standard WebSockets only — no enhanced filtering',
          '10M credits/month cap',
        ],
        references: ['references/sender.md', 'references/priority-fees.md', 'references/websockets.md'],
      },
      {
        tier: 'production',
        minimumPlan: 'business',
        complexity: 'high',
        products: [
          {
            product: 'Helius Sender',
            plainEnglish: 'Submits transactions with SWQoS routing for better landing rates',
            why: 'High-frequency sending (50/sec) for production trading',
            mcpTools: ['getSenderInfo'],
            creditCostPerCall: '0 credits',
            callPattern: '1 call per trade',
            minimumPlan: 'free',
          },
          {
            product: 'Priority Fee API',
            plainEnglish: 'Gets real-time fee estimates so your transactions land faster',
            why: 'Critical for competitive trading at scale',
            mcpTools: ['getPriorityFeeEstimate'],
            creditCostPerCall: '1 credit',
            callPattern: '1 call per transaction',
            minimumPlan: 'free',
          },
          {
            product: 'Enhanced WebSockets',
            plainEnglish: 'Low-latency streaming for market data and confirmations',
            why: '1.5-2x faster than standard WebSockets — critical for trading speed',
            mcpTools: ['transactionSubscribe', 'accountSubscribe'],
            creditCostPerCall: '3 credits per 0.1 MB streamed',
            callPattern: 'Persistent subscriptions for market monitoring',
            minimumPlan: 'business',
          },
        ],
        limitations: [
          'sendTransaction rate: 50/sec (Business plan)',
          '100M credits/month cap',
          'For absolute lowest latency, Professional plan unlocks Laserstream gRPC',
        ],
        references: ['references/sender.md', 'references/priority-fees.md', 'references/websockets.md'],
      },
    ],
  },

  'nft-marketplace': {
    name: 'NFT Marketplace',
    description: 'Browse, search, and trade NFTs with collection pages, event monitoring, and transaction history.',
    tiers: [
      {
        tier: 'budget',
        minimumPlan: 'free',
        complexity: 'low',
        products: [
          {
            product: 'DAS API',
            plainEnglish: 'Queries NFTs by collection, creator, owner, or attributes',
            why: 'Core data layer for browsing and searching NFTs',
            mcpTools: ['getAssetsByOwner', 'getAssetsByGroup', 'searchAssets', 'getAsset'],
            creditCostPerCall: '10 credits',
            callPattern: '1 call per page/search',
            minimumPlan: 'free',
          },
          {
            product: 'Enhanced Transactions API',
            plainEnglish: 'Shows human-readable NFT sale and transfer history',
            why: 'Display provenance and trading history for each NFT',
            mcpTools: ['parseTransactions', 'getTransactionHistory'],
            creditCostPerCall: '100 credits',
            callPattern: '1 call per NFT detail page',
            minimumPlan: 'free',
          },
        ],
        limitations: [
          'No real-time sale/listing notifications',
          '1M credits/month — may be tight for active marketplaces',
          'Rate limit: 2 RPS for DAS (Free plan)',
        ],
        references: ['references/das.md', 'references/enhanced-transactions.md'],
      },
      {
        tier: 'standard',
        minimumPlan: 'developer',
        complexity: 'medium',
        products: [
          {
            product: 'DAS API',
            plainEnglish: 'Queries NFTs by collection, creator, owner, or attributes',
            why: 'Core data layer with higher rate limits (10 RPS)',
            mcpTools: ['getAssetsByOwner', 'getAssetsByGroup', 'searchAssets', 'getAsset'],
            creditCostPerCall: '10 credits',
            callPattern: '1 call per page/search',
            minimumPlan: 'free',
          },
          {
            product: 'Webhooks',
            plainEnglish: 'Sends notifications when NFT sales, listings, or transfers happen',
            why: 'Event-driven backend — update your database when on-chain events occur',
            mcpTools: ['createWebhook', 'getAllWebhooks'],
            creditCostPerCall: '100 credits to create, 1 credit per event',
            callPattern: '1 webhook per collection or marketplace program',
            minimumPlan: 'free',
          },
          {
            product: 'Enhanced Transactions API',
            plainEnglish: 'Shows human-readable NFT sale and transfer history',
            why: 'Rich transaction detail pages with parsed sale data',
            mcpTools: ['parseTransactions', 'getTransactionHistory'],
            creditCostPerCall: '100 credits',
            callPattern: '1 call per NFT detail page',
            minimumPlan: 'free',
          },
        ],
        limitations: [
          'No live UI updates — webhooks are server-to-server',
          '10M credits/month cap',
          'Webhook setup requires your own HTTP endpoint',
        ],
        references: ['references/das.md', 'references/webhooks.md', 'references/enhanced-transactions.md'],
      },
      {
        tier: 'production',
        minimumPlan: 'business',
        complexity: 'high',
        products: [
          {
            product: 'DAS API',
            plainEnglish: 'Queries NFTs by collection, creator, owner, or attributes',
            why: 'High-throughput queries (50 RPS) for production traffic',
            mcpTools: ['getAssetsByOwner', 'getAssetsByGroup', 'searchAssets', 'getAsset'],
            creditCostPerCall: '10 credits',
            callPattern: '1 call per page/search',
            minimumPlan: 'free',
          },
          {
            product: 'Webhooks',
            plainEnglish: 'Sends notifications when NFT sales, listings, or transfers happen',
            why: 'Backend event pipeline for indexing all marketplace activity',
            mcpTools: ['createWebhook', 'getAllWebhooks'],
            creditCostPerCall: '100 credits to create, 1 credit per event',
            callPattern: '1 webhook per collection or marketplace program',
            minimumPlan: 'free',
          },
          {
            product: 'Enhanced WebSockets',
            plainEnglish: 'Streams live NFT events to your frontend',
            why: 'Real-time sale feeds and activity dashboards without polling',
            mcpTools: ['transactionSubscribe'],
            creditCostPerCall: '3 credits per 0.1 MB streamed',
            callPattern: '1 subscription per marketplace program',
            minimumPlan: 'business',
          },
        ],
        limitations: [
          'Enhanced WebSockets require Business+ plan ($499/month)',
          '100M credits/month cap',
          'Complex architecture — DAS for reads, webhooks for backend, WebSockets for live UI',
        ],
        references: ['references/das.md', 'references/webhooks.md', 'references/websockets.md'],
      },
    ],
  },

  'blockchain-explorer': {
    name: 'Blockchain Explorer',
    description: 'Search and display transactions, blocks, accounts, and tokens with parsed human-readable data.',
    tiers: [
      {
        tier: 'budget',
        minimumPlan: 'free',
        complexity: 'low',
        products: [
          {
            product: 'Enhanced Transactions API',
            plainEnglish: 'Parses any transaction into human-readable format with types and descriptions',
            why: 'Core feature — transforms raw transaction data into something users can understand',
            mcpTools: ['parseTransactions', 'getTransactionHistory'],
            creditCostPerCall: '100 credits',
            callPattern: '1 call per transaction detail page',
            minimumPlan: 'free',
          },
          {
            product: 'Standard RPC',
            plainEnglish: 'Fetches account info, block data, and network status',
            why: 'Base layer for account/block explorer pages',
            mcpTools: ['getAccountInfo', 'getBlock', 'getNetworkStatus', 'getBalance'],
            creditCostPerCall: '1-10 credits',
            callPattern: '1-3 calls per page load',
            minimumPlan: 'free',
          },
          {
            product: 'DAS API',
            plainEnglish: 'Queries token and NFT metadata for display',
            why: 'Shows token names, images, and details on account pages',
            mcpTools: ['getAsset', 'getAssetsByOwner'],
            creditCostPerCall: '10 credits',
            callPattern: '1 call per token detail page',
            minimumPlan: 'free',
          },
        ],
        limitations: [
          'No real-time block/transaction streaming',
          '1M credits/month — may be tight for public explorers',
          'Rate limit: 10 RPS',
        ],
        references: ['references/enhanced-transactions.md', 'references/das.md'],
      },
      {
        tier: 'standard',
        minimumPlan: 'developer',
        complexity: 'medium',
        products: [
          {
            product: 'Enhanced Transactions API',
            plainEnglish: 'Parses any transaction into human-readable format with types and descriptions',
            why: 'Higher rate limits for serving more users',
            mcpTools: ['parseTransactions', 'getTransactionHistory'],
            creditCostPerCall: '100 credits',
            callPattern: '1 call per transaction detail page',
            minimumPlan: 'free',
          },
          {
            product: 'Standard RPC',
            plainEnglish: 'Fetches account info, block data, and network status',
            why: 'Higher throughput for concurrent page loads',
            mcpTools: ['getAccountInfo', 'getBlock', 'getNetworkStatus', 'getBalance'],
            creditCostPerCall: '1-10 credits',
            callPattern: '1-3 calls per page load',
            minimumPlan: 'free',
          },
          {
            product: 'Wallet API',
            plainEnglish: 'Gets complete wallet portfolio with USD values',
            why: 'Rich wallet detail pages with portfolio breakdown',
            mcpTools: ['getWalletBalances', 'getWalletHistory', 'getWalletIdentity'],
            creditCostPerCall: '100 credits',
            callPattern: '1 call per wallet detail page',
            minimumPlan: 'developer',
          },
        ],
        limitations: [
          'No live streaming for new blocks/transactions',
          '10M credits/month cap',
          'Wallet API requires Developer+ plan',
        ],
        references: ['references/enhanced-transactions.md', 'references/wallet-api.md'],
      },
      {
        tier: 'production',
        minimumPlan: 'business',
        complexity: 'high',
        products: [
          {
            product: 'Enhanced Transactions API',
            plainEnglish: 'Parses any transaction into human-readable format with types and descriptions',
            why: 'High-throughput parsing for production explorer',
            mcpTools: ['parseTransactions', 'getTransactionHistory'],
            creditCostPerCall: '100 credits',
            callPattern: '1 call per transaction detail page',
            minimumPlan: 'free',
          },
          {
            product: 'Wallet API',
            plainEnglish: 'Gets complete wallet portfolio with USD values and identity',
            why: 'Rich wallet pages with portfolio, history, and entity labels',
            mcpTools: ['getWalletBalances', 'getWalletHistory', 'getWalletIdentity'],
            creditCostPerCall: '100 credits',
            callPattern: '1 call per wallet detail page',
            minimumPlan: 'developer',
          },
          {
            product: 'Enhanced WebSockets',
            plainEnglish: 'Streams new transactions and account updates in real time',
            why: 'Live transaction feed and real-time account pages',
            mcpTools: ['transactionSubscribe', 'accountSubscribe'],
            creditCostPerCall: '3 credits per 0.1 MB streamed',
            callPattern: 'Persistent subscriptions for live pages',
            minimumPlan: 'business',
          },
        ],
        limitations: [
          'Enhanced WebSockets require Business+ plan ($499/month)',
          '100M credits/month cap',
          'Complex architecture — caching layer recommended for public explorers',
        ],
        references: ['references/enhanced-transactions.md', 'references/wallet-api.md', 'references/websockets.md'],
      },
    ],
  },

  'notification-system': {
    name: 'Notification System',
    description: 'Monitor wallets and programs for on-chain events, then send alerts via Telegram, Discord, email, or custom endpoints.',
    tiers: [
      {
        tier: 'budget',
        minimumPlan: 'free',
        complexity: 'low',
        products: [
          {
            product: 'Webhooks',
            plainEnglish: 'Sends HTTP POST to your server when monitored addresses have activity',
            why: 'Fire-and-forget event delivery — the simplest way to monitor on-chain events',
            mcpTools: ['createWebhook', 'getAllWebhooks', 'updateWebhook', 'deleteWebhook'],
            creditCostPerCall: '100 credits to create, 1 credit per event',
            callPattern: '1 webhook per set of monitored addresses (up to 100k addresses)',
            minimumPlan: 'free',
          },
        ],
        limitations: [
          'Webhook-only — no persistent streaming connection',
          '1M credits/month cap — limits number of events',
          'You need to host an HTTP endpoint to receive webhook POSTs',
        ],
        references: ['references/webhooks.md'],
      },
      {
        tier: 'standard',
        minimumPlan: 'developer',
        complexity: 'medium',
        products: [
          {
            product: 'Webhooks',
            plainEnglish: 'Sends HTTP POST to your server when monitored addresses have activity',
            why: 'Higher throughput for more addresses and events',
            mcpTools: ['createWebhook', 'getAllWebhooks', 'updateWebhook', 'deleteWebhook'],
            creditCostPerCall: '100 credits to create, 1 credit per event',
            callPattern: '1 webhook per set of monitored addresses',
            minimumPlan: 'free',
          },
          {
            product: 'Enhanced Transactions API',
            plainEnglish: 'Enriches webhook events with human-readable descriptions',
            why: 'Include parsed transaction details in your notifications (e.g., "Swapped 1 SOL for 150 USDC")',
            mcpTools: ['parseTransactions'],
            creditCostPerCall: '100 credits',
            callPattern: '1 call per notification that needs enrichment',
            minimumPlan: 'free',
          },
        ],
        limitations: [
          '10M credits/month cap',
          'Enrichment adds 100 credits per notification',
          'Webhook delivery is near-real-time, not instant',
        ],
        references: ['references/webhooks.md', 'references/enhanced-transactions.md'],
      },
      {
        tier: 'production',
        minimumPlan: 'business',
        complexity: 'high',
        products: [
          {
            product: 'Enhanced WebSockets',
            plainEnglish: 'Streams events to your service in real time with filtering',
            why: 'Lower latency than webhooks — ideal for time-sensitive alerts',
            mcpTools: ['transactionSubscribe', 'accountSubscribe'],
            creditCostPerCall: '3 credits per 0.1 MB streamed',
            callPattern: 'Persistent subscriptions for monitored programs/accounts',
            minimumPlan: 'business',
          },
          {
            product: 'Webhooks',
            plainEnglish: 'Backup event delivery for reliability',
            why: 'Dual delivery — WebSockets for speed, webhooks for guaranteed delivery',
            mcpTools: ['createWebhook', 'getAllWebhooks'],
            creditCostPerCall: '100 credits to create, 1 credit per event',
            callPattern: '1 webhook per set of monitored addresses',
            minimumPlan: 'free',
          },
          {
            product: 'Wallet API',
            plainEnglish: 'Identifies known wallets (exchanges, protocols) in alerts',
            why: 'Add context to notifications: "Transfer from Binance" instead of raw addresses',
            mcpTools: ['getWalletIdentity', 'batchWalletIdentity'],
            creditCostPerCall: '100 credits',
            callPattern: '1 call per unique address to label',
            minimumPlan: 'developer',
          },
        ],
        limitations: [
          'Enhanced WebSockets require Business+ plan ($499/month)',
          'Dual-delivery architecture increases complexity',
          '100M credits/month cap',
        ],
        references: ['references/webhooks.md', 'references/websockets.md', 'references/wallet-api.md'],
      },
    ],
  },

  'data-indexer': {
    name: 'Data Indexer',
    description: 'Ingest blockchain data at scale into your own database for custom queries and analytics.',
    tiers: [
      {
        tier: 'budget',
        minimumPlan: 'free',
        complexity: 'medium',
        products: [
          {
            product: 'Enhanced Transactions API',
            plainEnglish: 'Fetches parsed transaction history page by page',
            why: 'Backfill historical data with human-readable transaction types',
            mcpTools: ['getTransactionHistory', 'parseTransactions'],
            creditCostPerCall: '100 credits',
            callPattern: 'Batch calls during backfill, then periodic polling',
            minimumPlan: 'free',
          },
          {
            product: 'Webhooks',
            plainEnglish: 'Streams new events to your indexer as they happen',
            why: 'Keep your index up to date without polling',
            mcpTools: ['createWebhook'],
            creditCostPerCall: '100 credits to create, 1 credit per event',
            callPattern: '1 webhook per monitored program',
            minimumPlan: 'free',
          },
        ],
        limitations: [
          'Very limited throughput for large-scale indexing',
          '1M credits/month — insufficient for high-volume programs',
          'No streaming — polling + webhooks only',
        ],
        references: ['references/enhanced-transactions.md', 'references/webhooks.md'],
      },
      {
        tier: 'standard',
        minimumPlan: 'developer',
        complexity: 'medium',
        products: [
          {
            product: 'Enhanced Transactions API',
            plainEnglish: 'Fetches parsed transaction history at higher throughput',
            why: 'Faster backfill with Developer rate limits',
            mcpTools: ['getTransactionHistory', 'parseTransactions'],
            creditCostPerCall: '100 credits',
            callPattern: 'Batch calls during backfill',
            minimumPlan: 'free',
          },
          {
            product: 'Standard WebSockets',
            plainEnglish: 'Persistent connection for real-time transaction streaming',
            why: 'Stream new data into your index as blocks are confirmed',
            mcpTools: ['transactionSubscribe'],
            creditCostPerCall: '3 credits per 0.1 MB streamed',
            callPattern: 'Persistent subscription',
            minimumPlan: 'free',
          },
          {
            product: 'Laserstream (Devnet)',
            plainEnglish: 'High-performance gRPC streaming for development/testing',
            why: 'Test your indexer pipeline with production-grade streaming on devnet',
            mcpTools: ['laserstreamSubscribe', 'getLaserstreamInfo'],
            creditCostPerCall: '3 credits per 0.1 MB streamed',
            callPattern: 'Persistent gRPC subscription',
            minimumPlan: 'developer',
          },
        ],
        limitations: [
          'Laserstream limited to devnet on Developer plan',
          '10M credits/month cap',
          'Standard WebSockets for mainnet streaming',
        ],
        references: ['references/enhanced-transactions.md', 'references/laserstream.md', 'references/websockets.md'],
      },
      {
        tier: 'production',
        minimumPlan: 'professional',
        complexity: 'high',
        products: [
          {
            product: 'Laserstream (Mainnet)',
            plainEnglish: 'Lowest-latency gRPC streaming with 24h historical replay',
            why: 'Production-grade data ingestion — subscribe to all transactions, accounts, blocks, or entries',
            mcpTools: ['laserstreamSubscribe', 'getLaserstreamInfo'],
            creditCostPerCall: '3 credits per 0.1 MB streamed',
            callPattern: 'Persistent gRPC subscription with optional replay',
            minimumPlan: 'professional',
          },
          {
            product: 'Webhooks',
            plainEnglish: 'Backup event delivery for critical events',
            why: 'Guaranteed delivery for events that must not be missed',
            mcpTools: ['createWebhook'],
            creditCostPerCall: '100 credits to create, 1 credit per event',
            callPattern: '1 webhook per critical program',
            minimumPlan: 'free',
          },
        ],
        limitations: [
          'Professional plan required for mainnet Laserstream ($999/month)',
          'Data add-ons start at $500/month for full Laserstream access',
          '200M credits/month cap',
        ],
        references: ['references/laserstream.md', 'references/webhooks.md'],
      },
    ],
  },

  'wallet-analytics': {
    name: 'Wallet Analytics',
    description: 'Analyze wallet behavior, track fund flows, identify entities, and build investigation tools.',
    tiers: [
      {
        tier: 'budget',
        minimumPlan: 'free',
        complexity: 'low',
        products: [
          {
            product: 'DAS API',
            plainEnglish: 'Fetches token holdings and NFT collections for a wallet',
            why: 'Basic portfolio snapshot for analysis',
            mcpTools: ['getTokenBalances', 'getAssetsByOwner'],
            creditCostPerCall: '10 credits',
            callPattern: '1 call per wallet analyzed',
            minimumPlan: 'free',
          },
          {
            product: 'Enhanced Transactions API',
            plainEnglish: 'Gets parsed transaction history for pattern analysis',
            why: 'Understand what a wallet has been doing — swaps, transfers, NFT trades',
            mcpTools: ['getTransactionHistory', 'parseTransactions'],
            creditCostPerCall: '100 credits',
            callPattern: '1 call per history page',
            minimumPlan: 'free',
          },
          {
            product: 'Standard RPC',
            plainEnglish: 'Gets SOL balance and account info',
            why: 'Basic account data for analysis',
            mcpTools: ['getBalance', 'getAccountInfo'],
            creditCostPerCall: '1 credit',
            callPattern: '1 call per wallet',
            minimumPlan: 'free',
          },
        ],
        limitations: [
          'No entity identification (exchange/protocol labels)',
          'No USD pricing on balances',
          '1M credits/month — limits number of wallets analyzed',
        ],
        references: ['references/das.md', 'references/enhanced-transactions.md'],
      },
      {
        tier: 'standard',
        minimumPlan: 'developer',
        complexity: 'medium',
        products: [
          {
            product: 'Wallet API',
            plainEnglish: 'Full portfolio with USD values, transfer history, and entity labels',
            why: 'Single API covers balances, history, transfers, and identity — purpose-built for analytics',
            mcpTools: ['getWalletBalances', 'getWalletHistory', 'getWalletTransfers', 'getWalletIdentity', 'getWalletFundedBy'],
            creditCostPerCall: '100 credits',
            callPattern: '1-3 calls per wallet analyzed',
            minimumPlan: 'developer',
          },
          {
            product: 'Token Holders',
            plainEnglish: 'Gets top holders of any token',
            why: 'Analyze token concentration and whale behavior',
            mcpTools: ['getTokenHolders'],
            creditCostPerCall: '20 credits',
            callPattern: '1 call per token analyzed',
            minimumPlan: 'free',
          },
        ],
        limitations: [
          '10M credits/month cap',
          'Wallet API requires Developer+ plan',
          'Batch identity limited to 100 addresses per call',
        ],
        references: ['references/wallet-api.md'],
      },
      {
        tier: 'production',
        minimumPlan: 'business',
        complexity: 'high',
        products: [
          {
            product: 'Wallet API',
            plainEnglish: 'Full portfolio with USD values, transfer history, and entity labels',
            why: 'High-throughput wallet analysis for production tools',
            mcpTools: ['getWalletBalances', 'getWalletHistory', 'getWalletTransfers', 'getWalletIdentity', 'batchWalletIdentity', 'getWalletFundedBy'],
            creditCostPerCall: '100 credits',
            callPattern: '1-3 calls per wallet analyzed',
            minimumPlan: 'developer',
          },
          {
            product: 'Enhanced WebSockets',
            plainEnglish: 'Real-time monitoring of wallets under investigation',
            why: 'Live tracking of wallet activity for alerts and dashboards',
            mcpTools: ['transactionSubscribe', 'accountSubscribe'],
            creditCostPerCall: '3 credits per 0.1 MB streamed',
            callPattern: '1 subscription per monitored wallet',
            minimumPlan: 'business',
          },
          {
            product: 'Webhooks',
            plainEnglish: 'Persistent monitoring with guaranteed event delivery',
            why: 'Track wallets long-term without maintaining WebSocket connections',
            mcpTools: ['createWebhook'],
            creditCostPerCall: '100 credits to create, 1 credit per event',
            callPattern: '1 webhook per set of tracked wallets',
            minimumPlan: 'free',
          },
        ],
        limitations: [
          'Enhanced WebSockets require Business+ plan ($499/month)',
          '100M credits/month cap',
          'Large-scale batch analysis may require additional credits ($5/million)',
        ],
        references: ['references/wallet-api.md', 'references/websockets.md', 'references/webhooks.md'],
      },
    ],
  },

  'token-launch': {
    name: 'Token Launch',
    description: 'Launch and manage a token with minting, distribution tracking, holder analysis, and real-time monitoring.',
    tiers: [
      {
        tier: 'budget',
        minimumPlan: 'free',
        complexity: 'low',
        products: [
          {
            product: 'Helius Sender',
            plainEnglish: 'Submits token creation and transfer transactions',
            why: 'Reliable transaction submission for mint/transfer operations',
            mcpTools: ['getSenderInfo'],
            creditCostPerCall: '0 credits',
            callPattern: '1 call per transaction',
            minimumPlan: 'free',
          },
          {
            product: 'DAS API',
            plainEnglish: 'Verifies token metadata and tracks token accounts',
            why: 'Confirm your token is properly created and indexed',
            mcpTools: ['getAsset', 'getTokenAccounts'],
            creditCostPerCall: '10 credits',
            callPattern: '1 call to verify token setup',
            minimumPlan: 'free',
          },
          {
            product: 'Token Holders',
            plainEnglish: 'Shows top holders of your token',
            why: 'Monitor distribution and identify whale concentration',
            mcpTools: ['getTokenHolders'],
            creditCostPerCall: '20 credits',
            callPattern: '1 call per check',
            minimumPlan: 'free',
          },
        ],
        limitations: [
          'No real-time holder tracking',
          '1M credits/month cap',
          'sendTransaction rate: 1/sec for airdrops',
        ],
        references: ['references/sender.md', 'references/das.md'],
      },
      {
        tier: 'standard',
        minimumPlan: 'developer',
        complexity: 'medium',
        products: [
          {
            product: 'Helius Sender',
            plainEnglish: 'Higher-throughput transaction submission for airdrops and distributions',
            why: '5/sec send rate enables faster airdrops',
            mcpTools: ['getSenderInfo'],
            creditCostPerCall: '0 credits',
            callPattern: '1 call per transaction',
            minimumPlan: 'free',
          },
          {
            product: 'Webhooks',
            plainEnglish: 'Monitors your token for swaps, transfers, and new holders',
            why: 'Track token activity automatically — useful for analytics dashboards',
            mcpTools: ['createWebhook', 'getAllWebhooks'],
            creditCostPerCall: '100 credits to create, 1 credit per event',
            callPattern: '1 webhook monitoring your token mint',
            minimumPlan: 'free',
          },
          {
            product: 'Token Holders',
            plainEnglish: 'Shows top holders of your token',
            why: 'Track distribution over time',
            mcpTools: ['getTokenHolders'],
            creditCostPerCall: '20 credits',
            callPattern: 'Periodic checks',
            minimumPlan: 'free',
          },
        ],
        limitations: [
          '10M credits/month cap',
          'Webhook-only monitoring (no live streaming)',
          'Holder data is top-20 only',
        ],
        references: ['references/sender.md', 'references/webhooks.md', 'references/das.md'],
      },
      {
        tier: 'production',
        minimumPlan: 'business',
        complexity: 'high',
        products: [
          {
            product: 'Helius Sender',
            plainEnglish: 'High-throughput transaction submission for large-scale operations',
            why: '50/sec send rate for large airdrops and distributions',
            mcpTools: ['getSenderInfo'],
            creditCostPerCall: '0 credits',
            callPattern: '1 call per transaction',
            minimumPlan: 'free',
          },
          {
            product: 'Enhanced WebSockets',
            plainEnglish: 'Real-time monitoring of all token activity',
            why: 'Live dashboard showing trades, transfers, and holder changes',
            mcpTools: ['transactionSubscribe'],
            creditCostPerCall: '3 credits per 0.1 MB streamed',
            callPattern: '1 subscription monitoring your token mint',
            minimumPlan: 'business',
          },
          {
            product: 'Wallet API',
            plainEnglish: 'Identifies who is buying/selling your token',
            why: 'Understand your holder base — exchanges, protocols, whales',
            mcpTools: ['getWalletIdentity', 'batchWalletIdentity'],
            creditCostPerCall: '100 credits',
            callPattern: '1 call per unique holder to identify',
            minimumPlan: 'developer',
          },
        ],
        limitations: [
          'Enhanced WebSockets require Business+ plan ($499/month)',
          '100M credits/month cap',
          'Complex multi-product architecture',
        ],
        references: ['references/sender.md', 'references/websockets.md', 'references/wallet-api.md'],
      },
    ],
  },

  general: {
    name: 'General Capability Catalog',
    description: 'Overview of all Helius products organized by domain. Use this when no specific project type matches.',
    tiers: [
      {
        tier: 'budget',
        minimumPlan: 'free',
        complexity: 'low',
        products: [
          {
            product: 'Data Queries (DAS API + RPC)',
            plainEnglish: 'Query tokens, NFTs, accounts, balances, and blocks',
            why: 'Foundation for any Solana app — read on-chain data',
            mcpTools: ['getAssetsByOwner', 'searchAssets', 'getAsset', 'getTokenBalances', 'getBalance', 'getAccountInfo', 'getBlock', 'getNetworkStatus', 'getTokenAccounts', 'getTokenHolders'],
            creditCostPerCall: '1-10 credits',
            callPattern: 'Varies by use case',
            minimumPlan: 'free',
          },
          {
            product: 'Transaction Parsing (Enhanced Transactions API)',
            plainEnglish: 'Parse any transaction into human-readable format',
            why: 'Understand what happened in any transaction — types, transfers, fees',
            mcpTools: ['parseTransactions', 'getTransactionHistory'],
            creditCostPerCall: '100 credits',
            callPattern: '1 call per transaction or history page',
            minimumPlan: 'free',
          },
          {
            product: 'Event Delivery (Webhooks)',
            plainEnglish: 'Get notified when on-chain events happen',
            why: 'Event-driven architecture without polling',
            mcpTools: ['createWebhook', 'getAllWebhooks', 'updateWebhook', 'deleteWebhook'],
            creditCostPerCall: '100 credits to create, 1 credit per event',
            callPattern: '1 webhook per set of monitored addresses (up to 100k)',
            minimumPlan: 'free',
          },
          {
            product: 'Transaction Sending (Helius Sender)',
            plainEnglish: 'Submit transactions with optimal landing rates via SWQoS',
            why: 'Send transactions reliably with staked connections and Jito tips',
            mcpTools: ['getSenderInfo', 'getPriorityFeeEstimate'],
            creditCostPerCall: '0 credits (Sender), 1 credit (Priority Fee)',
            callPattern: '1 call per transaction',
            minimumPlan: 'free',
          },
        ],
        limitations: [
          '1M credits/month on Free plan',
          'Rate limits: 10 RPC RPS, 2 DAS RPS, 1 sendTransaction/sec',
          'No Enhanced WebSockets or Laserstream',
        ],
        references: ['references/das.md', 'references/enhanced-transactions.md', 'references/webhooks.md', 'references/sender.md', 'references/priority-fees.md'],
      },
      {
        tier: 'standard',
        minimumPlan: 'developer',
        complexity: 'medium',
        products: [
          {
            product: 'Wallet Analysis (Wallet API)',
            plainEnglish: 'Portfolio balances with USD prices, transfer history, entity identification',
            why: 'Purpose-built for wallet-centric features — more data in fewer calls',
            mcpTools: ['getWalletBalances', 'getWalletHistory', 'getWalletTransfers', 'getWalletIdentity', 'getWalletFundedBy'],
            creditCostPerCall: '100 credits',
            callPattern: '1-3 calls per wallet',
            minimumPlan: 'developer',
          },
          {
            product: 'Laserstream (Devnet)',
            plainEnglish: 'High-performance gRPC streaming for development and testing',
            why: 'Test streaming pipelines with production-grade infrastructure on devnet',
            mcpTools: ['laserstreamSubscribe', 'getLaserstreamInfo'],
            creditCostPerCall: '3 credits per 0.1 MB streamed',
            callPattern: 'Persistent gRPC subscription',
            minimumPlan: 'developer',
          },
        ],
        limitations: [
          '10M credits/month on Developer plan',
          'Rate limits: 50 RPC RPS, 10 DAS RPS, 5 sendTransaction/sec',
          'Laserstream limited to devnet',
          'No Enhanced WebSockets',
        ],
        references: ['references/wallet-api.md', 'references/laserstream.md'],
      },
      {
        tier: 'production',
        minimumPlan: 'business',
        complexity: 'high',
        products: [
          {
            product: 'Real-Time Streaming (Enhanced WebSockets)',
            plainEnglish: 'Live transaction and account data via persistent WebSocket connections',
            why: '1.5-2x faster than standard WebSockets with advanced filtering (up to 50k addresses)',
            mcpTools: ['transactionSubscribe', 'accountSubscribe', 'getEnhancedWebSocketInfo'],
            creditCostPerCall: '3 credits per 0.1 MB streamed',
            callPattern: 'Persistent subscriptions',
            minimumPlan: 'business',
          },
          {
            product: 'Laserstream gRPC (Mainnet — Professional)',
            plainEnglish: 'Lowest-latency streaming with 24h historical replay',
            why: 'Maximum throughput for indexers, trading infrastructure, and data pipelines',
            mcpTools: ['laserstreamSubscribe', 'getLaserstreamInfo'],
            creditCostPerCall: '3 credits per 0.1 MB streamed',
            callPattern: 'Persistent gRPC subscription',
            minimumPlan: 'professional',
          },
        ],
        limitations: [
          'Enhanced WebSockets require Business+ plan ($499/month)',
          'Laserstream mainnet requires Professional plan ($999/month)',
          'Laserstream data add-ons start at $500/month',
        ],
        references: ['references/websockets.md', 'references/laserstream.md'],
      },
    ],
  },
};

// ─── Formatting ───

const TIER_DISPLAY: Record<string, string> = { budget: 'Budget', standard: 'Standard', production: 'Production' };

function formatTier(tier: TierRecommendation, detectedPlan?: string): string {
  const planInfo = HELIUS_PLANS[tier.minimumPlan];
  const planPrice = planInfo ? planInfo.price : tier.minimumPlan;
  const planName = planInfo ? planInfo.name : tier.minimumPlan;

  let heading = `## ${TIER_DISPLAY[tier.tier]} Tier`;
  if (detectedPlan) {
    if (planAtOrBelow(tier.minimumPlan, detectedPlan)) {
      heading += ` — Available on your plan`;
    } else {
      heading += ` — Requires ${planName} (${planPrice})`;
    }
  }

  const lines: string[] = [
    heading,
    `**Plan:** ${planName} (${planPrice}) | **Complexity:** ${tier.complexity === 'low' ? 'Beginner-friendly' : tier.complexity === 'medium' ? 'Intermediate' : 'Advanced'}`,
    '',
    '### What to use:',
    '',
  ];

  for (const product of tier.products) {
    const productPlan = HELIUS_PLANS[product.minimumPlan];
    const productPlanName = productPlan ? productPlan.name : product.minimumPlan;
    lines.push(
      `**${product.product}** — ${product.plainEnglish}`,
      `- Why: ${product.why}`,
      `- Tools: ${product.mcpTools.map(t => '`' + t + '`').join(', ')}`,
      `- Cost: ${product.creditCostPerCall}, ${product.callPattern}`,
      `- Requires: ${productPlanName} plan`,
      '',
    );
  }

  lines.push('### Limitations:');
  for (const limitation of tier.limitations) {
    lines.push(`- ${limitation}`);
  }

  lines.push('');
  lines.push(`### To implement, read: ${tier.references.map(r => '`' + r + '`').join(', ')}`);

  return lines.join('\n');
}

function formatUpgradeTier(tier: TierRecommendation): string {
  const planInfo = HELIUS_PLANS[tier.minimumPlan];
  const planPrice = planInfo ? planInfo.price : tier.minimumPlan;
  const planName = planInfo ? planInfo.name : tier.minimumPlan;
  const planCredits = planInfo ? planInfo.credits : '';
  const planRps = planInfo ? planInfo.rateLimit.rpc : '';

  const productNames = tier.products.map(p => p.product);
  const capabilities = tier.products.map(p => p.plainEnglish);
  const productLine = `Adds: ${productNames.join(', ')} (${capabilities[0]})`;

  const statsLine = planInfo
    ? `${planInfo.rateLimit.sendTransaction} send rate, ${planCredits} credits/month, ${planRps}`
    : `Requires ${planName}`;

  const refsLine = `Read: ${tier.references.map(r => '`' + r + '`').join(', ')}`;

  return [
    `### ${TIER_DISPLAY[tier.tier]} Tier — Requires ${planName} (${planPrice})`,
    productLine,
    statsLine,
    refsLine,
  ].join('\n');
}

function formatRecommendation(
  template: ProjectTemplate,
  availableTiers: TierRecommendation[],
  upgradeTiers: TierRecommendation[],
  description: string,
  complexity?: 'low' | 'medium' | 'high',
  detectedPlan?: string,
): string {
  const lines: string[] = [
    `# Architecture Recommendation: ${template.name}`,
    '',
    `> "${description}"`,
    '',
  ];

  if (detectedPlan) {
    const planInfo = HELIUS_PLANS[detectedPlan];
    if (planInfo) {
      lines.push(
        `**Your plan:** ${planInfo.name} (${planInfo.price}) — ${planInfo.credits} credits/month, ${planInfo.rateLimit.rpc}`,
        '',
      );
    }
  }

  lines.push('---', '');

  if (complexity) {
    const allTiers = [...availableTiers, ...upgradeTiers];
    const matched = allTiers.filter(t => t.complexity === complexity);
    if (matched.length > 0) {
      lines.push(`_Filtered by complexity: ${complexity}_`, '', '---', '');
    }
  }

  for (let i = 0; i < availableTiers.length; i++) {
    lines.push(formatTier(availableTiers[i], detectedPlan));
    if (i < availableTiers.length - 1) {
      lines.push('', '---', '');
    }
  }

  if (upgradeTiers.length > 0) {
    lines.push('', '---', '', '## Upgrade Paths', '');
    for (let i = 0; i < upgradeTiers.length; i++) {
      lines.push(formatUpgradeTier(upgradeTiers[i]));
      if (i < upgradeTiers.length - 1) {
        lines.push('');
      }
    }
  }

  lines.push(
    '',
    '---',
    '',
    '## Estimate your monthly cost',
    'credits/month = (calls per user per day) x (credits per call) x (active users) x 30',
    'Use `getRateLimitInfo` for exact per-method credit costs.',
    '',
    '## Next steps',
    '1. Pick a tier \u2192 `getHeliusPlanInfo` for full plan details',
    '2. Read the reference files listed above',
    '3. Start building with the MCP tools listed',
  );

  return lines.join('\n');
}

// ─── Tool Registration ───

export function registerRecommendTools(server: McpServer) {
  server.tool(
    'recommendStack',
    'BEST FOR: architecture recommendations — "what Helius products do I need?", ' +
    '"how should I architect this?". Usually called after getStarted for new projects. ' +
    'PREFER getHeliusPlanInfo for pricing-only questions. ' +
    'PREFER lookupHeliusDocs for specific API docs. Analyzes a project description and ' +
    'returns tiered architecture recommendations: which Helius products to use, why, which ' +
    'MCP tools to call, credit costs per call, minimum plan required, and reference files ' +
    'to read. Supports saved preferences for budget and complexity level.',
    {
      description: z.string().describe('What the user wants to build, in their own words'),
      projectType: z.enum([
        'portfolio-tracker', 'trading-bot', 'nft-marketplace',
        'blockchain-explorer', 'notification-system', 'data-indexer',
        'wallet-analytics', 'token-launch', 'general',
      ]).optional().describe('Optional classifier — omit for the general capability catalog'),
      budget: z.enum(['free', 'developer', 'business', 'professional']).optional(),
      complexity: z.enum(['low', 'medium', 'high']).optional(),
      scale: z.enum(['budget', 'standard', 'production', 'all']).optional().default('all'),
      remember: z.boolean().optional().describe('Save budget/complexity preferences for future sessions'),
    },
    async ({ description, projectType, budget, complexity, scale, remember }) => {
      // 1. Load saved preferences, merge with provided params
      const savedPrefs = getPreferences();
      const effectiveBudget = budget ?? savedPrefs.budget;
      const effectiveComplexity = complexity ?? savedPrefs.complexity;

      // 2. Save preferences if requested
      if (remember) {
        savePreferences({
          budget: effectiveBudget,
          complexity: effectiveComplexity,
        });
      }

      // 3. Detect current plan from JWT (free, 0 credits)
      const VALID_PLANS = new Set(['free', 'developer', 'business', 'professional']);
      let detectedPlan: string | undefined;
      const jwt = getJwt();
      if (jwt) {
        try {
          const projects = await listProjects(jwt, MCP_USER_AGENT);
          if (projects.length > 0) {
            const details = await getProject(jwt, projects[0].id, MCP_USER_AGENT);
            const raw = details.subscriptionPlanDetails?.currentPlan?.trim().toLowerCase();
            if (raw && VALID_PLANS.has(raw)) {
              detectedPlan = raw;
            }
          }
        } catch {
          // Silent fallback — plan detection is best-effort
        }
      }

      // 4. Look up template (or fall back to general)
      const template = PROJECT_TEMPLATES[projectType ?? 'general'];

      // 5. Filter tiers by scale and/or budget
      let tiers = template.tiers;

      if (scale !== 'all') {
        tiers = tiers.filter(t => t.tier === scale);
      }

      if (effectiveBudget) {
        tiers = tiers.filter(t => planAtOrBelow(t.minimumPlan, effectiveBudget));
      }

      if (tiers.length === 0) {
        return mcpText(
          `# Architecture Recommendation: ${template.name}\n\n` +
          `> "${description}"\n\n` +
          'No tiers match your current filters. Try:\n' +
          '- Increasing your `budget` (e.g., `developer`, `business`)\n' +
          '- Setting `scale` to `all` to see all tiers\n' +
          '- Removing filters to see the full recommendation'
        );
      }

      // 6. Partition tiers when plan is detected and no explicit budget filter
      const shouldSplit = detectedPlan && !budget && !savedPrefs.budget;
      let availableTiers: TierRecommendation[] = tiers;
      let upgradeTiers: TierRecommendation[] = [];

      if (shouldSplit) {
        const available = tiers.filter(t => planAtOrBelow(t.minimumPlan, detectedPlan!));
        const upgrades = tiers.filter(t => !planAtOrBelow(t.minimumPlan, detectedPlan!));
        // Only split if at least one tier is available; otherwise show all with labels
        if (available.length > 0) {
          availableTiers = available;
          upgradeTiers = upgrades;
        }
      }

      // 7. Format output
      let output = formatRecommendation(template, availableTiers, upgradeTiers, description, effectiveComplexity, detectedPlan);

      // 8. Soft hint: if no API key, append setup note
      if (!hasApiKey()) {
        output += '\n\n---\n\n> **Setup needed:** You\'ll need a Helius API key to use these tools. Call `getStarted` for setup instructions.';
      }

      return mcpText(output);
    }
  );
}

export { PROJECT_TEMPLATES };
export type { ProjectTemplate, TierRecommendation, ProductRecommendation };
