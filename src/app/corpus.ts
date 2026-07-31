import {
  parseCorpus,
  CorpusSchemaVersionError,
  CorpusValidationError,
  SCHEMA_VERSION,
} from '../corpus/schema.js';
import type { Corpus } from '../corpus/schema.js';

/**
 * Where the last good corpus is kept between sessions. Abstracted so the load
 * path can be tested without a browser, and so the storage backend can change
 * without touching the loading rules.
 */
export interface CorpusStore {
  read(): Promise<string | null>;
  write(json: string): Promise<void>;
  clear(): Promise<void>;
}

/** No corpus could be produced from either the network or the cache. */
export class CorpusUnavailableError extends Error {
  readonly networkError: unknown;
  readonly cacheError: unknown;

  constructor(message: string, networkError: unknown, cacheError: unknown) {
    super(message);
    this.name = 'CorpusUnavailableError';
    this.networkError = networkError;
    this.cacheError = cacheError;
  }
}

export function memoryStore(initial: string | null = null): CorpusStore {
  let value = initial;
  return {
    read: async () => value,
    write: async (json: string) => {
      value = json;
    },
    clear: async () => {
      value = null;
    },
  };
}

const STORAGE_KEY = `grs:corpus:v${SCHEMA_VERSION}`;

/**
 * Browser-backed store. The schema version is part of the key, so a schema
 * change cannot collide with an older cache even before it is read.
 */
export function localStorageStore(storage: Storage = localStorage): CorpusStore {
  return {
    read: async () => {
      try {
        return storage.getItem(STORAGE_KEY);
      } catch {
        // Private mode and quota errors are not worth failing the load over.
        return null;
      }
    },
    write: async (json: string) => {
      try {
        storage.setItem(STORAGE_KEY, json);
      } catch {
        /* a corpus too large to cache still renders this session */
      }
    },
    clear: async () => {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch {
        /* nothing to do */
      }
    },
  };
}

export interface LoadCorpusOptions {
  url: string;
  store: CorpusStore;
  fetchImpl?: typeof fetch;
  /** Bounds a stalled response so the cache fallback is actually reachable. */
  timeoutMs?: number;
}

/**
 * A response that never arrives is worse than one that fails: the cache
 * fallback below only runs once the fetch settles, so without a bound a stalled
 * network leaves the app on its loading state indefinitely rather than showing
 * the last good ranking.
 */
export const CORPUS_FETCH_TIMEOUT_MS = 15_000;

export interface LoadedCorpus {
  corpus: Corpus;
  /** Whether this render is backed by a fresh fetch or the last good copy. */
  origin: 'network' | 'cache';
}

/**
 * Loads the corpus, preferring the network and falling back to the last good
 * cached copy so the app stays usable offline (R28).
 *
 * A cached corpus written by a superseded schema version is discarded rather
 * than migrated or rendered — the shape it promises no longer holds, and a
 * partial read would be worse than a refetch.
 */
export async function loadCorpus(options: LoadCorpusOptions): Promise<LoadedCorpus> {
  const { url, store, fetchImpl = fetch, timeoutMs = CORPUS_FETCH_TIMEOUT_MS } = options;

  let networkError: unknown = null;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Corpus request failed with HTTP ${response.status}`);
    }
    const body = await response.text();
    // Validate before caching, so a bad deploy cannot poison the offline copy.
    const corpus = parseCorpus(body);
    await store.write(body);
    return { corpus, origin: 'network' };
  } catch (error) {
    networkError = error;
  }

  let cacheError: unknown = null;
  const cached = await store.read();
  if (cached !== null) {
    try {
      return { corpus: parseCorpus(cached), origin: 'cache' };
    } catch (error) {
      cacheError = error;
      // Both remedies happen to be "discard", but they are different failures
      // and the taxonomy exists to tell them apart: a version mismatch is an
      // expected consequence of a deploy, corruption is worth knowing about.
      // The old condition `instanceof CorpusSchemaVersionError || instanceof
      // Error` was tautological — CorpusValidationError extends Error too — so
      // the distinction was never actually drawn.
      if (error instanceof CorpusSchemaVersionError) {
        await store.clear();
      } else if (error instanceof CorpusValidationError) {
        console.warn('Discarding a corrupt cached corpus', error.issues);
        await store.clear();
      } else {
        await store.clear();
      }
    }
  }

  throw new CorpusUnavailableError(
    'No corpus is available from the network or the cache',
    networkError,
    cacheError,
  );
}
