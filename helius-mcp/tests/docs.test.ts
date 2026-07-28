import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DOCS_INDEX,
  clearDocsCache,
  fetchDoc,
  getAvailableDocTopics,
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

  it('gives every topic an llms.txt path and a description', () => {
    for (const [key, info] of Object.entries(DOCS_INDEX)) {
      expect(info.path, key).toMatch(/^\/[\w\-/]*llms\.txt$/);
      expect(info.description.length, key).toBeGreaterThan(0);
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
