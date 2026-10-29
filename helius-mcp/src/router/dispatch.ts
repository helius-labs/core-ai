import { getStoredResult, putStoredResult } from '../results/store.js';
import type { ContinuationHint, ContinuationState, StoredResult } from '../results/types.js';
import { callActionHandler, type ActionHandlerResponse } from './action-handlers.js';
import { getActionCatalogEntry } from './catalog.js';
import { getRouterContext } from './context.js';
import type { RoutedPublicToolName } from './action-groups.js';
import type { ActionName } from './actions.js';
import { ACTION_REQUIRED_PARAMS } from './required-params.js';
import { getStrippedParams, isOnSurface, surfaceRefusal, type Surface } from './surface.js';
import type { ActionCatalogEntry, DetailLevel, ResponseFamily } from './types.js';
import {
  applyItemSelection,
  applyRangeSelection,
  applySectionSelection,
  buildTextVariant,
  collectSectionHints,
  compactErrorText,
  estimateRenderedSize,
  getFamilyLimit,
  mcpErrorCompact,
  mcpResultHandle,
  mcpText,
  toPlainText,
  type RouterResponse,
} from './responses.js';

function isHandleEligible(entry: ActionCatalogEntry): boolean {
  return entry.handleEligibility;
}

function pickRequestedDetail(entry: ActionCatalogEntry, detail?: unknown): DetailLevel {
  if (detail === 'summary' || detail === 'standard' || detail === 'full') {
    return detail;
  }
  return entry.defaultDetail;
}

function buildActionParams(input: Record<string, unknown>): Record<string, unknown> {
  const { action: _action, detail: _detail, args, ...topLevel } = input;
  const merged: Record<string, unknown> = {
    ...(args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}),
  };

  for (const [key, value] of Object.entries(topLevel)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  // Normalize common address field mismatches
  if (!merged.address && merged.ownerAddress) merged.address = merged.ownerAddress;
  if (!merged.owner && merged.address && !merged.ownerAddress) merged.owner = merged.address;
  if (!merged.address && merged.owner) merged.address = merged.owner;

  return merged;
}

function detectContinuation(params: Record<string, unknown>, hint?: ContinuationHint): ContinuationState {
  // Prefer structured metadata emitted by the handler over parsing its output.
  if (hint) {
    if (hint.kind === 'paginationToken') {
      return {
        model: 'transactionHistory',
        next: hint.api === 'raw'
          ? { kind: 'rawApi', paginationToken: hint.token }
          : { kind: 'historyApi', paginationToken: hint.token },
      };
    }
    if (hint.kind === 'signaturesQuick') {
      return {
        model: 'transactionHistory',
        next: {
          kind: 'signaturesQuick',
          nextBefore: hint.lastSignature,
          lastSeenSignature: hint.lastSignature,
          until: hint.until,
        },
      };
    }
  }

  // Page-based pagination is param-driven (not output-parsed), so it stays here.
  if (typeof params.page === 'number') {
    return { model: 'page', nextPage: params.page + 1 };
  }

  return { model: 'none' };
}

function buildAvailableExpansions(
  family: ResponseFamily,
  continuation: ContinuationState,
  sectionHints: string[],
): string[] {
  const expansions = new Set<string>(['full']);

  if (family === 'document' || sectionHints.length > 0) {
    expansions.add('section');
    expansions.add('range');
  }

  if (family === 'list' || family === 'history') {
    expansions.add('item');
  }

  if (continuation.model === 'page') {
    expansions.add('page');
  }

  if (continuation.model === 'transactionHistory' && continuation.next) {
    expansions.add('continuation');
  }

  return Array.from(expansions);
}

function buildStoredResult(
  entry: ActionCatalogEntry,
  publicTool: RoutedPublicToolName,
  params: Record<string, unknown>,
  summary: string,
  text: string,
  ownerSessionKey: string,
  hint?: ContinuationHint,
): StoredResult {
  // Side-effect params stay out of the recipe, so expanding never replays a write.
  const replayParams = Object.fromEntries(
    Object.entries(params).filter(([key]) => !entry.replayOmitParams.includes(key)),
  );
  const continuation = detectContinuation(replayParams, hint);
  const sectionHints = collectSectionHints(text);
  const stored = putStoredResult({
    kind: entry.responseFamily,
    ownerSessionKey,
    summary,
    availableExpansions: buildAvailableExpansions(entry.responseFamily, continuation, sectionHints),
    payload: {
      recipe: {
        publicTool,
        action: entry.action,
        params: replayParams,
        responseFamily: entry.responseFamily,
        defaultDetail: entry.defaultDetail,
      },
      continuation,
      sectionHints,
    },
  });

  return stored;
}

