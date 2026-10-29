import {
  ACTION_GROUPS,
  PUBLIC_TOOL_NAMES,
  type PublicToolName,
  type RoutedPublicToolName,
} from './action-groups.js';
import type { ActionName } from './actions.js';
import { ACTION_CATALOG } from './catalog.js';
import { isDestructive, type ActionCatalogEntry, type Mutability } from './types.js';

/**
 * Which actions a server exposes. Fixed per server instance, so one deployment
 * can run both surfaces side by side.
 *
 * - `full`: every action, including transfers, staking, webhook CRUD, signup,
 *   and billing.
 * - `readOnly`: no action that changes state. This is the surface for the
 *   Anthropic, OpenAI, and xAI directories, whose policies do not allow an
 *   assistant to execute crypto transfers, and both directories reject tools
 *   that mix reads and writes.
 */
export type Surface = 'full' | 'readOnly';

/**
 * A write whose only side effect is carried by params that can be removed,
 * such as `recommendStack`'s `remember`. Without those params it is a read.
 *
 * This is the same claim `expandResult` already relies on when it replays a
 * stored recipe with `replayOmitParams` removed, and `pnpm validate` checks it.
 */
function isWriteConfinedToParams(entry: ActionCatalogEntry): boolean {
  return entry.mutability === 'write' && entry.nonDestructiveWrite === true && entry.replayOmitParams.length > 0;
}

export function isOnSurface(entry: ActionCatalogEntry, surface: Surface): boolean {
  return surface === 'full' || entry.mutability === 'read' || isWriteConfinedToParams(entry);
}

/** Params a surface removes from an action before it runs, and from its schema. */
export function getStrippedParams(entry: ActionCatalogEntry, surface: Surface): readonly string[] {
  return surface === 'readOnly' && isWriteConfinedToParams(entry) ? entry.replayOmitParams : [];
}

/** An action's mutability as the surface exposes it, with stripped params removed. */
export function getExposedMutability(entry: ActionCatalogEntry, surface: Surface): Mutability {
  return getStrippedParams(entry, surface).length > 0 ? 'read' : entry.mutability;
}

export function isExposedDestructive(entry: ActionCatalogEntry, surface: Surface): boolean {
  return getExposedMutability(entry, surface) === 'write' && isDestructive(entry);
}

/** A routed tool's actions on a surface, in the order its `action` enum lists them. */
export function getSurfaceActions(tool: RoutedPublicToolName, surface: Surface): ActionName[] {
  return ACTION_GROUPS[tool].filter((action) => isOnSurface(ACTION_CATALOG[action], surface));
}

/** Public tools on a surface. A routed tool left with no actions is not registered. */
export function getSurfaceTools(surface: Surface): PublicToolName[] {
  return PUBLIC_TOOL_NAMES.filter(
    (tool) => tool === 'expandResult' || getSurfaceActions(tool, surface).length > 0,
  );
}

export const READ_ONLY_FLAG = '--read-only';

/**
 * Resolve the stdio server's surface from `--read-only` or
 * `HELIUS_MCP_READ_ONLY`. Defaults to `full`.
 *
 * The env var fails closed: any value other than empty, `0`, or `false` means
 * read-only, so `yes` or `TRUE` cannot quietly serve writes.
 */
export function resolveSurface(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Surface {
  const raw = env.HELIUS_MCP_READ_ONLY?.trim().toLowerCase();
  const envReadOnly = raw !== undefined && raw !== '' && raw !== '0' && raw !== 'false';
  return argv.includes(READ_ONLY_FLAG) || envReadOnly ? 'readOnly' : 'full';
}

/**
 * Refusal for an action the surface does not expose. Schema validation stops
 * these first, since each `action` enum lists only the surface's actions; this
 * is the second line of defense for anything that reaches dispatch directly.
 */
export function surfaceRefusal(action: string): string {
  return `${action} changes state, and this Helius MCP server is read-only, so it is not available here. `
    + 'To configure an API key, set HELIUS_API_KEY in the server\'s environment. For transfers, staking, '
    + 'webhook changes, signup, or billing, use the full Helius MCP: `npx helius-mcp@latest`.';
}
