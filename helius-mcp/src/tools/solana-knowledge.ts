import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MCP_USER_AGENT } from '../http.js';

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const cache: Map<string, { content: string; fetchedAt: number }> = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function cachedFetch(url: string, headers?: Record<string, string>): Promise<string> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.content;
  }

  const response = await fetch(url, {
    headers: {
      'User-Agent': MCP_USER_AGENT,
      ...headers,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const content = await response.text();
  cache.set(url, { content, fetchedAt: Date.now() });
  return content;
}

// ---------------------------------------------------------------------------
// SIMD helpers
// ---------------------------------------------------------------------------

const SIMD_REPO = 'solana-foundation/solana-improvement-documents';
const SIMD_API_URL = `https://api.github.com/repos/${SIMD_REPO}/contents/proposals`;
const SIMD_RAW_BASE = `https://raw.githubusercontent.com/${SIMD_REPO}/main/proposals`;

let simdIndex: Array<{ number: string; slug: string; filename: string }> | null = null;
let simdIndexFetchedAt = 0;

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  };
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function getSimdIndex(): Promise<NonNullable<typeof simdIndex>> {
  if (simdIndex && Date.now() - simdIndexFetchedAt < CACHE_TTL_MS) {
    return simdIndex;
  }

  const response = await fetch(SIMD_API_URL, {
    headers: { 'User-Agent': MCP_USER_AGENT, ...githubHeaders() },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch SIMD index: HTTP ${response.status}`);
  }

  const files = (await response.json()) as Array<{ name: string }>;
  simdIndex = files
    .filter((f) => f.name.endsWith('.md'))
    .map((f) => {
      const match = f.name.match(/^(\d+)-(.+)\.md$/);
      return match ? { number: match[1], slug: match[2], filename: f.name } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  simdIndexFetchedAt = Date.now();
  return simdIndex;
}

// ---------------------------------------------------------------------------
// HTML-to-text helper (lightweight, no dependencies)
// ---------------------------------------------------------------------------

function htmlToText(html: string): string {
  // Extract main article content (skip nav, header, footer)
  let content = html;
  // Use greedy match to capture everything between first opening and last closing tag
  const articleMatch = html.match(/<article[^>]*>([\s\S]*)<\/article>/i);
  if (articleMatch) {
    content = articleMatch[1];
  } else {
    const mainMatch = html.match(/<main[^>]*>([\s\S]*)<\/main>/i);
    if (mainMatch) {
      content = mainMatch[1];
    }
  }

  return (
    content
      // Strip non-content elements before conversion
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      // Convert headers
      .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
      .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
      .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
      .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n')
      // Convert code blocks
      .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n')
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
      // Convert lists
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
      // Convert paragraphs and line breaks
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n')
      .replace(/<br\s*\/?>/gi, '\n')
      // Convert links
      .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
      // Convert bold/italic
      .replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**')
      .replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*')
      // Strip remaining HTML tags
      .replace(/<[^>]+>/g, '')
      // Decode common HTML entities
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      // Decode remaining numeric HTML entities (&#123; and &#xAB;)
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      // Clean up whitespace
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

// ---------------------------------------------------------------------------
// Blog index — curated list of the most technical Helius blog posts
// ---------------------------------------------------------------------------

const BLOG_INDEX: Record<string, { title: string; category: string }> = {
  // SVM & Runtime
  'solana-virtual-machine': { title: 'What is the Solana Virtual Machine (SVM)?', category: 'runtime' },
  'solana-pda': { title: 'What are Solana PDAs? Explanation & Examples', category: 'runtime' },
  'the-solana-programming-model-an-introduction-to-developing-on-solana': {
    title: 'The Solana Programming Model',
    category: 'runtime',
  },
  'solana-slots-blocks-and-epochs': { title: 'Understanding Slots, Blocks, and Epochs', category: 'runtime' },
  'solana-arithmetic': { title: 'Solana Arithmetic: Best Practices for Financial Apps', category: 'runtime' },
  'solana-commitment-levels': { title: 'What are Solana Commitment Levels?', category: 'runtime' },
  'solana-vs-sui-transaction-lifecycle': {
    title: 'At The Edge Of Determinism: Transaction Lifecycle',
    category: 'runtime',
  },
  'asynchronous-program-execution': { title: 'Asynchronous Program Execution', category: 'runtime' },

  // Consensus & Network
  'consensus-on-solana': { title: 'Consensus on Solana', category: 'consensus' },
  'alpenglow': { title: "Alpenglow: Solana's Great Consensus Rewrite", category: 'consensus' },
  'turbine-block-propagation-on-solana': { title: 'Turbine: Block Propagation on Solana', category: 'consensus' },
  'solana-gulf-stream': { title: "Solana's Gulf Stream", category: 'consensus' },
  'all-you-need-to-know-about-solana-and-quic': {
    title: 'QUIC Protocol and Spam Mitigation',
    category: 'consensus',
  },
  'proof-of-history-proof-of-stake-proof-of-work-explained': {
    title: 'Proof of History, Proof of Stake, Proof of Work',
    category: 'consensus',
  },
  'cryptographic-tools-101-hash-functions-and-merkle-trees-explained': {
    title: 'Cryptographic Tools 101',
    category: 'consensus',
  },
  'what-is-firedancer': { title: 'What is Firedancer?', category: 'consensus' },

  // Transactions & Fees
  'priority-fees-understanding-solanas-transaction-fee-mechanics': {
    title: 'Priority Fees: Understanding Fee Mechanics',
    category: 'transactions',
  },
  'solana-fees-in-theory-and-practice': { title: 'Solana Fees in Theory and Practice', category: 'transactions' },
  'solana-local-fee-markets': { title: 'The Truth about Solana Local Fee Markets', category: 'transactions' },
  'how-to-land-transactions-on-solana': { title: 'How to Land Transactions on Solana', category: 'transactions' },
  'how-to-deal-with-blockhash-errors-on-solana': {
    title: 'How to Deal with Blockhash Errors',
    category: 'transactions',
  },
  'solana-congestion-how-to-best-send-solana-transactions': {
    title: 'Solana Congestion: How to Best Send Transactions',
    category: 'transactions',
  },
  'solana-mev-an-introduction': { title: 'Solana MEV: An Introduction', category: 'transactions' },
  'stake-weighted-quality-of-service-everything-you-need-to-know': {
    title: 'Stake-Weighted Quality of Service',
    category: 'transactions',
  },
  'solana-transactions': { title: 'Solana Transactions: Durable Nonces', category: 'transactions' },
  'block-assembly-marketplace-bam': { title: 'Block Assembly Marketplace (BAM)', category: 'transactions' },

  // Validators & Economics
  'solana-validator-economics-a-primer': { title: 'Solana Validator Economics: A Primer', category: 'validators' },
  'solana-nodes-a-primer-on-solana-rpcs-validators-and-rpc-providers': {
    title: 'Solana Nodes: A Primer',
    category: 'validators',
  },
  'solana-issuance-inflation-schedule': { title: "Is Solana's Inflation Too High?", category: 'validators' },
  'bringing-slashing-to-solana': { title: 'Bringing Slashing to Solana', category: 'validators' },
  'solana-decentralization-facts-and-figures': {
    title: "Measuring Solana's Decentralization",
    category: 'validators',
  },
  'solana-governance--a-comprehensive-analysis': {
    title: 'Solana Governance: A Comprehensive Analysis',
    category: 'validators',
  },
  'simd-228': { title: 'SIMD-228: A Critical Analysis', category: 'validators' },

  // Data & Infrastructure
  'solana-geyser-plugins-streaming-data-at-the-speed-of-light': {
    title: 'Solana Geyser Plugins',
    category: 'data',
  },
  'all-you-need-to-know-about-compression-on-solana': {
    title: 'All You Need to Know About Compression',
    category: 'data',
  },
  'zk-compression-keynote-breakpoint-2024': { title: 'ZK Compression Keynote', category: 'data' },
  'how-solana-rpcs-work': { title: 'How Solana RPCs Work', category: 'data' },
  'solana-rpc': { title: 'All You Need to Know About Solana RPCs', category: 'data' },
  'solana-data-streaming': { title: 'Listening to Onchain Events on Solana', category: 'data' },
  'doublezero-a-faster-internet': { title: 'DoubleZero: A Faster Internet', category: 'data' },
  'solana-post-quantum-cryptography': { title: 'Post-Quantum Cryptography on Solana', category: 'data' },
  'solana-shreds': { title: 'Winning the Millisecond Game: Shreds and LaserStream', category: 'data' },
  'zero-slot': { title: 'Achieving Zero-Slot Execution with Sender and LaserStream', category: 'data' },

  // Security
  'a-hitchhikers-guide-to-solana-program-security': {
    title: "A Hitchhiker's Guide to Solana Program Security",
    category: 'security',
  },
  'solana-hacks': { title: 'Solana Hacks, Bugs, and Exploits: A Complete History', category: 'security' },
  'solana-outages-complete-history': { title: 'A Complete History of Solana Outages', category: 'security' },

  // Development Frameworks & Guides
  'optimizing-solana-programs': { title: 'Optimizing Solana Programs', category: 'development' },
  'sbpf-assembly': { title: 'How to Write Solana Programs with SBPF Assembly', category: 'development' },
  'steel': { title: 'How to Write Solana Programs with Steel', category: 'development' },
  'pinocchio': { title: 'How to Build Solana Programs with Pinocchio', category: 'development' },
  'gill': { title: 'How to Build Solana Apps with Gill', category: 'development' },
  'an-introduction-to-anchor-a-beginners-guide-to-building-solana-programs': {
    title: 'An Introduction to Anchor',
    category: 'development',
  },
  'how-to-start-building-with-the-solana-web3-js-2-0-sdk': {
    title: 'Building with Solana Web3.js 2.0',
    category: 'development',
  },

  // DeFi & Tokens
  'what-is-token-2022': { title: 'What are Token Extensions?', category: 'tokens' },
  'lsts-on-solana': { title: 'Liquid Staking and LSTs on Solana', category: 'tokens' },
  'solanas-stablecoin-landscape': { title: "Solana's Stablecoin Landscape", category: 'tokens' },
  'solana-real-world-assets': { title: 'Real World Assets on Solana', category: 'tokens' },
};

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerSolanaKnowledgeTools(server: McpServer) {
  // =========================================================================
  // Tool 1: getSIMD — Fetch a Solana Improvement Document by number
  // =========================================================================
  server.tool(
    'getSIMD',
    'Fetch a Solana Improvement Document (SIMD) proposal by number. Returns the full proposal markdown including motivation, design, specification, and security considerations. SIMDs are the formal governance mechanism for Solana protocol changes.',
    {
      number: z
        .string()
        .describe('SIMD number, e.g. "228" or "0096". Will be zero-padded automatically.'),
    },
    async ({ number }) => {
      try {
        const paddedNumber = number.replace(/^0+/, '').padStart(4, '0');
        const index = await getSimdIndex();

        const entry = index.find((e) => e.number === paddedNumber);
        if (!entry) {
          const nearby = index
            .filter((e) => {
              const n = parseInt(e.number, 10);
              const target = parseInt(paddedNumber, 10);
              return Math.abs(n - target) <= 10;
            })
            .map((e) => `  SIMD-${e.number}: ${e.slug}`)
            .join('\n');

          return {
            content: [
              {
                type: 'text' as const,
                text: `SIMD-${paddedNumber} not found.\n\n${nearby ? `Nearby proposals:\n${nearby}` : `Total proposals available: ${index.length}`}`,
              },
            ],
          };
        }

        const url = `${SIMD_RAW_BASE}/${entry.filename}`;
        const content = await cachedFetch(url);

        const result = [
          `# SIMD-${entry.number}: ${entry.slug}`,
          '',
          content,
          '',
          '---',
          `Source: https://github.com/${SIMD_REPO}/blob/main/proposals/${entry.filename}`,
        ].join('\n');

        return { content: [{ type: 'text' as const, text: result }] };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error fetching SIMD: ${errorMsg}` }],
          isError: true,
        };
      }
    }
  );

  // =========================================================================
  // Tool 2: listSIMDs — List available SIMD proposals
  // =========================================================================
  server.tool(
    'listSIMDs',
    'List all available Solana Improvement Document (SIMD) proposals. Returns proposal numbers and titles. Use getSIMD to fetch the full content of a specific proposal.',
    {},
    async () => {
      try {
        const index = await getSimdIndex();
        if (index.length === 0) {
          throw new Error('Could not fetch SIMD index');
        }

        const lines = [
          '# Solana Improvement Documents (SIMDs)',
          '',
          `${index.length} proposals available. Use \`getSIMD\` with a number to read the full proposal.`,
          '',
          '| SIMD | Title |',
          '|------|-------|',
          ...index.map((e) => `| ${e.number} | ${e.slug.replace(/-/g, ' ')} |`),
        ];

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error listing SIMDs: ${errorMsg}` }],
          isError: true,
        };
      }
    }
  );

  // =========================================================================
  // Tool 3: readSolanaSourceFile — Read a file from the Agave/Firedancer repo
  // =========================================================================
  server.tool(
    'readSolanaSourceFile',
    'Read a source file from the Agave (Solana validator) or Firedancer codebase on GitHub. Use this to look up how specific components are implemented (e.g., banking stage, vote program, BPF loader, SVM runtime). Provide the file path relative to the repo root.',
    {
      path: z
        .string()
        .describe(
          'File path relative to repo root, e.g. "runtime/src/bank.rs", "programs/vote/src/vote_state/mod.rs", "svm/src/lib.rs"'
        ),
      repo: z
        .enum(['agave', 'firedancer'])
        .default('agave')
        .describe(
          'Which repo to read from. "agave" = anza-xyz/agave (Rust validator), "firedancer" = firedancer-io/firedancer (C validator)'
        ),
      branch: z
        .string()
        .optional()
        .describe('Branch to read from. Defaults to "master" for agave, "main" for firedancer.'),
    },
    async ({ path, repo, branch }) => {
      try {
        const repoMap: Record<string, { fullName: string; defaultBranch: string }> = {
          agave: { fullName: 'anza-xyz/agave', defaultBranch: 'master' },
          firedancer: { fullName: 'firedancer-io/firedancer', defaultBranch: 'main' },
        };

        const repoInfo = repoMap[repo] ?? repoMap['agave'];
        const repoFullName = repoInfo.fullName;
        const resolvedBranch = branch ?? repoInfo.defaultBranch;
        const url = `https://raw.githubusercontent.com/${repoFullName}/${resolvedBranch}/${path}`;
        const content = await cachedFetch(url);

        const MAX_CHARS = 50_000;
        const truncated = content.length > MAX_CHARS;
        const displayContent = truncated
          ? content.slice(0, MAX_CHARS) +
            `\n\n... [truncated at ${MAX_CHARS} chars, file is ${content.length} chars total]`
          : content;

        const result = [
          `# ${repoFullName}/${path} (${resolvedBranch})`,
          '',
          '```',
          displayContent,
          '```',
          '',
          '---',
          `Source: https://github.com/${repoFullName}/blob/${resolvedBranch}/${path}`,
        ].join('\n');

        return { content: [{ type: 'text' as const, text: result }] };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error reading source file: ${errorMsg}\n\nTips:\n- Check the path is correct (e.g., "svm/src/lib.rs")\n- Browse https://github.com/anza-xyz/agave to find the right path\n- The default branch is "master"`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // =========================================================================
  // Tool 4: searchSolanaDocs — Fetch official Solana documentation
  // =========================================================================
  server.tool(
    'searchSolanaDocs',
    'Search the official Solana documentation (solana.com/docs). Covers core concepts (accounts, transactions, programs, PDAs, CPIs), RPC API reference, token standards, and development guides. Returns sections matching your query from the AI-optimized documentation.',
    {
      query: z
        .string()
        .describe(
          'Search term or topic, e.g. "PDAs", "transaction format", "getAccountInfo", "token extensions", "cross program invocation"'
        ),
    },
    async ({ query }) => {
      try {
        const content = await cachedFetch('https://solana.com/llms-full.txt');

        const queryLower = query.toLowerCase();
        const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);
        const lines = content.split('\n');
        const relevantSections: string[] = [];
        let inRelevantSection = false;
        let sectionDepth = 0;
        let sectionLines: string[] = [];

        for (const line of lines) {
          const headerMatch = line.match(/^(#{1,4})\s+(.+)/);

          if (headerMatch) {
            const depth = headerMatch[1].length;
            const title = headerMatch[2].toLowerCase();

            // Flush previous relevant section
            if (inRelevantSection && depth <= sectionDepth) {
              relevantSections.push(sectionLines.join('\n'));
              sectionLines = [];
              inRelevantSection = false;
            }

            if (
              title.includes(queryLower) ||
              (queryWords.length > 0 && queryWords.every((word) => title.includes(word)))
            ) {
              inRelevantSection = true;
              sectionDepth = depth;
              sectionLines.push(line);
            } else if (inRelevantSection) {
              sectionLines.push(line);
            }
          } else if (inRelevantSection) {
            sectionLines.push(line);
          }
        }

        // Flush last section
        if (inRelevantSection && sectionLines.length > 0) {
          relevantSections.push(sectionLines.join('\n'));
        }

        if (relevantSections.length === 0) {
          // Fallback: return lines containing the query as individual matches
          const matchingLines = lines.filter((l) => l.toLowerCase().includes(queryLower));
          if (matchingLines.length > 0) {
            const result = [
              `# Solana Docs: "${query}"`,
              '',
              `No exact section match, but found ${matchingLines.length} lines containing "${query}":`,
              '',
              ...matchingLines.slice(0, 50),
              '',
              '---',
              'Source: https://solana.com/docs',
            ].join('\n');
            return { content: [{ type: 'text' as const, text: result }] };
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: `No matches for "${query}" in Solana docs. Try:\n- Broader terms (e.g., "accounts" instead of "account info")\n- Official API method names (e.g., "getAccountInfo")\n- Core concepts: accounts, transactions, programs, PDAs, CPI, fees, tokens`,
              },
            ],
          };
        }

        const MAX_CHARS = 40_000;
        let combined = relevantSections.join('\n\n---\n\n');
        if (combined.length > MAX_CHARS) {
          combined = combined.slice(0, MAX_CHARS) + '\n\n... [results truncated]';
        }

        const result = [
          `# Solana Docs: "${query}"`,
          '',
          combined,
          '',
          '---',
          'Source: https://solana.com/docs',
        ].join('\n');

        return { content: [{ type: 'text' as const, text: result }] };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error searching Solana docs: ${errorMsg}` }],
          isError: true,
        };
      }
    }
  );

  // =========================================================================
  // Tool 5: fetchHeliusBlog — Fetch a Helius blog post
  // =========================================================================
  server.tool(
    'fetchHeliusBlog',
    'Fetch a technical blog post from Helius (helius.dev/blog). The Helius blog covers SVM internals, consensus, transactions, fees, MEV, validator economics, development frameworks, security, and more. Use "list" to see available posts or "fetch" to read one.',
    {
      action: z
        .enum(['fetch', 'list'])
        .describe('"fetch" to read a specific post, "list" to see available posts by category'),
      slug: z
        .string()
        .optional()
        .describe(
          'Blog post slug (required for "fetch"), e.g. "solana-virtual-machine", "consensus-on-solana", "alpenglow"'
        ),
      category: z
        .enum(['all', 'runtime', 'consensus', 'transactions', 'validators', 'data', 'security', 'development', 'tokens'])
        .default('all')
        .describe('Filter by category when listing posts'),
    },
    async ({ action, slug, category }) => {
      try {
        if (action === 'list') {
          const entries = Object.entries(BLOG_INDEX);
          const filtered =
            category === 'all' ? entries : entries.filter(([, info]) => info.category === category);

          // Group by category
          const grouped: Record<string, Array<{ slug: string; title: string }>> = {};
          for (const [s, info] of filtered) {
            if (!grouped[info.category]) grouped[info.category] = [];
            grouped[info.category].push({ slug: s, title: info.title });
          }

          const categoryLabels: Record<string, string> = {
            runtime: 'SVM Runtime & Execution',
            consensus: 'Consensus & Network Protocols',
            transactions: 'Transactions, Fees & MEV',
            validators: 'Validators & Economics',
            data: 'Data Layer & Infrastructure',
            security: 'Security & History',
            development: 'Development Frameworks & Guides',
            tokens: 'Tokens, DeFi & Standards',
          };

          const lines = [
            '# Helius Blog — Technical Posts Index',
            '',
            `${filtered.length} posts available. Use \`fetchHeliusBlog\` with action "fetch" and a slug to read the full post.`,
            '',
          ];

          for (const [cat, posts] of Object.entries(grouped)) {
            lines.push(`## ${categoryLabels[cat] ?? cat}`);
            for (const p of posts) {
              lines.push(`- \`${p.slug}\` — ${p.title}`);
            }
            lines.push('');
          }

          return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        }

        // Fetch a specific post
        if (!slug) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Please provide a slug. Use `fetchHeliusBlog` with action "list" to see available posts.',
              },
            ],
          };
        }

        const url = `https://www.helius.dev/blog/${slug}`;
        const html = await cachedFetch(url);
        const text = htmlToText(html);

        const MAX_CHARS = 50_000;
        const truncated = text.length > MAX_CHARS;
        const displayContent = truncated ? text.slice(0, MAX_CHARS) + '\n\n... [truncated]' : text;

        const blogInfo = BLOG_INDEX[slug];
        const title = blogInfo?.title ?? slug;

        const result = [`# ${title}`, '', displayContent, '', '---', `Source: ${url}`].join('\n');

        return { content: [{ type: 'text' as const, text: result }] };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching blog: ${errorMsg}\n\nUse \`fetchHeliusBlog\` with action "list" to see available posts.`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
