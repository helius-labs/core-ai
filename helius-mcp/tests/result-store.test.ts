import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  putStoredResult,
  getStoredResult,
  clearStoredResults,
  getStoredResultStats,
} from '../src/results/store.js';

const MAX_RESULTS_PER_SESSION = 10;
const MAX_SESSIONS = 256;
const RESULT_TTL_MS = 5 * 60 * 1000;

function put(ownerSessionKey: string, topic = 'billing') {
  return putStoredResult({
    kind: 'document',
    ownerSessionKey,
    summary: `summary for ${topic}`,
    availableExpansions: ['full'],
    payload: {
      recipe: {
        publicTool: 'heliusKnowledge',
        action: 'lookupHeliusDocs',
        params: { topic },
        responseFamily: 'document',
        defaultDetail: 'summary',
      },
      continuation: { model: 'none' },
    },
  });
}

beforeEach(() => {
  clearStoredResults();
});

afterEach(() => {
  vi.useRealTimers();
  clearStoredResults();
});

// ─── Session Isolation ────────────────────────────────────────────────────────

describe('session isolation', () => {
  it('returns an entry to its own session', () => {
    const stored = put('session-a');
    expect(getStoredResult(stored.resultId, 'session-a')?.resultId).toBe(stored.resultId);
  });

  it('hides an entry from a different session', () => {
    const stored = put('session-a');
    expect(getStoredResult(stored.resultId, 'session-b')).toBeNull();
  });

  it('returns null for an unknown session', () => {
    const stored = put('session-a');
    expect(getStoredResult(stored.resultId, 'never-seen')).toBeNull();
  });

  it('returns null for an unknown resultId within a known session', () => {
    put('session-a');
    expect(getStoredResult('no-such-id', 'session-a')).toBeNull();
  });

  it('keeps entries with the same recipe in separate sessions distinct', () => {
    const a = put('session-a', 'credits');
    const b = put('session-b', 'credits');
    expect(a.resultId).not.toBe(b.resultId);
    expect(getStoredResult(a.resultId, 'session-b')).toBeNull();
    expect(getStoredResult(b.resultId, 'session-a')).toBeNull();
  });
});

// ─── Cross-Session Eviction (the concurrency bug) ─────────────────────────────

describe('cross-session eviction', () => {
  it('does not evict another session when one session fills its bucket', () => {
    const victim = put('session-a');

    for (let i = 0; i < MAX_RESULTS_PER_SESSION * 3; i += 1) {
      put('session-b', `topic-${i}`);
    }

    expect(getStoredResult(victim.resultId, 'session-a')).not.toBeNull();
  });

  it('holds the per-session cap for every session independently', () => {
    for (let i = 0; i < MAX_RESULTS_PER_SESSION + 5; i += 1) {
      put('session-a', `a-${i}`);
      put('session-b', `b-${i}`);
    }

    expect(getStoredResultStats('session-a').count).toBe(MAX_RESULTS_PER_SESSION);
    expect(getStoredResultStats('session-b').count).toBe(MAX_RESULTS_PER_SESSION);
    // The assertion that distinguishes per-session caps from a shared one: under
    // a single global cap of 10 the total here would be 10, not 20.
    expect(getStoredResultStats().count).toBe(MAX_RESULTS_PER_SESSION * 2);
  });

  it('evicts the oldest entry within the overflowing session only', () => {
    const bystander = put('session-b', 'bystander');
    const first = put('session-a', 'first');
    for (let i = 0; i < MAX_RESULTS_PER_SESSION; i += 1) {
      put('session-a', `filler-${i}`);
    }

    expect(getStoredResult(first.resultId, 'session-a')).toBeNull();
    expect(getStoredResultStats('session-a').count).toBe(MAX_RESULTS_PER_SESSION);
    expect(getStoredResult(bystander.resultId, 'session-b')).not.toBeNull();
  });

  it('keeps the entry it just stored even when that entry alone exceeds the byte cap', () => {
    const oversized = putStoredResult({
      kind: 'document',
      ownerSessionKey: 'session-a',
      summary: 'oversized',
      availableExpansions: ['full'],
      payload: {
        recipe: {
          publicTool: 'heliusKnowledge',
          action: 'lookupHeliusDocs',
          // Deliberately past MAX_PAYLOAD_BYTES_PER_SESSION on its own.
          params: { topic: 'x'.repeat(300 * 1024) },
          responseFamily: 'document',
          defaultDetail: 'summary',
        },
        continuation: { model: 'none' },
      },
    });

    expect(getStoredResult(oversized.resultId, 'session-a')).not.toBeNull();
    expect(getStoredResultStats('session-a').count).toBe(1);
  });

  it('spares a recently read entry when the bucket overflows', () => {
    const early = put('session-a', 'early');
    for (let i = 0; i < MAX_RESULTS_PER_SESSION - 1; i += 1) {
      put('session-a', `filler-${i}`);
    }

    // Reading promotes it, so the next insert should evict something else.
    expect(getStoredResult(early.resultId, 'session-a')).not.toBeNull();
    put('session-a', 'overflow');

    expect(getStoredResult(early.resultId, 'session-a')).not.toBeNull();
  });
});

// ─── Global Session Cap ───────────────────────────────────────────────────────

describe('global session cap', () => {
  it('bounds the number of tracked sessions', () => {
    for (let i = 0; i < MAX_SESSIONS + 20; i += 1) {
      put(`session-${i}`);
    }

    expect(getStoredResultStats().sessions).toBeLessThanOrEqual(MAX_SESSIONS);
  });

  it('evicts the least recently used session first', () => {
    const oldest = put('session-oldest');
    for (let i = 0; i < MAX_SESSIONS; i += 1) {
      put(`session-${i}`);
    }

    expect(getStoredResult(oldest.resultId, 'session-oldest')).toBeNull();
  });
});

// ─── Expiry ───────────────────────────────────────────────────────────────────

describe('expiry', () => {
  it('drops an entry once its TTL has passed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T00:00:00Z'));

    const stored = put('session-a');
    expect(getStoredResult(stored.resultId, 'session-a')).not.toBeNull();

    vi.setSystemTime(new Date(Date.now() + RESULT_TTL_MS + 1));
    expect(getStoredResult(stored.resultId, 'session-a')).toBeNull();
  });

  it('forgets a session whose entries have all expired', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T00:00:00Z'));

    put('session-a');
    vi.setSystemTime(new Date(Date.now() + RESULT_TTL_MS + 1));

    expect(getStoredResultStats().sessions).toBe(0);
  });
});

// ─── Stats ────────────────────────────────────────────────────────────────────

describe('stats', () => {
  it('reports zero on an empty store', () => {
    expect(getStoredResultStats()).toEqual({ count: 0, totalPayloadBytes: 0, sessions: 0 });
  });

  it('aggregates across sessions when no session is given', () => {
    put('session-a');
    put('session-b');

    const stats = getStoredResultStats();
    expect(stats.count).toBe(2);
    expect(stats.sessions).toBe(2);
    expect(stats.totalPayloadBytes).toBeGreaterThan(0);
  });

  it('scopes to one session when given', () => {
    put('session-a');
    put('session-b');
    put('session-b');

    expect(getStoredResultStats('session-a').count).toBe(1);
    expect(getStoredResultStats('session-b').count).toBe(2);
  });

  it('reports zero for a session it has never seen', () => {
    put('session-a');
    expect(getStoredResultStats('nope')).toEqual({ count: 0, totalPayloadBytes: 0, sessions: 0 });
  });
});
