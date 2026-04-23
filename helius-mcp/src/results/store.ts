import { randomUUID } from 'node:crypto';
import type { StoredResult } from './types.js';

const MAX_RESULTS = 10;
const MAX_TOTAL_PAYLOAD_BYTES = 250 * 1024;
const RESULT_TTL_MS = 5 * 60 * 1000;

const results = new Map<string, StoredResult>();

function estimateBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function sweepExpired(now = Date.now()): void {
  for (const [resultId, result] of results) {
    if (result.expiresAt <= now) {
      results.delete(resultId);
    }
  }
}

function currentTotalBytes(): number {
  let total = 0;
  for (const result of results.values()) {
    total += result.payloadSize;
  }
  return total;
}

function touch(resultId: string, result: StoredResult): void {
  results.delete(resultId);
  results.set(resultId, result);
}

function evictToFit(): void {
  sweepExpired();

  while (results.size > MAX_RESULTS || currentTotalBytes() > MAX_TOTAL_PAYLOAD_BYTES) {
    const oldest = results.keys().next().value;
    if (!oldest) {
      break;
    }
    results.delete(oldest);
  }
}

export function putStoredResult(
  input: Omit<StoredResult, 'resultId' | 'createdAt' | 'expiresAt' | 'payloadSize'>,
): StoredResult {
  const createdAt = Date.now();
  const payloadSize = estimateBytes(input.payload);
  const stored: StoredResult = {
    ...input,
    resultId: randomUUID(),
    createdAt,
    expiresAt: createdAt + RESULT_TTL_MS,
    payloadSize,
  };

  results.set(stored.resultId, stored);
  evictToFit();
  return stored;
}

export function getStoredResult(resultId: string, ownerSessionKey: string): StoredResult | null {
  sweepExpired();

  const result = results.get(resultId);
  if (!result) {
    return null;
  }

  if (result.ownerSessionKey !== ownerSessionKey) {
    return null;
  }

  touch(resultId, result);
  return result;
}

export function clearStoredResults(): void {
  results.clear();
}

export function getStoredResultStats(): { count: number; totalPayloadBytes: number } {
  sweepExpired();
  return {
    count: results.size,
    totalPayloadBytes: currentTotalBytes(),
  };
}
