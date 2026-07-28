import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Metadata cache. Tag data costs one request per game (KTD9), so a game seen in
 * a previous run must not be refetched — the catalogue changes far more slowly
 * than discussion does.
 */
export interface MetadataCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
}

export function memoryCache(initial: Record<string, unknown> = {}): MetadataCache {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    async get<T>(key: string) {
      return (store.get(key) as T | undefined) ?? null;
    },
    async set<T>(key: string, value: T) {
      store.set(key, value);
    },
  };
}

interface CacheEnvelope<T> {
  storedAt: number;
  value: T;
}

/**
 * File-backed cache for the ingest job. Written as one JSON document rather
 * than a file per game: the whole thing is read once per run, and a single file
 * is far cheaper to restore from a workflow cache than thousands of small ones.
 */
export function fileCache(
  path: string,
  options: { ttlMs?: number; now?: () => number } = {},
): MetadataCache {
  const { ttlMs = 30 * 24 * 60 * 60 * 1000, now = () => Date.now() } = options;
  const absolute = resolve(path);

  let store: Record<string, CacheEnvelope<unknown>> = {};
  if (existsSync(absolute)) {
    try {
      store = JSON.parse(readFileSync(absolute, 'utf8')) as Record<string, CacheEnvelope<unknown>>;
    } catch {
      // A corrupt cache is a performance problem, not a correctness one.
      store = {};
    }
  }

  let dirty = false;

  const flush = () => {
    if (!dirty) return;
    mkdirSync(resolve(absolute, '..'), { recursive: true });
    writeFileSync(absolute, JSON.stringify(store));
    dirty = false;
  };

  // Flushing on exit keeps the hot path free of disk writes.
  process.once('beforeExit', flush);

  return {
    async get<T>(key: string) {
      const entry = store[key];
      if (!entry) return null;
      if (now() - entry.storedAt > ttlMs) return null;
      return entry.value as T;
    },
    async set<T>(key: string, value: T) {
      store[key] = { storedAt: now(), value };
      dirty = true;
    },
  };
}
