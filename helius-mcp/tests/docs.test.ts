import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DOCS_INDEX,
  clearDocsCache,
  fetchDoc,
  getAvailableDocTopics,
  inferDocTopic,
} from '../src/utils/docs.js';

// The docs live on the published Helius docs site. Every DOCS_INDEX path is
// resolved against this origin, so a wrong origin silently breaks every
// doc-backed tool at once rather than failing loudly at build time.
const DOCS_ORIGIN = 'https://www.helius.dev/docs';

/** Records the URLs fetchDoc requests, without touching the network. */
function stubFetch(): string[] {
  const requested: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      requested.push(String(url));
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '# doc',
      } as unknown as Response;
    })
  );
  return requested;
}

describe('DOCS_INDEX', () => {
  beforeEach(() => {
    clearDocsCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gives every topic an llms.txt or markdown page path and a description', () => {
    for (const [key, info] of Object.entries(DOCS_INDEX)) {
      expect(info.path, key).toMatch(/^\/[\w\-/]*(llms\.txt|\.md)$/);
      expect(info.description.length, key).toBeGreaterThan(0);
    }
  });

  it('indexes the products launched since the Enhanced APIs', () => {
    for (const key of [
      'parsed-events', 'parsed-streams', 'pre-confirmations', 'preprocessed-transactions',
      'mev-protect', 'backrun-rebates', 'gatekeeper', 'admin-api', 'waas', 'privacy',
    ]) {
      expect(DOCS_INDEX[key], key).toBeDefined();
    }
  });

  it('resolves every topic against the published docs site and nowhere else', async () => {
    const requested = stubFetch();

    for (const key of getAvailableDocTopics()) {
      await fetchDoc(key);
    }

    const expected = Object.values(DOCS_INDEX).map((info) => `${DOCS_ORIGIN}${info.path}`);
    expect(requested).toHaveLength(Object.keys(DOCS_INDEX).length);
    expect(new Set(requested)).toEqual(new Set(expected));
  });
});

describe('inferDocTopic', () => {
  it('routes new products ahead of the legacy keywords that would otherwise capture them', () => {
    expect(inferDocTopic('how do I parse a transaction')).toBe('parsed-events');
    expect(inferDocTopic('parsed transaction history for an address')).toBe('parsed-events');
    expect(inferDocTopic('stream parsed transactions for a program')).toBe('parsed-events');
    expect(inferDocTopic('parsed streams websocket filters')).toBe('parsed-streams');
    expect(inferDocTopic('preconfirmation latency')).toBe('pre-confirmations');
    expect(inferDocTopic('preprocessed transaction stream')).toBe('preprocessed-transactions');
    expect(inferDocTopic('protect my swap from MEV sandwiches')).toBe('mev-protect');
    expect(inferDocTopic('earn rebates on sends')).toBe('backrun-rebates');
    expect(inferDocTopic('embedded wallet for my app')).toBe('waas');
    expect(inferDocTopic('check my project credit usage')).toBe('admin-api');
  });

  it('prefers an exact topic name, longest first', () => {
    expect(inferDocTopic('enhanced-websockets filters')).toBe('enhanced-websockets');
    expect(inferDocTopic('enhanced-transactions migration')).toBe('enhanced-transactions');
  });

  it('matches "ws" only as a whole word', () => {
    expect(inferDocTopic('ws reconnect strategy')).toBe('enhanced-websockets');
    expect(inferDocTopic('show me the news')).toBeUndefined();
  });

  it('keeps the existing routes for established products', () => {
    expect(inferDocTopic('nft collection listing')).toBe('das');
    expect(inferDocTopic('grpc subscription')).toBe('laserstream');
    expect(inferDocTopic('raw shreds over udp')).toBe('shred-delivery');
    expect(inferDocTopic('submit a bundle')).toBe('sender');
  });
});
