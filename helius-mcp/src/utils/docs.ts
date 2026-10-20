/**
 * Helius Documentation Fetcher
 *
 * Fetches official Helius documentation from helius.dev for accurate, up-to-date information.
 * Uses llms.txt files which are AI-optimized summaries of the documentation.
 */

// Base URL for the published Helius docs site
const DOCS_BASE_URL = 'https://www.helius.dev/docs';

// Documentation topics. Most products publish an llms.txt summary; products
// without one point at their main page, which the docs site serves as
// markdown when the path ends in `.md`.
export const DOCS_INDEX: Record<string, { path: string; description: string }> = {
  overview: {
    path: '/llms.txt',
    description: 'Main Helius overview: plans, credits, rate limits, use cases, API index',
  },
  agents: {
    path: '/agents/llms.txt',
    description: 'AI Agents: Helius CLI signup, MCP integration, SDK references, preferred API patterns',
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
    path: '/api-reference/rpc/websocket/llms.txt',
    description: 'Enhanced WebSockets (now called LaserStream WebSocket): transactionSubscribe, accountSubscribe, filtering',
  },
  webhooks: {
    path: '/api-reference/webhooks/llms.txt',
    description: 'Webhooks: setup, transaction types, delivery, troubleshooting. For new parsed real-time pipelines, see parsed-streams',
  },
  'parsed-streams': {
    path: '/parsed-streams.md',
    description: 'Parsed Streams: decoded transactions pushed over WebSocket (parsedTransactionSubscribe, describeProgram), all plans, successor to Enhanced webhooks',
  },
  'parsed-events': {
    path: '/parsed-events.md',
    description: 'Parsed Events API: parse transactions and parsed address history over REST, all plans, 10 credits, successor to Enhanced Transactions',
  },
  'enhanced-transactions': {
    path: '/api-reference/enhanced-transactions/llms.txt',
    description: 'Enhanced Transactions API (legacy, maintenance mode): parseTransactions, transaction history. Prefer parsed-events for new builds',
  },
  sender: {
    path: '/api-reference/sender/llms.txt',
    description: 'Helius Sender: transaction submission, SWQoS, tips, latency',
  },
  'mev-protect': {
    path: '/sending-transactions/mev-protect.md',
    description: 'MEV Protect: opt-in mev-protect=true routing away from sandwich-linked validators, for basic sends, bundles, and Sender',
  },
  'backrun-rebates': {
    path: '/sending-transactions/backrun-rebates.md',
    description: 'Backrun Rebates: opt-in rebate-address parameter on mainnet sendTransaction to earn a share of the MEV your transaction creates',
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
  'pre-confirmations': {
    path: '/api-reference/pre-confirmations/preconfsubscribe.md',
    description: 'Preconfirmations: preconfSubscribe stream of transactions before they are shredded, filters, coverage, pricing, paid plans',
  },
  'preprocessed-transactions': {
    path: '/preprocessed-transactions/preprocessed-subscribe.md',
    description: 'Preprocessed Transactions (beta): preprocessedSubscribe pre-execution transaction stream over WebSocket, paid plans',
  },
  gatekeeper: {
    path: '/gatekeeper/llms.txt',
    description: 'Gatekeeper (beta): the beta.helius-rpc.com endpoint that also hosts Parsed Streams, Preconfirmations, and Preprocessed Transactions',
  },
  'admin-api': {
    path: '/api-reference/admin.md',
    description: 'Admin API: project credit usage, billing cycle, and per-service request counts with an API key',
  },
  waas: {
    path: '/waas/llms.txt',
    description: 'Wallet-as-a-Service (beta): embedded non-custodial wallets via helius-wallet-kit, passkey sign-in, paid plans',
  },
  privacy: {
    path: '/privacy/llms.txt',
    description: 'Helius Privacy (beta, devnet only): confidential transfers with zero-knowledge proofs via @heliuslabs/zolana',
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

  // Fetch from the docs site
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

// Freeform query routing, in three passes:
// 1. Product-name phrases for newer products, so "parsed streams websocket"
//    is not captured by the broader "websocket" topic.
// 2. Exact topic names, as whole words and longest first, so "grpc" is not
//    read as "rpc" and "enhanced-websockets" is not read as "websocket".
// 3. Broad keywords for everything else.
const PRODUCT_ROUTES: Array<[RegExp, string]> = [
  [/parsed[\s-]?stream|parsedtransactionsubscribe|describeprogram/, 'parsed-streams'],
  [/parsed[\s-]?event/, 'parsed-events'],
  [/preconf/, 'pre-confirmations'],
  [/preprocessed/, 'preprocessed-transactions'],
  [/\bmev\b/, 'mev-protect'],
  [/rebate/, 'backrun-rebates'],
  [/gatekeeper|beta\.helius-rpc/, 'gatekeeper'],
  [/embedded wallet|wallet[\s-]as[\s-]a[\s-]service|\bwaas\b|wallet[\s-]kit/, 'waas'],
  [/privacy|confidential|shielded|zolana/, 'privacy'],
  [/admin api|project usage|credit usage|credits used/, 'admin-api'],
];

const KEYWORD_ROUTES: Array<[RegExp, string]> = [
  [/grpc|shred.*stream|stream.*shred/, 'laserstream'],
  [/shred/, 'shred-delivery'],
  [/dedicated node/, 'dedicated-nodes'],
  [/nft|asset/, 'das'],
  [/webhook/, 'webhooks'],
  [/fee|priority/, 'priority-fee'],
  [/wallet/, 'wallet-api'],
  [/compress/, 'zk-compression'],
  [/websocket|\bws\b/, 'enhanced-websockets'],
  [/transaction|parsed/, 'parsed-events'],
  [/send|submit/, 'sender'],
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Infer a documentation topic from a freeform query. */
export function inferDocTopic(query: string): string | undefined {
  const q = query.toLowerCase();
  const route = (routes: Array<[RegExp, string]>) => routes.find(([pattern]) => pattern.test(q))?.[1];

  const product = route(PRODUCT_ROUTES);
  if (product) return product;

  const exact = Object.keys(DOCS_INDEX)
    .sort((a, b) => b.length - a.length)
    .find((key) => new RegExp(`(^|[^a-z0-9-])${escapeRegExp(key)}($|[^a-z0-9-])`).test(q));
  if (exact) return exact;

  return route(KEYWORD_ROUTES);
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
 * Extract sections from markdown content that match keyword(s).
 *
 * Matches headers whose text contains the keyword (case-insensitive),
 * collecting all content until the next header at same/higher level.
 *
 * When `keywords` is an array, tries each keyword in order and returns the
 * first non-null match (handles header drift across doc versions).
 *
 * `includeLooseMatches` (default `true`): Also include non-header lines
 * containing the keyword outside matched sections. Set `false` for clean
 * section-only extraction (used by plan tools to avoid false positives).
 *
 * Returns `null` if nothing matched.
 */
export function extractSections(
  content: string,
  keywords: string | string[],
  opts?: { includeLooseMatches?: boolean }
): string | null {
  const keywordList = Array.isArray(keywords) ? keywords : [keywords];
  const includeLoose = opts?.includeLooseMatches ?? true;

  for (const keyword of keywordList) {
    const keywordLower = keyword.toLowerCase();
    const lines = content.split('\n');
    const relevantLines: string[] = [];
    let inRelevantSection = false;
    let sectionDepth = 0;

    for (const line of lines) {
      const headerMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (headerMatch) {
        const depth = headerMatch[1].length;
        const title = headerMatch[2].toLowerCase();

        if (title.includes(keywordLower)) {
          inRelevantSection = true;
          sectionDepth = depth;
          relevantLines.push(line);
        } else if (inRelevantSection && depth <= sectionDepth) {
          inRelevantSection = false;
        } else if (inRelevantSection) {
          relevantLines.push(line);
        }
      } else if (inRelevantSection) {
        relevantLines.push(line);
      } else if (includeLoose && line.toLowerCase().includes(keywordLower)) {
        relevantLines.push(line);
      }
    }

    if (relevantLines.length > 0) {
      return relevantLines.join('\n');
    }
  }

  return null;
}

/**
 * Truncate a doc response to avoid blowing up the context window.
 * Tries to cut at a section boundary for cleaner output.
 */
export const MAX_DOC_RESPONSE_CHARS = 15_000;

export function truncateDoc(text: string, limit = MAX_DOC_RESPONSE_CHARS): string {
  if (text.length <= limit) return text;
  const truncated = text.slice(0, limit);
  const lastSection = truncated.lastIndexOf('\n## ');
  const cutPoint = lastSection > limit * 0.5 ? lastSection : limit;
  return truncated.slice(0, cutPoint) +
    '\n\n---\n*Truncated. Use `lookupHeliusDocs` with a `section` filter for specific details.*';
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
