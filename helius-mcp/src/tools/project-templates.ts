// ─── Project Templates ───
//
// Slim template data that references the product catalog by key.
// Each product entry carries only project-specific fields (plainEnglish, why,
// callPattern) plus optional overrides to narrow/customize catalog defaults.
// Templates are hydrated at module load into the same shape as the old inline data.

import { PRODUCT_CATALOG } from './product-catalog.js';
import { HELIUS_PLANS } from './plans.js';

// ─── Types ───

export interface ProductRecommendation {
  product: string;
  plainEnglish: string;
  why: string;
  mcpTools: string[];
  creditCostPerCall: string;
  callPattern: string;
  minimumPlan: string;
}

export interface TierRecommendation {
  tier: 'budget' | 'standard' | 'production';
  minimumPlan: string;
  complexity: 'low' | 'medium' | 'high';
  products: ProductRecommendation[];
  limitations: string[];
  references: string[];
}

export interface ProjectTemplate {
  name: string;
  description: string;
  tiers: TierRecommendation[];
}

// ─── Source Types (slim template shape before hydration) ───

interface ProductSource {
  catalogKey: string;
  plainEnglish: string;
  why: string;
  callPattern: string;
  nameOverride?: string;
  mcpToolsOverride?: string[];
  creditCostOverride?: string;
  minimumPlanOverride?: string;
}

interface TierSource {
  tier: 'budget' | 'standard' | 'production';
  minimumPlan: string;
  complexity: 'low' | 'medium' | 'high';
  products: ProductSource[];
  customLimitations: string[];
  references: string[];
}

interface TemplateSource {
  name: string;
  description: string;
  tiers: TierSource[];
}

// ─── Hydration ───

export function derivePlanLimitations(minimumPlan: string): string[] {
  const plan = HELIUS_PLANS[minimumPlan];
  if (!plan) return [];

  const limitations: string[] = [];

  // Credit cap
  limitations.push(`${plan.credits} credits/month (${plan.name} plan)`);

  // Feature gates
  const gates: string[] = [];
  if (!plan.features.enhancedWebSockets) gates.push('Enhanced WebSockets');
  if (!plan.features.laserstream) {
    gates.push('Laserstream');
  } else if (typeof plan.features.laserstream === 'string' && plan.features.laserstream.toLowerCase().includes('devnet')) {
    limitations.push('Laserstream limited to devnet');
  }

  if (gates.length > 0) limitations.push(`No ${gates.join(' or ')}`);

  return limitations;
}

export function hydrateTemplate(source: TemplateSource): ProjectTemplate {
  return {
    name: source.name,
    description: source.description,
    tiers: source.tiers.map(tierSource => {
      const products = tierSource.products.map(ps => {
        const entry = PRODUCT_CATALOG[ps.catalogKey];
        if (!entry) throw new Error(`Unknown catalog key: ${ps.catalogKey}`);
        return {
          product: ps.nameOverride ?? entry.name,
          plainEnglish: ps.plainEnglish,
          why: ps.why,
          mcpTools: ps.mcpToolsOverride ?? entry.mcpTools,
          creditCostPerCall: ps.creditCostOverride ?? entry.creditCostPerCall,
          callPattern: ps.callPattern,
          minimumPlan: ps.minimumPlanOverride ?? entry.minimumPlan,
        };
      });

      return {
        tier: tierSource.tier,
        minimumPlan: tierSource.minimumPlan,
        complexity: tierSource.complexity,
        products,
        limitations: [...tierSource.customLimitations, ...derivePlanLimitations(tierSource.minimumPlan)],
        references: tierSource.references,
      };
    }),
  };
}

// ─── Template Sources ───

