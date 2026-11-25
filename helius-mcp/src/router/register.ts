import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PublicToolName } from './action-groups.js';
import { getToolAnnotations } from './annotations.js';
import { describeTool } from './descriptions.js';
import { dispatchRoutedTool, expandStoredResult } from './dispatch.js';
import { getToolSchema } from './schemas.js';
import { getSurfaceTools, type Surface } from './surface.js';
import { withTelemetryHandler } from './telemetry.js';

type ToolDescription = { full: string; readOnly?: string };

/**
 * Public tool description intros. A tool whose intro names capabilities the
 * read-only surface removes gets its own read-only wording. Routed tools get
 * an action list and behavior notes appended by `describeTool`.
 */
const TOOL_DESCRIPTIONS: Record<PublicToolName, ToolDescription> = {
  heliusAccount: {
    full: 'Account setup, API keys, signup, plans, and billing. Use for pricing or account state, not per-method rate limits or credit costs.',
    readOnly: 'Account status, plans, pricing, and upgrade previews. Use for pricing or account state, not per-method rate limits or credit costs.',
  },
  heliusWallet: {
    full: 'Wallet-centric balances, holdings, identity, and wallet history. Use for portfolio views, not raw token accounts.',
  },
  heliusAsset: {
    full: 'Assets, NFTs, collections, proofs, and token holders. Use for DAS ownership or metadata, not transaction history.',
  },
  heliusTransaction: {
    full: 'Parsed transactions and wallet transaction history. Use for activity analysis, not raw account state.',
  },
  heliusChain: {
    full: 'Raw chain state, token accounts, historical account state at a past slot or transaction, stake reads, blocks, network status, priority fees, transaction and Jito bundle simulation, and bundle status. Use for token accounts or blocks, not wallet portfolio summaries.',
  },
  heliusStreaming: {
    full: 'Webhook CRUD, live subscription configuration, Parsed Streams program discovery, and Preconfirmations coverage. Use for actual webhook/subscription setup, not how-to guides.',
    readOnly: 'Webhook lookups, live subscription configuration, Parsed Streams program discovery, and Preconfirmations coverage. Use to inspect webhooks or generate subscription configs, not how-to guides.',
  },
  heliusKnowledge: {
    full: 'Docs, guides, pricing references, troubleshooting, source, blog, and SIMD research. Use for guides, rate limits, or errors, not live mutations.',
  },
  heliusWrite: {
    full: 'Mutating SOL/token transfer and staking actions. Use for sends or staking, not read-only queries.',
  },
  heliusCompression: {
    full: 'Compressed account, proof, balance, and compression history queries. Use for zk-compression state, not standard DAS assets.',
  },
  heliusPrivacy: {
    full: 'Solana Privacy Rings shielded-pool indexer reads: encrypted UTXOs and shielded transactions by view tag, nullifier, or signature, Merkle and non-inclusion proofs, and user records. Returns ciphertext and proofs; it cannot decrypt or sign.',
  },
  heliusLana: {
    full: 'Ask Lana, the Helius Solana AI agent, a question that needs many chained lookups: why a transaction failed, slippage on a swap, where a wallet\'s funds came from or went, whether two wallets are connected. Costs 2,000 credits per call (lana-fast, default) or 10,000 (lana-thinking) on paid plans and takes seconds to minutes, so anything one data tool answers goes to that tool. Unless the user asked for Lana or agreed to the cost, tell them the cost and ask before calling. Use lana-thinking only when they ask for deeper analysis.',
  },
  expandResult: {
    full: 'Expand a prior summary-first result by resultId: one section, item, or character range, a page, or the next page (continuation "next"). It re-runs the original action, so it costs that action\'s credits again. A resultId expires after 5 minutes, and a session keeps only its 10 most recent; after that, call the original tool again.',
  },
};

/**
 * Register the public tools of one surface, each with the description, input
 * schema, title, and annotations derived for that surface.
 */
export function registerRouterTools(server: McpServer, surface: Surface = 'full'): void {
  for (const tool of getSurfaceTools(surface)) {
    const annotations = getToolAnnotations(tool, surface);
    const intro = surface === 'readOnly'
      ? TOOL_DESCRIPTIONS[tool].readOnly ?? TOOL_DESCRIPTIONS[tool].full
      : TOOL_DESCRIPTIONS[tool].full;
    const description = tool === 'expandResult' ? intro : describeTool(tool, surface, intro);
    const handler = tool === 'expandResult'
      ? withTelemetryHandler(tool, (params, extra) => expandStoredResult(params, extra, surface))
      : withTelemetryHandler(tool, (params, extra) => dispatchRoutedTool(tool, params, extra, surface));

    server.registerTool(
      tool,
      { title: annotations.title, description, inputSchema: getToolSchema(tool, surface), annotations },
      handler,
    );
  }
}
