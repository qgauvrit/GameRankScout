import { describe, it, expect } from 'vitest';
import { loadCorpus, memoryStore, CorpusUnavailableError } from './corpus.js';
import { SCHEMA_VERSION, serializeCorpus } from '../corpus/schema.js';
import type { Corpus } from '../corpus/schema.js';

function corpus(overrides: Partial<Corpus> = {}): Corpus {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: '2026-07-28T00:00:00.000Z',
    games: [],
    sources: [],
    ...overrides,
  };
}

const URL = 'https://example.test/corpus.json';

function okFetch(body: string): typeof fetch {
  return (async () => new Response(body, { status: 200 })) as typeof fetch;
}

const failingFetch: typeof fetch = async () => {
  throw new TypeError('network down');
};

describe('corpus loading', () => {
  it('fetches and renders on a cold load with no cached corpus', async () => {
    const store = memoryStore();

    const result = await loadCorpus({
      url: URL,
      fetchImpl: okFetch(serializeCorpus(corpus())),
      store,
    });

    expect(result.origin).toBe('network');
    expect(result.corpus.schemaVersion).toBe(SCHEMA_VERSION);
    // The fetched corpus is cached so the next load survives being offline.
    expect(await store.read()).not.toBeNull();
  });

  it('renders from the cached corpus when there is no network', async () => {
    const store = memoryStore();
    await store.write(serializeCorpus(corpus({ generatedAt: '2026-07-01T00:00:00.000Z' })));

    const result = await loadCorpus({ url: URL, fetchImpl: failingFetch, store });

    expect(result.origin).toBe('cache');
    expect(result.corpus.generatedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('discards a cached corpus written by a superseded schema version', async () => {
    const store = memoryStore();
    await store.write(JSON.stringify({ ...corpus(), schemaVersion: SCHEMA_VERSION - 1 }));

    await expect(loadCorpus({ url: URL, fetchImpl: failingFetch, store })).rejects.toBeInstanceOf(
      CorpusUnavailableError,
    );
    // Discarded, not left to be retried forever.
    expect(await store.read()).toBeNull();
  });

  it('replaces a superseded cache when the network is reachable', async () => {
    const store = memoryStore();
    await store.write(JSON.stringify({ ...corpus(), schemaVersion: SCHEMA_VERSION - 1 }));

    const result = await loadCorpus({
      url: URL,
      fetchImpl: okFetch(serializeCorpus(corpus())),
      store,
    });

    expect(result.origin).toBe('network');
    expect(await store.read()).toContain(`"schemaVersion":${SCHEMA_VERSION}`);
  });

  it('falls back to a good cache when the network returns something unusable', async () => {
    const store = memoryStore();
    await store.write(serializeCorpus(corpus({ generatedAt: '2026-07-01T00:00:00.000Z' })));

    const result = await loadCorpus({
      url: URL,
      fetchImpl: okFetch('{ truncated'),
      store,
    });

    expect(result.origin).toBe('cache');
    expect(result.corpus.generatedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('does not cache a corpus the network served but that failed validation', async () => {
    const store = memoryStore();

    await expect(
      loadCorpus({ url: URL, fetchImpl: okFetch('{ truncated'), store }),
    ).rejects.toBeInstanceOf(CorpusUnavailableError);
    expect(await store.read()).toBeNull();
  });

  it('reports that nothing is available when there is no network and no cache', async () => {
    await expect(
      loadCorpus({ url: URL, fetchImpl: failingFetch, store: memoryStore() }),
    ).rejects.toBeInstanceOf(CorpusUnavailableError);
  });

  it('treats a non-200 response as unreachable rather than as a corpus', async () => {
    const store = memoryStore();
    await store.write(serializeCorpus(corpus()));

    const result = await loadCorpus({
      url: URL,
      fetchImpl: (async () => new Response('Not found', { status: 404 })) as typeof fetch,
      store,
    });

    expect(result.origin).toBe('cache');
  });
});
