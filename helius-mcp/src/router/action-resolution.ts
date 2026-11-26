import { ACTION_GROUPS, type RoutedPublicToolName } from './action-groups.js';
import { ACTION_NAMES, ACTION_NAME_SET, type ActionName } from './actions.js';
import { ACTION_ALIASES } from './aliases.js';
import { ACTION_CATALOG } from './catalog.js';
import { getRequiredParams } from './descriptions.js';
import { getSurfaceActions, isOnSurface, type Surface } from './surface.js';

/**
 * Why a requested action did not name one of the called tool's actions:
 *
 * - `wrongTool`: a real action, but another tool's.
 * - `qualifiedName`: the right action written as `tool.action`.
 * - `alias`: a method name from another API (see `ACTION_ALIASES`).
 * - `misspelled`: close to one action, by case, separators, or a few letters.
 * - `unknown`: nothing close.
 */
export type RoutingMissKind = 'wrongTool' | 'qualifiedName' | 'alias' | 'misspelled' | 'unknown';

export type RoutingSuggestion = { tool: RoutedPublicToolName; action: ActionName };

export type ActionResolution =
  | { ok: true; action: ActionName }
  | { ok: false; kind: RoutingMissKind; message: string; suggestion?: RoutingSuggestion };

type Match = { action: ActionName; kind: Exclude<RoutingMissKind, 'unknown'>; note?: string };

/** Lowercase with separators removed, so `get_balance` and `GetBalance` meet `getBalance`. */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const ACTIONS_BY_NORMALIZED = new Map<string, ActionName>(
  ACTION_NAMES.map((action) => [normalize(action), action]),
);

const ALIASES_BY_NORMALIZED = new Map(
  Object.entries(ACTION_ALIASES).map(([alias, target]) => [normalize(alias), target]),
);

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * The surface action closest to a misspelled name, within a couple of edits.
 * Ties go to the called tool's own actions, then alphabetically.
 */
function closestAction(name: string, tool: RoutedPublicToolName, surface: Surface): ActionName | undefined {
  const target = normalize(name);
  const limit = Math.max(2, Math.floor(target.length / 5));
  let best: { action: ActionName; distance: number; own: boolean } | undefined;

  for (const action of ACTION_NAMES) {
    if (!isOnSurface(ACTION_CATALOG[action], surface)) continue;
    const distance = editDistance(target, normalize(action));
    if (distance > limit) continue;
    const own = ACTION_CATALOG[action].publicTool === tool;
    const better = !best
      || distance < best.distance
      || (distance === best.distance && own && !best.own)
      || (distance === best.distance && own === best.own && action < best.action);
    if (better) best = { action, distance, own };
  }
  return best?.action;
}

function onSurface(action: ActionName | undefined, surface: Surface): action is ActionName {
  return action !== undefined && isOnSurface(ACTION_CATALOG[action], surface);
}

function findIntendedAction(requested: string, tool: RoutedPublicToolName, surface: Surface): Match | undefined {
  const qualified = requested.includes('.');
  const name = qualified ? requested.slice(requested.lastIndexOf('.') + 1) : requested;

  if (ACTION_NAME_SET.has(name) && onSurface(name as ActionName, surface)) {
    const action = name as ActionName;
    const kind = ACTION_CATALOG[action].publicTool === tool ? 'qualifiedName' : 'wrongTool';
    return { action, kind };
  }

  const alias = ACTION_ALIASES[name] ?? ALIASES_BY_NORMALIZED.get(normalize(name));
  if (alias && onSurface(alias.action, surface)) {
    return { action: alias.action, kind: 'alias', note: alias.note };
  }

  const recased = ACTIONS_BY_NORMALIZED.get(normalize(name));
  if (onSurface(recased, surface)) {
    return { action: recased, kind: 'misspelled' };
  }

  const closest = closestAction(name, tool, surface);
  return closest ? { action: closest, kind: 'misspelled' } : undefined;
}

/** Echo a model-supplied name without letting a long or odd value flood the error. */
function quote(requested: string): string {
  const clipped = requested.length > 80 ? `${requested.slice(0, 80)}…` : requested;
  return `"${clipped}"`;
}

function callToMake(tool: RoutedPublicToolName, action: ActionName): string {
  const target = ACTION_CATALOG[action].publicTool;
  return target === tool ? `action "${action}"` : `${target} with action "${action}"`;
}

function requiredSuffix(action: ActionName): string {
  const required = getRequiredParams(action);
  return required.length > 0 ? ` Required parameters: ${required.join(', ')}.` : '';
}

function describeMiss(requested: string, tool: RoutedPublicToolName, match: Match): string {
  const call = callToMake(tool, match.action);
  const required = requiredSuffix(match.action);
  switch (match.kind) {
    case 'wrongTool':
      return `${match.action} is an action of ${ACTION_CATALOG[match.action].publicTool}, not ${tool}. Call ${call}.${required}`;
    case 'qualifiedName':
      return `Pass the bare action name: action "${match.action}", not ${quote(requested)}.${required}`;
    case 'alias':
      return `${quote(requested)} is not an action of this server. Call ${call} instead${match.note ? ` (${match.note})` : ''}.${required}`;
    case 'misspelled':
      return `Unknown action ${quote(requested)} for ${tool}. Did you mean ${call}?${required}`;
  }
}

/**
 * Resolve the `action` a routed tool was called with.
 *
 * Only an exact name from the tool's own actions on this surface resolves. For
 * anything else the result is an error that names the call to make, so the
 * model can retry once instead of guessing. Nothing is ever run on a guess:
 * the called tool's schema has already dropped any field it does not list, so
 * running another tool's action from here could quietly lose a filter.
 *
 * Suggestions only name actions on the surface, so the read-only server never
 * points at a write. An exact action the surface removes is refused before
 * this is reached (see `dispatchRoutedTool`).
 */
export function resolveRoutedAction(tool: RoutedPublicToolName, requested: string, surface: Surface): ActionResolution {
  if ((ACTION_GROUPS[tool] as readonly string[]).includes(requested) && onSurface(requested as ActionName, surface)) {
    return { ok: true, action: requested as ActionName };
  }

  const match = findIntendedAction(requested, tool, surface);
  if (!match) {
    return {
      ok: false,
      kind: 'unknown',
      message: `Unknown action ${quote(requested)} for ${tool}. Its actions: ${getSurfaceActions(tool, surface).join(', ')}.`,
    };
  }

  return {
    ok: false,
    kind: match.kind,
    message: describeMiss(requested, tool, match),
    suggestion: { tool: ACTION_CATALOG[match.action].publicTool, action: match.action },
  };
}
