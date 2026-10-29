import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { PublicToolName } from './action-groups.js';
import { ACTION_CATALOG } from './catalog.js';
import { getExposedMutability, getSurfaceActions, isExposedDestructive, type Surface } from './surface.js';

/**
 * Human-readable tool titles. Directory reviewers require one on every tool,
 * and clients show it in place of the tool name.
 */
export const TOOL_TITLES: Record<PublicToolName, string> = {
  heliusAccount: 'Helius Account & Billing',
  heliusWallet: 'Wallet Balances & History',
  heliusAsset: 'Assets, NFTs & Token Holders',
  heliusTransaction: 'Parsed Transactions & History',
  heliusChain: 'Chain State, Blocks & Fees',
  heliusStreaming: 'Webhooks & Streaming',
  heliusKnowledge: 'Helius Docs & Knowledge',
  heliusWrite: 'Send & Stake',
  heliusCompression: 'ZK Compression',
  expandResult: 'Expand Result',
};

/**
 * Annotations for one public tool on a surface, derived from the actions it
 * routes to there, so they cannot drift from the catalog's read/write labels:
 *
 * - `readOnlyHint`: no action the tool routes to is a write.
 * - `destructiveHint`: at least one of its writes is destructive. Explicitly
 *   false for read-only tools, since the MCP default is true.
 * - `idempotentHint`: true for read-only tools; writes are not assumed to be.
 * - `openWorldHint`: always true. Every tool reaches Helius APIs or public
 *   chain data, which change independently of the caller.
 *
 * Only the surface's actions count, with any params the surface strips
 * removed, so every tool on the read-only surface is read-only.
 *
 * `expandResult` only re-runs stored recipes, and only read or non-destructive
 * actions with their side-effect params removed can be stored (enforced by the
 * catalog validator), so it is read-only.
 */
export function getToolAnnotations(tool: PublicToolName, surface: Surface = 'full'): ToolAnnotations {
  const title = TOOL_TITLES[tool];
  if (tool === 'expandResult') {
    return { title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  }

  const entries = getSurfaceActions(tool, surface).map((action) => ACTION_CATALOG[action]);
  const readOnly = entries.every((entry) => getExposedMutability(entry, surface) === 'read');
  return {
    title,
    readOnlyHint: readOnly,
    destructiveHint: entries.some((entry) => isExposedDestructive(entry, surface)),
    idempotentHint: readOnly,
    openWorldHint: true,
  };
}
