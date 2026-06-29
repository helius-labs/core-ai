import type { RoutedPublicToolName } from '../router/action-groups.js';
import type { ActionName } from '../router/actions.js';
import type { DetailLevel, ResponseFamily } from '../router/types.js';

export type TransactionHistoryContinuation =
  | { kind: 'signaturesQuick'; nextBefore?: string; lastSeenSignature?: string; until?: string }
  | { kind: 'historyApi'; paginationToken?: string }
  | { kind: 'rawApi'; paginationToken?: string };

/**
 * Structured continuation metadata emitted by an action handler on its response,
 * describing how to fetch the next page. The router reads this directly instead
 * of regex-parsing the handler's human-readable output.
 */
export type ContinuationHint =
  | { kind: 'paginationToken'; api: 'history' | 'raw'; token: string }
  | { kind: 'signaturesQuick'; lastSignature: string; until?: string };

export type ContinuationState =
  | { model: 'none' }
  | { model: 'page'; nextPage?: number }
  | { model: 'transactionHistory'; next?: TransactionHistoryContinuation };

export type ActionRecipe = {
  publicTool: RoutedPublicToolName;
  action: ActionName;
  params: Record<string, unknown>;
  responseFamily: ResponseFamily;
  defaultDetail: DetailLevel;
};

export type ResultPayload = {
  recipe: ActionRecipe;
  continuation: ContinuationState;
  sectionHints?: string[];
};

export type StoredResult = {
  resultId: string;
  kind: ResponseFamily;
  ownerSessionKey: string;
  summary: string;
  availableExpansions: string[];
  createdAt: number;
  expiresAt: number;
  payload: ResultPayload;
  payloadSize: number;
};
