import { getStoredResult, putStoredResult } from '../results/store.js';
import type { ContinuationState, StoredResult, TransactionHistoryContinuation } from '../results/types.js';
import { callLegacyAction, type LegacyToolResponse } from './legacy-executors.js';
import { getActionCatalogEntry } from './catalog.js';
import { getRouterContext } from './context.js';
import type { RoutedPublicToolName } from './action-groups.js';
import type { LegacyActionName } from './legacy-actions.js';
import type { ActionCatalogEntry, CapabilityVariant, DetailLevel, GatePredicate, ResponseFamily } from './types.js';
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

const PLAN_ORDER: Record<CapabilityVariant['minimumPlan'], number> = {
  free: 0,
  developer: 1,
  business: 2,
  professional: 3,
};

function matchesPredicate(
  predicate: GatePredicate,
  params: Record<string, unknown>,
  network: 'devnet' | 'mainnet-beta',
): boolean {
  switch (predicate.kind) {
    case 'always':
      return true;
    case 'network':
      return predicate.oneOf.includes(network);
    case 'paramPresent':
      return params[predicate.field] !== undefined;
    case 'paramEquals':
      return params[predicate.field] === predicate.value;
    case 'and':
      return predicate.all.every((part) => matchesPredicate(part, params, network));
    default:
      return false;
  }
}

function getCapabilityVariant(entry: ActionCatalogEntry, params: Record<string, unknown>): CapabilityVariant | null {
  const { network } = getRouterContext();
  const matches = [entry.capabilityGate.baseline, ...(entry.capabilityGate.variants ?? [])]
    .filter((variant) => matchesPredicate(variant.predicate, params, network))
    .sort((left, right) => PLAN_ORDER[right.minimumPlan] - PLAN_ORDER[left.minimumPlan]);

  return matches[0] ?? null;
}

function capabilityPrefix(entry: ActionCatalogEntry, params: Record<string, unknown>): string {
  const matched = getCapabilityVariant(entry, params);
  if (!matched || matched.minimumPlan === 'free') {
    return '';
  }

  return `Requirement: ${matched.label}\n\n`;
}

function isHandleEligible(entry: ActionCatalogEntry): boolean {
  return entry.handleEligibility;
}

function pickRequestedDetail(entry: ActionCatalogEntry, detail?: unknown): DetailLevel {
  if (detail === 'summary' || detail === 'standard' || detail === 'full') {
    return detail;
  }
  return entry.defaultDetail;
}

function buildLegacyParams(input: Record<string, unknown>): Record<string, unknown> {
  const { action: _action, detail: _detail, args, ...topLevel } = input;
  const merged: Record<string, unknown> = {
    ...(args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}),
  };

  for (const [key, value] of Object.entries(topLevel)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  return merged;
}

