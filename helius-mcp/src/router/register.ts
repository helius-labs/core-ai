import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PublicToolName } from './action-groups.js';
import { getToolAnnotations } from './annotations.js';
import { dispatchRoutedTool, expandStoredResult } from './dispatch.js';
import { getToolSchema } from './schemas.js';
import { getSurfaceTools, type Surface } from './surface.js';
import { withTelemetryHandler } from './telemetry.js';

type ToolDescription = { full: string; readOnly?: string };

/**
 * Public tool descriptions. A tool whose full description names capabilities
 * the read-only surface removes gets its own read-only wording.
 */
const TOOL_DESCRIPTIONS: Record<PublicToolName, ToolDescription> = {
  heliusAccount: {
    full: 'Account setup, API keys, signup, plans, and billing. Use for pricing or account state, not per-method rate limits.',
    readOnly: 'Account status, plans, pricing, and upgrade previews. Use for pricing or account state, not per-method rate limits.',
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
    full: 'Raw chain state, token accounts, stake reads, blocks, network status, priority fees, transaction and Jito bundle simulation, and bundle status. Use for token accounts or blocks, not wallet portfolio summaries.',
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
  expandResult: {
    full: 'Expand a prior summary-first result by resultId, section, range, page, or continuation.',
  },
};

/**
 * Register the public tools of one surface, each with the description, input
 * schema, title, and annotations derived for that surface.
 */
export function registerRouterTools(server: McpServer, surface: Surface = 'full'): void {
  for (const tool of getSurfaceTools(surface)) {
    const annotations = getToolAnnotations(tool, surface);
    const description = surface === 'readOnly'
      ? TOOL_DESCRIPTIONS[tool].readOnly ?? TOOL_DESCRIPTIONS[tool].full
      : TOOL_DESCRIPTIONS[tool].full;
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