function normalizeSuccessResponse(
  entry: ActionCatalogEntry,
  publicTool: RoutedPublicToolName,
  params: Record<string, unknown>,
  text: string,
  requestedDetail: DetailLevel,
  allowHandles: boolean,
  ownerSessionKey: string,
  hint?: ContinuationHint,
): RouterResponse {
  const baseText = text.trim();
  const summaryText = buildTextVariant(entry.responseFamily, 'summary', baseText);
  const standardText = buildTextVariant(entry.responseFamily, 'standard', baseText);
  const fullText = buildTextVariant(entry.responseFamily, 'full', baseText);

  const requestedText = requestedDetail === 'summary'
    ? summaryText
    : requestedDetail === 'standard'
      ? standardText
      : fullText;

  const size = estimateRenderedSize(requestedText);
  const limit = getFamilyLimit(entry.responseFamily, requestedDetail);
  const needsHandle = allowHandles
    && isHandleEligible(entry)
    && (requestedDetail === 'summary' || size > limit);

  if (needsHandle) {
    const stored = buildStoredResult(entry, publicTool, params, summaryText, fullText, ownerSessionKey, hint);
    return mcpResultHandle(summaryText, stored.resultId, stored.availableExpansions, {
      family: entry.responseFamily,
      action: entry.action,
      defaultDetail: entry.defaultDetail,
    });
  }

  return mcpText(requestedText, {
    family: entry.responseFamily,
    action: entry.action,
    detail: requestedDetail,
  });
}

function normalizeActionResponse(
  entry: ActionCatalogEntry,
  publicTool: RoutedPublicToolName,
  params: Record<string, unknown>,
  result: ActionHandlerResponse,
  requestedDetail: DetailLevel,
  allowHandles: boolean,
  ownerSessionKey: string,
): RouterResponse {
  const text = toPlainText(result);

  if (result.isError) {
    return mcpErrorCompact(compactErrorText(text), {
      action: entry.action,
      publicTool,
      error: true,
    });
  }

  return normalizeSuccessResponse(entry, publicTool, params, text, requestedDetail, allowHandles, ownerSessionKey, result.continuation);
}

