/**
 * Helius Documentation Fetcher
 *
 * Fetches official Helius documentation from GitHub for accurate, up-to-date information.
 * Uses llms.txt files which are AI-optimized summaries of the documentation.
 */

// GitHub raw URL base for Helius docs
const DOCS_BASE_URL = 'https://raw.githubusercontent.com/helius-labs/docs/main';

// Available llms.txt documentation files
export const DOCS_INDEX: Record<string, { path: string; description: string }> = {
  overview: {
    path: '/llms.txt',
    description: 'Main Helius overview: plans, credits, rate limits, use cases, API index',
  },
  billing: {
    path: '/billing/llms.txt',
    description: 'Billing & Plans: pricing tiers, credits, rate limits, autoscaling, payment methods',
  },
  das: {
    path: '/api-reference/das/llms.txt',
    description: 'DAS API: getAsset, getAssetsByOwner, searchAssets, compressed NFTs',
  },
  rpc: {
    path: '/api-reference/rpc/http/llms.txt',
    description: 'Standard Solana RPC methods with Helius enhancements',
  },
  websocket: {
    path: '/api-reference/rpc/websocket/llms.txt',
    description: 'Standard Solana WebSocket subscriptions',
  },
  'enhanced-websockets': {
    path: '/enhanced-websockets/llms.txt',
    description: 'Enhanced WebSockets: transactionSubscribe, accountSubscribe, filtering',
  },
  webhooks: {
    path: '/api-reference/webhooks/llms.txt',
    description: 'Webhooks: setup, transaction types, delivery, troubleshooting',
  },
  'enhanced-transactions': {
    path: '/api-reference/enhanced-transactions/llms.txt',
    description: 'Enhanced Transactions API: parseTransactions, transaction history',
  },
  sender: {
    path: '/api-reference/sender/llms.txt',
    description: 'Helius Sender: transaction submission, SWQoS, tips, latency',
  },
  'priority-fee': {
    path: '/api-reference/priority-fee/llms.txt',
    description: 'Priority Fee API: fee estimation, compute units',
  },
  laserstream: {
    path: '/api-reference/laserstream/grpc/llms.txt',
    description: 'LaserStream gRPC: real-time streaming, subscriptions, replay',
  },
  'wallet-api': {
    path: '/api-reference/wallet-api/llms.txt',
    description: 'Wallet API: balances, history, transfers, identity, funding source',
  },
  'zk-compression': {
    path: '/api-reference/zk-compression/llms.txt',
    description: 'ZK Compression API: compressed accounts, validity proofs',
  },
  'dedicated-nodes': {
    path: '/dedicated-nodes/llms.txt',
    description: 'Dedicated Nodes: private infrastructure, Yellowstone gRPC',
  },
  'shred-delivery': {
    path: '/shred-delivery/llms.txt',
    description: 'Shred Delivery: lowest latency, UDP shreds',
  },
};

// In-memory cache for fetched docs (per session)
const docsCache: Map<string, { content: string; fetchedAt: number }> = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch a specific documentation file
 */
export async function fetchDoc(docKey: string): Promise<string> {
  const docInfo = DOCS_INDEX[docKey];
  if (!docInfo) {
    const availableKeys = Object.keys(DOCS_INDEX).join(', ');
    throw new Error(`Unknown doc key: "${docKey}". Available: ${availableKeys}`);
  }

  // Check cache
  const cached = docsCache.get(docKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.content;
  }

  // Fetch from GitHub
  const url = `${DOCS_BASE_URL}${docInfo.path}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const content = await response.text();

    // Cache the result
    docsCache.set(docKey, { content, fetchedAt: Date.now() });

    return content;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch docs from ${url}: ${errorMsg}`);
  }
}

/**
 * Fetch multiple documentation files
 */
export async function fetchDocs(docKeys: string[]): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const errors: string[] = [];

  await Promise.all(
    docKeys.map(async (key) => {
      try {
        const content = await fetchDoc(key);
        results.set(key, content);
      } catch (error) {
        errors.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );

  if (errors.length > 0 && results.size === 0) {
    throw new Error(`Failed to fetch any docs:\n${errors.join('\n')}`);
  }

  return results;
}

/**
 * Get the list of available documentation topics
 */
export function getAvailableDocTopics(): string[] {
  return Object.keys(DOCS_INDEX);
}

/**
 * Get documentation index with descriptions
 */
export function getDocsIndex(): Array<{ key: string; description: string }> {
  return Object.entries(DOCS_INDEX).map(([key, info]) => ({
    key,
    description: info.description,
  }));
}

/**
 * Search docs content for a specific term (searches cached docs only)
 */
export function searchCachedDocs(searchTerm: string): Array<{ docKey: string; matches: string[] }> {
  const results: Array<{ docKey: string; matches: string[] }> = [];
  const searchLower = searchTerm.toLowerCase();

  for (const [docKey, cached] of docsCache.entries()) {
    const lines = cached.content.split('\n');
    const matches = lines.filter((line) => line.toLowerCase().includes(searchLower));
    if (matches.length > 0) {
      results.push({ docKey, matches: matches.slice(0, 5) }); // Limit to 5 matches per doc
    }
  }

  return results;
}

/**
 * Clear the docs cache (useful for forcing fresh fetches)
 */
export function clearDocsCache(): void {
  docsCache.clear();
}

/**
 * Get cache stats
 */
export function getDocsCacheStats(): { cachedDocs: string[]; totalSize: number } {
  const cachedDocs = Array.from(docsCache.keys());
  let totalSize = 0;
  for (const cached of docsCache.values()) {
    totalSize += cached.content.length;
  }
  return { cachedDocs, totalSize };
}