export const TEMPLATE_SOURCES: Record<string, TemplateSource> = {
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
            catalogKey: 'das-api',
            plainEnglish: 'Fetches all tokens in a wallet with names, symbols, and prices',
            why: 'One call gets the complete token list for a wallet',
            mcpToolsOverride: ['getTokenBalances', 'getAssetsByOwner'],
            callPattern: '1 call per portfolio view',
          },
          {
            catalogKey: 'standard-rpc',
            plainEnglish: 'Gets native SOL balance',
            why: "DAS doesn't include SOL; this fills the gap",
            mcpToolsOverride: ['getBalance'],
            creditCostOverride: '1 credit',
            callPattern: '1 call per portfolio view',
          },
          {
            catalogKey: 'enhanced-transactions',
            plainEnglish: 'Parses transaction history into human-readable format',
            why: 'Shows users what happened in their past transactions',
            callPattern: '1 call per history page load',
          },
        ],
        customLimitations: [
          'No real-time updates — users must refresh manually',
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
            catalogKey: 'wallet-api',
            plainEnglish: 'Gets all token balances with USD prices sorted by value in one call',
            why: 'Single call replaces DAS + RPC combo, includes USD pricing',
            mcpToolsOverride: ['getWalletBalances', 'getWalletHistory'],
            callPattern: '1 call per portfolio view',
          },
          {
            catalogKey: 'webhooks',
            plainEnglish: 'Sends notifications to your server when wallet activity happens',
            why: 'Event-driven updates instead of polling — more efficient and timely',
            mcpToolsOverride: ['createWebhook', 'getAllWebhooks'],
            callPattern: '1 webhook per monitored wallet',
          },
        ],
        customLimitations: [
          'Webhook delivery is near-real-time but not instant',
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
            catalogKey: 'wallet-api',
            plainEnglish: 'Gets all token balances with USD prices sorted by value in one call',
            why: 'Production-grade portfolio data with built-in USD pricing',
            mcpToolsOverride: ['getWalletBalances', 'getWalletHistory', 'getWalletTransfers'],
            callPattern: '1 call per portfolio view',
          },
          {
            catalogKey: 'enhanced-websockets',
            plainEnglish: 'Streams live transaction data to your app over a persistent connection',
            why: 'Real-time UI updates without polling — users see changes instantly',
            mcpToolsOverride: ['transactionSubscribe', 'accountSubscribe'],
            callPattern: '1 subscription per monitored wallet',
          },
          {
            catalogKey: 'webhooks',
            plainEnglish: 'Sends notifications to your server when wallet activity happens',
            why: 'Backend event processing while WebSockets handle the live UI',
            mcpToolsOverride: ['createWebhook'],
            callPattern: '1 webhook per monitored wallet',
          },
        ],
        customLimitations: [
          'More complex architecture — WebSockets for frontend, webhooks for backend',
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
            catalogKey: 'helius-sender',
            plainEnglish: 'Submits transactions with SWQoS routing for better landing rates',
            why: 'Optimal transaction submission is critical for trading — Sender provides staked connections and Jito integration',
            callPattern: '1 call per trade',
          },
          {
            catalogKey: 'priority-fee',
            plainEnglish: 'Gets real-time fee estimates so your transactions land faster',
            why: 'Correct priority fees are essential for competitive trading',
            callPattern: '1 call per transaction',
          },
          {
            catalogKey: 'enhanced-transactions',
            plainEnglish: 'Parses swap/trade transactions into human-readable format',
            why: 'Verify trade results and track P&L',
            mcpToolsOverride: ['parseTransactions'],
            callPattern: '1 call per trade verification',
          },
        ],
        customLimitations: [
          'sendTransaction rate: 1/sec (Free plan) — limits trading frequency',
          'No real-time market data streaming',
        ],
        references: ['references/sender.md', 'references/priority-fees.md'],
      },
      {
        tier: 'standard',
        minimumPlan: 'developer',
        complexity: 'medium',
        products: [
          {
            catalogKey: 'helius-sender',
            plainEnglish: 'Submits transactions with SWQoS routing for better landing rates',
            why: 'Higher send rate (5/sec) enables more frequent trading',
            callPattern: '1 call per trade',
          },
          {
            catalogKey: 'priority-fee',
            plainEnglish: 'Gets real-time fee estimates so your transactions land faster',
            why: 'Correct priority fees are essential for competitive trading',
            callPattern: '1 call per transaction',
          },
          {
            catalogKey: 'standard-websockets',
            plainEnglish: 'Persistent connection for tracking transaction confirmations',
            why: 'Confirm trades landed without polling — saves credits and reduces latency',
            callPattern: '1 subscription for confirmation tracking',
          },
        ],
        customLimitations: [
          'sendTransaction rate: 5/sec (Developer plan)',
          'Standard WebSockets only — no enhanced filtering',
        ],
        references: ['references/sender.md', 'references/priority-fees.md', 'references/websockets.md'],
      },
      {
        tier: 'production',
        minimumPlan: 'business',
        complexity: 'high',
        products: [
          {
            catalogKey: 'helius-sender',
            plainEnglish: 'Submits transactions with SWQoS routing for better landing rates',
            why: 'High-frequency sending (50/sec) for production trading',
            callPattern: '1 call per trade',
          },
          {
            catalogKey: 'priority-fee',
            plainEnglish: 'Gets real-time fee estimates so your transactions land faster',
            why: 'Critical for competitive trading at scale',
            callPattern: '1 call per transaction',
          },
          {
            catalogKey: 'enhanced-websockets',
            plainEnglish: 'Low-latency streaming for market data and confirmations',
            why: '1.5-2x faster than standard WebSockets — critical for trading speed',
            mcpToolsOverride: ['transactionSubscribe', 'accountSubscribe'],
            callPattern: 'Persistent subscriptions for market monitoring',
          },
        ],
        customLimitations: [
          'sendTransaction rate: 50/sec (Business plan)',
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
            catalogKey: 'das-api',
            plainEnglish: 'Queries NFTs by collection, creator, owner, or attributes',
            why: 'Core data layer for browsing and searching NFTs',
            mcpToolsOverride: ['getAssetsByOwner', 'getAssetsByGroup', 'searchAssets', 'getAsset'],
            callPattern: '1 call per page/search',
          },
          {
            catalogKey: 'enhanced-transactions',
            plainEnglish: 'Shows human-readable NFT sale and transfer history',
            why: 'Display provenance and trading history for each NFT',
            callPattern: '1 call per NFT detail page',
          },
        ],
        customLimitations: [
          'No real-time sale/listing notifications',
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
            catalogKey: 'das-api',
            plainEnglish: 'Queries NFTs by collection, creator, owner, or attributes',
            why: 'Core data layer with higher rate limits (10 RPS)',
            mcpToolsOverride: ['getAssetsByOwner', 'getAssetsByGroup', 'searchAssets', 'getAsset'],
            callPattern: '1 call per page/search',
          },
          {
            catalogKey: 'webhooks',
            plainEnglish: 'Sends notifications when NFT sales, listings, or transfers happen',
            why: 'Event-driven backend — update your database when on-chain events occur',
            mcpToolsOverride: ['createWebhook', 'getAllWebhooks'],
            callPattern: '1 webhook per collection or marketplace program',
          },
          {
            catalogKey: 'enhanced-transactions',
            plainEnglish: 'Shows human-readable NFT sale and transfer history',
            why: 'Rich transaction detail pages with parsed sale data',
            callPattern: '1 call per NFT detail page',
          },
        ],
        customLimitations: [
          'No live UI updates — webhooks are server-to-server',
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
            catalogKey: 'das-api',
            plainEnglish: 'Queries NFTs by collection, creator, owner, or attributes',
            why: 'High-throughput queries (50 RPS) for production traffic',
            mcpToolsOverride: ['getAssetsByOwner', 'getAssetsByGroup', 'searchAssets', 'getAsset'],
            callPattern: '1 call per page/search',
          },
          {
            catalogKey: 'webhooks',
            plainEnglish: 'Sends notifications when NFT sales, listings, or transfers happen',
            why: 'Backend event pipeline for indexing all marketplace activity',
            mcpToolsOverride: ['createWebhook', 'getAllWebhooks'],
            callPattern: '1 webhook per collection or marketplace program',
          },
          {
            catalogKey: 'enhanced-websockets',
            plainEnglish: 'Streams live NFT events to your frontend',
            why: 'Real-time sale feeds and activity dashboards without polling',
            mcpToolsOverride: ['transactionSubscribe'],
            callPattern: '1 subscription per marketplace program',
          },
        ],
        customLimitations: [
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
            catalogKey: 'enhanced-transactions',
            plainEnglish: 'Parses any transaction into human-readable format with types and descriptions',
            why: 'Core feature — transforms raw transaction data into something users can understand',
            callPattern: '1 call per transaction detail page',
          },
          {
            catalogKey: 'standard-rpc',
            plainEnglish: 'Fetches account info, block data, and network status',
            why: 'Base layer for account/block explorer pages',
            callPattern: '1-3 calls per page load',
          },
          {
            catalogKey: 'das-api',
            plainEnglish: 'Queries token and NFT metadata for display',
            why: 'Shows token names, images, and details on account pages',
            mcpToolsOverride: ['getAsset', 'getAssetsByOwner'],
            callPattern: '1 call per token detail page',
          },
        ],
        customLimitations: [
          'No real-time block/transaction streaming',
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
            catalogKey: 'enhanced-transactions',
            plainEnglish: 'Parses any transaction into human-readable format with types and descriptions',
            why: 'Higher rate limits for serving more users',
            callPattern: '1 call per transaction detail page',
          },
          {
            catalogKey: 'standard-rpc',
            plainEnglish: 'Fetches account info, block data, and network status',
            why: 'Higher throughput for concurrent page loads',
            callPattern: '1-3 calls per page load',
          },
          {
            catalogKey: 'wallet-api',
            plainEnglish: 'Gets complete wallet portfolio with USD values',
            why: 'Rich wallet detail pages with portfolio breakdown',
            mcpToolsOverride: ['getWalletBalances', 'getWalletHistory', 'getWalletIdentity'],
            callPattern: '1 call per wallet detail page',
          },
        ],
        customLimitations: [
          'No live streaming for new blocks/transactions',
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
            catalogKey: 'enhanced-transactions',
            plainEnglish: 'Parses any transaction into human-readable format with types and descriptions',
            why: 'High-throughput parsing for production explorer',
            callPattern: '1 call per transaction detail page',
          },
          {
            catalogKey: 'wallet-api',
            plainEnglish: 'Gets complete wallet portfolio with USD values and identity',
            why: 'Rich wallet pages with portfolio, history, and entity labels',
            mcpToolsOverride: ['getWalletBalances', 'getWalletHistory', 'getWalletIdentity'],
            callPattern: '1 call per wallet detail page',
          },
          {
            catalogKey: 'enhanced-websockets',
            plainEnglish: 'Streams new transactions and account updates in real time',
            why: 'Live transaction feed and real-time account pages',
            mcpToolsOverride: ['transactionSubscribe', 'accountSubscribe'],
            callPattern: 'Persistent subscriptions for live pages',
          },
        ],
        customLimitations: [
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
            catalogKey: 'webhooks',
            plainEnglish: 'Sends HTTP POST to your server when monitored addresses have activity',
            why: 'Fire-and-forget event delivery — the simplest way to monitor on-chain events',
            callPattern: '1 webhook per set of monitored addresses (up to 100k addresses)',
          },
        ],
        customLimitations: [
          'Webhook-only — no persistent streaming connection',
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
            catalogKey: 'webhooks',
            plainEnglish: 'Sends HTTP POST to your server when monitored addresses have activity',
            why: 'Higher throughput for more addresses and events',
            callPattern: '1 webhook per set of monitored addresses',
          },
          {
            catalogKey: 'enhanced-transactions',
            plainEnglish: 'Enriches webhook events with human-readable descriptions',
            why: 'Include parsed transaction details in your notifications (e.g., "Swapped 1 SOL for 150 USDC")',
            mcpToolsOverride: ['parseTransactions'],
            callPattern: '1 call per notification that needs enrichment',
          },
        ],
        customLimitations: [
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
            catalogKey: 'enhanced-websockets',
            plainEnglish: 'Streams events to your service in real time with filtering',
            why: 'Lower latency than webhooks — ideal for time-sensitive alerts',
            mcpToolsOverride: ['transactionSubscribe', 'accountSubscribe'],
            callPattern: 'Persistent subscriptions for monitored programs/accounts',
          },
          {
            catalogKey: 'webhooks',
            plainEnglish: 'Backup event delivery for reliability',
            why: 'Dual delivery — WebSockets for speed, webhooks for guaranteed delivery',
            mcpToolsOverride: ['createWebhook', 'getAllWebhooks'],
            callPattern: '1 webhook per set of monitored addresses',
          },
          {
            catalogKey: 'wallet-api',
            plainEnglish: 'Identifies known wallets (exchanges, protocols) in alerts',
            why: 'Add context to notifications: "Transfer from Binance" instead of raw addresses',
            mcpToolsOverride: ['getWalletIdentity', 'batchWalletIdentity'],
            callPattern: '1 call per unique address to label',
          },
        ],
        customLimitations: [
          'Dual-delivery architecture increases complexity',
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
            catalogKey: 'enhanced-transactions',
            plainEnglish: 'Fetches parsed transaction history page by page',
            why: 'Backfill historical data with human-readable transaction types',
            callPattern: 'Batch calls during backfill, then periodic polling',
          },
          {
            catalogKey: 'webhooks',
            plainEnglish: 'Streams new events to your indexer as they happen',
            why: 'Keep your index up to date without polling',
            mcpToolsOverride: ['createWebhook'],
            callPattern: '1 webhook per monitored program',
          },
        ],
        customLimitations: [
          'Very limited throughput for large-scale indexing',
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
            catalogKey: 'enhanced-transactions',
            plainEnglish: 'Fetches parsed transaction history at higher throughput',
            why: 'Faster backfill with Developer rate limits',
            callPattern: 'Batch calls during backfill',
          },
          {
            catalogKey: 'standard-websockets',
            plainEnglish: 'Persistent connection for real-time transaction streaming',
            why: 'Stream new data into your index as blocks are confirmed',
            callPattern: 'Persistent subscription',
          },
          {
            catalogKey: 'laserstream-devnet',
            plainEnglish: 'High-performance gRPC streaming for development/testing',
            why: 'Test your indexer pipeline with production-grade streaming on devnet',
            callPattern: 'Persistent gRPC subscription',
          },
        ],
        customLimitations: [
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
            catalogKey: 'laserstream-mainnet',
            plainEnglish: 'Lowest-latency gRPC streaming with 24h historical replay',
            why: 'Production-grade data ingestion — subscribe to all transactions, accounts, blocks, or entries',
            callPattern: 'Persistent gRPC subscription with optional replay',
          },
          {
            catalogKey: 'webhooks',
            plainEnglish: 'Backup event delivery for critical events',
            why: 'Guaranteed delivery for events that must not be missed',
            mcpToolsOverride: ['createWebhook'],
            callPattern: '1 webhook per critical program',
          },
        ],
        customLimitations: [
          'Data add-ons start at $500/month for full Laserstream access',
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
            catalogKey: 'das-api',
            plainEnglish: 'Fetches token holdings and NFT collections for a wallet',
            why: 'Basic portfolio snapshot for analysis',
            mcpToolsOverride: ['getTokenBalances', 'getAssetsByOwner'],
            callPattern: '1 call per wallet analyzed',
          },
          {
            catalogKey: 'enhanced-transactions',
            plainEnglish: 'Gets parsed transaction history for pattern analysis',
            why: 'Understand what a wallet has been doing — swaps, transfers, NFT trades',
            callPattern: '1 call per history page',
          },
          {
            catalogKey: 'standard-rpc',
            plainEnglish: 'Gets SOL balance and account info',
            why: 'Basic account data for analysis',
            mcpToolsOverride: ['getBalance', 'getAccountInfo'],
            creditCostOverride: '1 credit',
            callPattern: '1 call per wallet',
          },
        ],
        customLimitations: [
          'No entity identification (exchange/protocol labels)',
          'No USD pricing on balances',
        ],
        references: ['references/das.md', 'references/enhanced-transactions.md'],
      },
      {
        tier: 'standard',
        minimumPlan: 'developer',
        complexity: 'medium',
        products: [
          {
            catalogKey: 'wallet-api',
            plainEnglish: 'Full portfolio with USD values, transfer history, and entity labels',
            why: 'Single API covers balances, history, transfers, and identity — purpose-built for analytics',
            mcpToolsOverride: ['getWalletBalances', 'getWalletHistory', 'getWalletTransfers', 'getWalletIdentity', 'getWalletFundedBy'],
            callPattern: '1-3 calls per wallet analyzed',
          },
          {
            catalogKey: 'token-holders',
            plainEnglish: 'Gets top holders of any token',
            why: 'Analyze token concentration and whale behavior',
            callPattern: '1 call per token analyzed',
          },
        ],
        customLimitations: [
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
            catalogKey: 'wallet-api',
            plainEnglish: 'Full portfolio with USD values, transfer history, and entity labels',
            why: 'High-throughput wallet analysis for production tools',
            callPattern: '1-3 calls per wallet analyzed',
          },
          {
            catalogKey: 'enhanced-websockets',
            plainEnglish: 'Real-time monitoring of wallets under investigation',
            why: 'Live tracking of wallet activity for alerts and dashboards',
            mcpToolsOverride: ['transactionSubscribe', 'accountSubscribe'],
            callPattern: '1 subscription per monitored wallet',
          },
          {
            catalogKey: 'webhooks',
            plainEnglish: 'Persistent monitoring with guaranteed event delivery',
            why: 'Track wallets long-term without maintaining WebSocket connections',
            mcpToolsOverride: ['createWebhook'],
            callPattern: '1 webhook per set of tracked wallets',
          },
        ],
        customLimitations: [
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
            catalogKey: 'helius-sender',
            plainEnglish: 'Submits token creation and transfer transactions',
            why: 'Reliable transaction submission for mint/transfer operations',
            callPattern: '1 call per transaction',
          },
          {
            catalogKey: 'das-api',
            plainEnglish: 'Verifies token metadata and tracks token accounts',
            why: 'Confirm your token is properly created and indexed',
            mcpToolsOverride: ['getAsset', 'getTokenAccounts'],
            callPattern: '1 call to verify token setup',
          },
          {
            catalogKey: 'token-holders',
            plainEnglish: 'Shows top holders of your token',
            why: 'Monitor distribution and identify whale concentration',
            callPattern: '1 call per check',
          },
        ],
        customLimitations: [
          'No real-time holder tracking',
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
            catalogKey: 'helius-sender',
            plainEnglish: 'Higher-throughput transaction submission for airdrops and distributions',
            why: '5/sec send rate enables faster airdrops',
            callPattern: '1 call per transaction',
          },
          {
            catalogKey: 'webhooks',
            plainEnglish: 'Monitors your token for swaps, transfers, and new holders',
            why: 'Track token activity automatically — useful for analytics dashboards',
            mcpToolsOverride: ['createWebhook', 'getAllWebhooks'],
            callPattern: '1 webhook monitoring your token mint',
          },
          {
            catalogKey: 'token-holders',
            plainEnglish: 'Shows top holders of your token',
            why: 'Track distribution over time',
            callPattern: 'Periodic checks',
          },
        ],
        customLimitations: [
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
            catalogKey: 'helius-sender',
            plainEnglish: 'High-throughput transaction submission for large-scale operations',
            why: '50/sec send rate for large airdrops and distributions',
            callPattern: '1 call per transaction',
          },
          {
            catalogKey: 'enhanced-websockets',
            plainEnglish: 'Real-time monitoring of all token activity',
            why: 'Live dashboard showing trades, transfers, and holder changes',
            mcpToolsOverride: ['transactionSubscribe'],
            callPattern: '1 subscription monitoring your token mint',
          },
          {
            catalogKey: 'wallet-api',
            plainEnglish: 'Identifies who is buying/selling your token',
            why: 'Understand your holder base — exchanges, protocols, whales',
            mcpToolsOverride: ['getWalletIdentity', 'batchWalletIdentity'],
            callPattern: '1 call per unique holder to identify',
          },
        ],
        customLimitations: [
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
            catalogKey: 'das-api',
            nameOverride: 'Data Queries (DAS API + RPC)',
            plainEnglish: 'Query tokens, NFTs, accounts, balances, and blocks',
            why: 'Foundation for any Solana app — read on-chain data',
            mcpToolsOverride: ['getAssetsByOwner', 'searchAssets', 'getAsset', 'getTokenBalances', 'getBalance', 'getAccountInfo', 'getBlock', 'getNetworkStatus', 'getTokenAccounts', 'getTokenHolders'],
            creditCostOverride: '1-10 credits',
            callPattern: 'Varies by use case',
          },
          {
            catalogKey: 'enhanced-transactions',
            nameOverride: 'Transaction Parsing (Enhanced Transactions API)',
            plainEnglish: 'Parse any transaction into human-readable format',
            why: 'Understand what happened in any transaction — types, transfers, fees',
            callPattern: '1 call per transaction or history page',
          },
          {
            catalogKey: 'webhooks',
            nameOverride: 'Event Delivery (Webhooks)',
            plainEnglish: 'Get notified when on-chain events happen',
            why: 'Event-driven architecture without polling',
            callPattern: '1 webhook per set of monitored addresses (up to 100k)',
          },
          {
            catalogKey: 'helius-sender',
            nameOverride: 'Transaction Sending (Helius Sender)',
            plainEnglish: 'Submit transactions with optimal landing rates via SWQoS',
            why: 'Send transactions reliably with staked connections and Jito tips',
            mcpToolsOverride: ['getSenderInfo', 'getPriorityFeeEstimate'],
            creditCostOverride: '0 credits (Sender), 1 credit (Priority Fee)',
            callPattern: '1 call per transaction',
          },
        ],
        customLimitations: [
          'Rate limits: 10 RPC RPS, 2 DAS RPS, 1 sendTransaction/sec',
        ],
        references: ['references/das.md', 'references/enhanced-transactions.md', 'references/webhooks.md', 'references/sender.md', 'references/priority-fees.md'],
      },
      {
        tier: 'standard',
        minimumPlan: 'developer',
        complexity: 'medium',
        products: [
          {
            catalogKey: 'wallet-api',
            nameOverride: 'Wallet Analysis (Wallet API)',
            plainEnglish: 'Portfolio balances with USD prices, transfer history, entity identification',
            why: 'Purpose-built for wallet-centric features — more data in fewer calls',
            mcpToolsOverride: ['getWalletBalances', 'getWalletHistory', 'getWalletTransfers', 'getWalletIdentity', 'getWalletFundedBy'],
            callPattern: '1-3 calls per wallet',
          },
          {
            catalogKey: 'laserstream-devnet',
            plainEnglish: 'High-performance gRPC streaming for development and testing',
            why: 'Test streaming pipelines with production-grade infrastructure on devnet',
            callPattern: 'Persistent gRPC subscription',
          },
        ],
        customLimitations: [
          'Rate limits: 50 RPC RPS, 10 DAS RPS, 5 sendTransaction/sec',
        ],
        references: ['references/wallet-api.md', 'references/laserstream.md'],
      },
      {
        tier: 'production',
        minimumPlan: 'business',
        complexity: 'high',
        products: [
          {
            catalogKey: 'enhanced-websockets',
            nameOverride: 'Real-Time Streaming (Enhanced WebSockets)',
            plainEnglish: 'Live transaction and account data via persistent WebSocket connections',
            why: '1.5-2x faster than standard WebSockets with advanced filtering (up to 50k addresses)',
            callPattern: 'Persistent subscriptions',
          },
          {
            catalogKey: 'laserstream-mainnet',
            nameOverride: 'Laserstream gRPC (Mainnet — Professional)',
            plainEnglish: 'Lowest-latency streaming with 24h historical replay',
            why: 'Maximum throughput for indexers, trading infrastructure, and data pipelines',
            callPattern: 'Persistent gRPC subscription',
          },
        ],
        customLimitations: [
          'Laserstream mainnet requires Professional plan ($999/month)',
          'Laserstream data add-ons start at $500/month',
        ],
        references: ['references/websockets.md', 'references/laserstream.md'],
      },
    ],
  },
};

// ─── Hydrated Templates (same shape as the old inline data) ───

export const PROJECT_TEMPLATES: Record<string, ProjectTemplate> = Object.fromEntries(
  Object.entries(TEMPLATE_SOURCES).map(([key, source]) => [key, hydrateTemplate(source)])
);