async function executeActionViaRouter(
  publicTool: RoutedPublicToolName,
  action: ActionName,
  params: Record<string, unknown>,
  requestedDetail: DetailLevel,
  extra: unknown,
  allowHandles: boolean,
): Promise<RouterResponse> {
  const entry = getActionCatalogEntry(action);
  try {
    const { sessionKey } = getRouterContext(extra);
    const result = await callActionHandler(action, params, extra);
    return normalizeActionResponse(entry, publicTool, params, result, requestedDetail, allowHandles, sessionKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return mcpErrorCompact(message, { code: 'HANDLER_ERROR', action, publicTool });
  }
}

export async function dispatchRoutedTool(
  publicTool: RoutedPublicToolName,
  params: Record<string, unknown>,
  extra: unknown,
  surface: Surface = 'full',
): Promise<RouterResponse> {
  const action = params.action as ActionName | undefined;
  if (!action) {
    return mcpErrorCompact('Missing required "action" field.', { code: 'MISSING_ACTION' });
  }

  const entry = getActionCatalogEntry(action);
  if (!isOnSurface(entry, surface)) {
    return mcpErrorCompact(surfaceRefusal(action), { code: 'NOT_ON_SURFACE', action, surface });
  }

  const requestedDetail = pickRequestedDetail(entry, params.detail);
  const actionParams = buildActionParams(params);
  // The schema already leaves these out, but `args` is an open object.
  for (const param of getStrippedParams(entry, surface)) {
    delete actionParams[param];
  }

  const requiredFields = ACTION_REQUIRED_PARAMS[action];
  if (requiredFields) {
    const missing = requiredFields.filter((f) => actionParams[f] === undefined);
    if (missing.length > 0) {
      return mcpErrorCompact(
        `Missing required parameter${missing.length > 1 ? 's' : ''} for ${action}: ${missing.join(', ')}`,
        { code: 'MISSING_PARAMS', action, missing },
      );
    }
  }

  return executeActionViaRouter(publicTool, action, actionParams, requestedDetail, extra, true);
}

function applyContinuation(params: Record<string, unknown>, stored: StoredResult, continuation?: string): Record<string, unknown> {
  if (!continuation) {
    return params;
  }

  if (continuation !== 'next') {
    return {
      ...params,
      continuation,
    };
  }

  if (stored.payload.continuation.model === 'transactionHistory' && stored.payload.continuation.next) {
    const next = stored.payload.continuation.next;
    if (next.kind === 'signaturesQuick') {
      return {
        ...params,
        before: next.nextBefore,
      };
    }

    return {
      ...params,
      paginationToken: next.paginationToken,
    };
  }

  if (stored.payload.continuation.model === 'page' && stored.payload.continuation.nextPage !== undefined) {
    return {
      ...params,
      page: stored.payload.continuation.nextPage,
    };
  }

  return params;
}

export async function expandStoredResult(
  params: Record<string, unknown>,
  extra: unknown,
  surface: Surface = 'full',
): Promise<RouterResponse> {
  const resultId = typeof params.resultId === 'string' ? params.resultId : '';
  if (!resultId) {
    return mcpErrorCompact('Missing required "resultId".', { code: 'MISSING_RESULT_ID' });
  }

  // Only the caller that stored a handle can redeem it.
  const context = getRouterContext(extra);
  const stored = getStoredResult(resultId, context.sessionKey);
  if (!stored) {
    return mcpErrorCompact('Result handle not found or no longer available. Re-run the original action.', {
      code: 'RESULT_NOT_FOUND',
      resultId,
    });
  }

  // Stored recipes are never destructive writes, but a handle stored by a
  // fuller surface sharing this process must not run an action this one hides.
  const recipeEntry = getActionCatalogEntry(stored.payload.recipe.action);
  if (!isOnSurface(recipeEntry, surface)) {
    return mcpErrorCompact(surfaceRefusal(recipeEntry.action), {
      code: 'NOT_ON_SURFACE',
      action: recipeEntry.action,
      surface,
    });
  }

  let nextParams = {
    ...stored.payload.recipe.params,
  };
  for (const param of getStrippedParams(recipeEntry, surface)) {
    delete nextParams[param];
  }

  if (typeof params.page === 'number') {
    nextParams.page = params.page;
  }
  nextParams = applyContinuation(nextParams, stored, typeof params.continuation === 'string' ? params.continuation : undefined);

  const requestedDetail = (params.detail === 'summary' || params.detail === 'standard' || params.detail === 'full')
    ? params.detail
    : 'full';

  try {
    const rawResponse = await callActionHandler(stored.payload.recipe.action, nextParams, extra);
    const rawText = toPlainText(rawResponse);
    if (rawResponse.isError) {
      return mcpErrorCompact(compactErrorText(rawText), {
        code: 'EXPAND_FAILED',
        action: stored.payload.recipe.action,
      });
    }

    const selected = applyRangeSelection(
      applyItemSelection(
        applySectionSelection(rawText, typeof params.section === 'string' ? params.section : undefined),
        typeof params.item === 'number' ? params.item : undefined,
      ),
      typeof params.range === 'string' ? params.range : undefined,
    );

    const entry = getActionCatalogEntry(stored.payload.recipe.action);
    if (params.continuation === 'next' || typeof params.page === 'number') {
      return normalizeSuccessResponse(
        entry,
        stored.payload.recipe.publicTool,
        nextParams,
        selected,
        requestedDetail,
        true,
        context.sessionKey,
        rawResponse.continuation,
      );
    }

    const rendered = buildTextVariant(entry.responseFamily, requestedDetail, selected);
    return mcpText(rendered, {
      action: stored.payload.recipe.action,
      family: stored.kind,
      resultId,
      detail: requestedDetail,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return mcpErrorCompact(message, { code: 'EXPAND_HANDLER_ERROR', action: stored.payload.recipe.action });
  }
}
