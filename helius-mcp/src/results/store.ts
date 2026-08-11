import { randomUUID } from 'node:crypto';
import type { StoredResult } from './types.js';

/**
 * Cache of summary-first result handles, keyed by session and then by resultId.
 *
 * The stored payload is a *recipe* (public tool, action, params, continuation),
 * not the response data — `expandStoredResult` re-runs the action. That has two
 * consequences worth knowing before changing anything here:
 *
 * 1. Entries are small (hundreds of bytes), so the practical memory bound is
 *    MAX_SESSIONS * MAX_RESULTS_PER_SESSION, not the byte caps.
 * 2. A miss is recoverable — the caller is told to re-run the original action —
 *    so evicting aggressively is safe, but evicting *another session's* entries
 *    is not: it makes `expandResult` fail for a caller who did nothing wrong.
 *
 * Point 2 is why the caps below are per session. A single flat Map with a global
 * cap of 10 works for one stdio user and breaks under concurrency, where callers
 * silently evict each other. Buckets also make ownership structural instead of a
 * post-hoc comparison: a session cannot name another session's entries at all.
 */

const MAX_RESULTS_PER_SESSION = 10;
const MAX_PAYLOAD_BYTES_PER_SESSION = 250 * 1024;
/** Bounds total memory by capping distinct sessions, LRU-evicting whole buckets. */
const MAX_SESSIONS = 256;
const RESULT_TTL_MS = 5 * 60 * 1000;

type SessionBucket = Map<string, StoredResult>;

/** Insertion order doubles as LRU order, for both sessions and entries. */
const sessions = new Map<string, SessionBucket>();

function estimateBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function bucketBytes(bucket: SessionBucket): number {
  let total = 0;
  for (const result of bucket.values()) {
    total += result.payloadSize;
  }
  return total;
}

function sweepExpired(now = Date.now()): void {
  for (const [sessionKey, bucket] of sessions) {
    for (const [resultId, result] of bucket) {
      if (result.expiresAt <= now) {
        bucket.delete(resultId);
      }
    }
    if (bucket.size === 0) {
      sessions.delete(sessionKey);
    }
  }
}

/** Move to the end of the Map so the least recently used stays at the front. */
function touch<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key);
  map.set(key, value);
}

function evictBucketToFit(bucket: SessionBucket): void {
  while (bucket.size > MAX_RESULTS_PER_SESSION || bucketBytes(bucket) > MAX_PAYLOAD_BYTES_PER_SESSION) {
    // Stop before emptying the bucket. The entry that triggered eviction is the
    // newest, so the only way to reach size 1 is that entry alone exceeding the
    // byte cap — and evicting it would hand the caller a resultId that resolves
    // to nothing. Keeping one oversized entry is the better failure: the handle
    // works, and the TTL reclaims it.
    if (bucket.size <= 1) {
      break;
    }
    const oldest = bucket.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    bucket.delete(oldest);
  }
}

function evictSessionsToFit(): void {
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    sessions.delete(oldest);
  }
}

export function putStoredResult(
  input: Omit<StoredResult, 'resultId' | 'createdAt' | 'expiresAt' | 'payloadSize'>,
): StoredResult {
  sweepExpired();

  const createdAt = Date.now();
  const payloadSize = estimateBytes(input.payload);
  const stored: StoredResult = {
    ...input,
    resultId: randomUUID(),
    createdAt,
    expiresAt: createdAt + RESULT_TTL_MS,
    payloadSize,
  };

  let bucket = sessions.get(stored.ownerSessionKey);
  if (!bucket) {
    bucket = new Map();
  }
  bucket.set(stored.resultId, stored);
  evictBucketToFit(bucket);

  touch(sessions, stored.ownerSessionKey, bucket);
  evictSessionsToFit();

  return stored;
}

export function getStoredResult(resultId: string, ownerSessionKey: string): StoredResult | null {
  sweepExpired();

  const bucket = sessions.get(ownerSessionKey);
  if (!bucket) {
    return null;
  }

  const result = bucket.get(resultId);
  if (!result) {
    return null;
  }

  touch(bucket, resultId, result);
  touch(sessions, ownerSessionKey, bucket);
  return result;
}

export function clearStoredResults(): void {
  sessions.clear();
}

/**
 * Counts across every session, or within one when `ownerSessionKey` is given.
 */
export function getStoredResultStats(ownerSessionKey?: string): {
  count: number;
  totalPayloadBytes: number;
  sessions: number;
} {
  sweepExpired();

  if (ownerSessionKey !== undefined) {
    const bucket = sessions.get(ownerSessionKey);
    return {
      count: bucket?.size ?? 0,
      totalPayloadBytes: bucket ? bucketBytes(bucket) : 0,
      sessions: bucket ? 1 : 0,
    };
  }

  let count = 0;
  let totalPayloadBytes = 0;
  for (const bucket of sessions.values()) {
    count += bucket.size;
    totalPayloadBytes += bucketBytes(bucket);
  }

  return { count, totalPayloadBytes, sessions: sessions.size };
}
