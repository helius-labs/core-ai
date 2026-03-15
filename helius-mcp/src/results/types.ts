import type { RoutedPublicToolName } from '../router/action-groups.js';
import type { LegacyActionName } from '../router/legacy-actions.js';
import type { DetailLevel, ResponseFamily } from '../router/types.js';

export type TransactionHistoryContinuation =
  | { kind: 'signaturesQuick'; nextBefore?: string; lastSeenSignature?: string; until?: string }
  | { kind: 'historyApi'; paginationToken?: string }
  | { kind: 'rawApi'; paginationToken?: string };

export type ContinuationState =
  | { model: 'none' }
  | { model: 'page'; nextPage?: number }
  | { model: 'transactionHistory'; next?: TransactionHistoryContinuation };

export type ActionRecipe = {
  publicTool: RoutedPublicToolName;
  action: LegacyActionName;
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