function detectContinuation(action: LegacyActionName, params: Record<string, unknown>, text: string): ContinuationState {
  if (action === 'getTransactionHistory') {
    const tokenMatch = text.match(/\*\*Next Page Token:\*\*\s+`([^`]+)`/);
    if (tokenMatch) {
      const mode = typeof params.mode === 'string' ? params.mode : 'parsed';
      const next: TransactionHistoryContinuation = mode === 'raw'
        ? { kind: 'rawApi', paginationToken: tokenMatch[1] }
        : { kind: 'historyApi', paginationToken: tokenMatch[1] };
      return { model: 'transactionHistory', next };
    }

    const hasFilters = [
      'paginationToken',
      'status',
      'tokenAccounts',
      'blockTimeGte',
      'blockTimeLte',
      'slotGte',
      'slotLte',
    ].some((key) => params[key] !== undefined);
    const mode = typeof params.mode === 'string' ? params.mode : 'parsed';
    const sortOrder = typeof params.sortOrder === 'string' ? params.sortOrder : 'desc';
    if (mode === 'signatures' && sortOrder === 'desc' && !hasFilters) {
      const signatures = Array.from(
        text.matchAll(/^[^\S\r\n]*[✅❌]\s+([1-9A-HJ-NP-Za-km-z]{86,88})$/gm),
      ).map((match) => match[1]);
      const lastSignature = signatures.at(-1);
      if (lastSignature) {
        return {
          model: 'transactionHistory',
          next: {
            kind: 'signaturesQuick',
            nextBefore: lastSignature,
            lastSeenSignature: lastSignature,
            until: typeof params.until === 'string' ? params.until : undefined,
          },
        };
      }
    }
  }

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
): StoredResult {
  const context = getRouterContext();
  const continuation = detectContinuation(entry.action, params, text);
  const sectionHints = collectSectionHints(text);
  const stored = putStoredResult({
    kind: entry.responseFamily,
    ownerSessionKey: context.sessionKey,
    summary,
    availableExpansions: buildAvailableExpansions(entry.responseFamily, continuation, sectionHints),
    payload: {
      recipe: {
        publicTool,
        action: entry.action,
        params,
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
): RouterResponse {
  const prefix = capabilityPrefix(entry, params);
  const baseText = `${prefix}${text}`.trim();
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
    const stored = buildStoredResult(entry, publicTool, params, summaryText, fullText);
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

function normalizeLegacyResponse(
  entry: ActionCatalogEntry,
  publicTool: RoutedPublicToolName,
  params: Record<string, unknown>,
  result: LegacyToolResponse,
  requestedDetail: DetailLevel,
  allowHandles: boolean,
): RouterResponse {
  const text = toPlainText(result);

  if (result.isError) {
    return mcpErrorCompact(compactErrorText(text), {
      action: entry.action,
      publicTool,
      error: true,
    });
  }

  return normalizeSuccessResponse(entry, publicTool, params, text, requestedDetail, allowHandles);
}

async function executeLegacyViaRouter(
  publicTool: RoutedPublicToolName,
  action: LegacyActionName,
  params: Record<string, unknown>,
  requestedDetail: DetailLevel,
  extra: unknown,
  allowHandles: boolean,
): Promise<RouterResponse> {
  const entry = getActionCatalogEntry(action);
  const result = await callLegacyAction(action, params, extra);
  return normalizeLegacyResponse(entry, publicTool, params, result, requestedDetail, allowHandles);
}

export async function dispatchRoutedTool(
  publicTool: RoutedPublicToolName,
  params: Record<string, unknown>,
  extra: unknown,
): Promise<RouterResponse> {
  const action = params.action as LegacyActionName | undefined;
  if (!action) {
    return mcpErrorCompact('Missing required "action" field.', { code: 'MISSING_ACTION' });
  }

  const requestedDetail = pickRequestedDetail(getActionCatalogEntry(action), params.detail);
  const legacyParams = buildLegacyParams(params);
  return executeLegacyViaRouter(publicTool, action, legacyParams, requestedDetail, extra, true);
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
): Promise<RouterResponse> {
  const resultId = typeof params.resultId === 'string' ? params.resultId : '';
  if (!resultId) {
    return mcpErrorCompact('Missing required "resultId".', { code: 'MISSING_RESULT_ID' });
  }

  const context = getRouterContext();
  const stored = getStoredResult(resultId, context.sessionKey);
  if (!stored) {
    return mcpErrorCompact('Result handle not found or no longer available. Re-run the original action.', {
      code: 'RESULT_NOT_FOUND',
      resultId,
    });
  }

  let nextParams = {
    ...stored.payload.recipe.params,
  };

  if (typeof params.page === 'number') {
    nextParams.page = params.page;
  }
  nextParams = applyContinuation(nextParams, stored, typeof params.continuation === 'string' ? params.continuation : undefined);

  const requestedDetail = (params.detail === 'summary' || params.detail === 'standard' || params.detail === 'full')
    ? params.detail
    : 'full';

  const rawResponse = await callLegacyAction(stored.payload.recipe.action, nextParams, extra);
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
    );
  }

  const rendered = buildTextVariant(entry.responseFamily, requestedDetail, selected);
  return mcpText(rendered, {
    action: stored.payload.recipe.action,
    family: stored.kind,
    resultId,
    detail: requestedDetail,
  });
}
