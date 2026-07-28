import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  parseAppDetails,
  parseSteamSpy,
  parseDeckReport,
  parseProtonSummary,
  parseStoreSearch,
  parseOwners,
  createHttpEnrichers,
} from './metadata.js';
import { memoryCache } from './cache.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(resolve(here, '../../test/fixtures/steam', name), 'utf8')) as unknown;

describe('steam appdetails', () => {
  it('reads name, type, genres and desktop platforms from a recorded payload', () => {
    const details = parseAppDetails(fixture('appdetails.json'), 553420);

    expect(details).not.toBeNull();
    expect(details?.name).toBe('TUNIC');
    expect(details?.type).toBe('game');
    expect(details?.genres).toEqual(expect.arrayContaining(['Action', 'Adventure']));
    expect(details?.platforms.windows).toBe(true);
    expect(details?.platforms.linux).toBe(false);
  });

  it('returns null for an unsuccessful lookup rather than a hollow record', () => {
    expect(parseAppDetails(fixture('appdetails-failure.json'), 999999)).toBeNull();
  });

  it('returns null when the payload has no entry for the requested app', () => {
    expect(parseAppDetails(fixture('appdetails.json'), 111111)).toBeNull();
  });
});

describe('steamspy appdetails', () => {
  it('reads community tags, owner band and review count', () => {
    const spy = parseSteamSpy(fixture('steamspy-appdetails.json'));

    expect(spy?.tags.length).toBeGreaterThan(0);
    expect(spy?.tags).toContain('Metroidvania');
    expect(spy?.ownerBand.min).toBeGreaterThan(0);
    expect(spy?.ownerBand.max).toBeGreaterThan(spy!.ownerBand.min);
    expect(spy?.reviews).toBeGreaterThan(0);
  });

  it('parses owner bands written as a range of formatted numbers', () => {
    expect(parseOwners('1,000,000 .. 2,000,000')).toEqual({ min: 1_000_000, max: 2_000_000 });
    expect(parseOwners('0 .. 20,000')).toEqual({ min: 0, max: 20_000 });
    expect(parseOwners(undefined)).toBeNull();
    expect(parseOwners('unknown')).toBeNull();
  });

  it('tolerates a payload with no tags', () => {
    expect(parseSteamSpy({ appid: 1, positive: 10, negative: 1, owners: '0 .. 20,000' })?.tags).toEqual(
      [],
    );
  });
});

describe('handheld compatibility', () => {
  it('resolves the Deck verdict from a recorded report', () => {
    expect(parseDeckReport(fixture('deck-report.json'))).toBe('verified');
  });

  it('maps every documented category code', () => {
    expect(parseDeckReport({ success: 1, results: { resolved_category: 0 } })).toBe('unknown');
    expect(parseDeckReport({ success: 1, results: { resolved_category: 1 } })).toBe('unsupported');
    expect(parseDeckReport({ success: 1, results: { resolved_category: 2 } })).toBe('playable');
  });

  it('returns null for an unsuccessful report so the community source can answer', () => {
    expect(parseDeckReport({ success: 0 })).toBeNull();
    expect(parseDeckReport(null)).toBeNull();
  });

  it('reads the community tier as the fallback source', () => {
    expect(parseProtonSummary(fixture('protondb-summary.json'))).toBe('platinum');
    expect(parseProtonSummary({ tier: 'not-a-tier' })).toBeNull();
    expect(parseProtonSummary({})).toBeNull();
  });
});

describe('store search', () => {
  it('resolves a name to an app id from a recorded payload', () => {
    expect(parseStoreSearch(fixture('storesearch.json'), 'Outer Wilds')).toEqual({
      id: 753640,
      name: 'Outer Wilds',
    });
  });

  it('prefers an exact title match over the first fuzzy result', () => {
    const payload = {
      items: [
        { id: 1, name: 'Tunic Soundtrack', type: 'music' },
        { id: 553420, name: 'TUNIC', type: 'app' },
      ],
    };

    expect(parseStoreSearch(payload, 'tunic')).toEqual({ id: 553420, name: 'TUNIC' });
  });

  it('returns null when nothing matched', () => {
    expect(parseStoreSearch({ total: 0, items: [] }, 'nothing')).toBeNull();
    expect(parseStoreSearch(null, 'nothing')).toBeNull();
  });
});

describe('http enrichers', () => {
  it('returns null instead of throwing when a lookup fails', async () => {
    const deps = createHttpEnrichers(memoryCache(), {
      fetchImpl: (async () => {
        throw new TypeError('network down');
      }) as typeof fetch,
      minIntervalMs: 0,
    });

    await expect(deps.fetchAppDetails(1)).resolves.toBeNull();
    await expect(deps.fetchSteamSpy(1)).resolves.toBeNull();
    await expect(deps.fetchDeckReport(1)).resolves.toBeNull();
    await expect(deps.fetchProtonTier(1)).resolves.toBeNull();
    await expect(deps.searchStore('x')).resolves.toBeNull();
  });

  it('treats a non-200 response as an absent lookup', async () => {
    const deps = createHttpEnrichers(memoryCache(), {
      fetchImpl: (async () => new Response('nope', { status: 503 })) as typeof fetch,
      minIntervalMs: 0,
    });

    await expect(deps.fetchAppDetails(1)).resolves.toBeNull();
  });

  it('paces consecutive requests', async () => {
    let now = 0;
    const deps = createHttpEnrichers(memoryCache(), {
      fetchImpl: (async () => new Response('{}', { status: 200 })) as typeof fetch,
      minIntervalMs: 1_500,
      sleepImpl: async (ms) => {
        now += ms;
      },
      nowImpl: () => now,
    });

    await deps.fetchAppDetails(1);
    const before = now;
    await deps.fetchAppDetails(2);

    expect(now - before).toBeGreaterThanOrEqual(1_500);
  });

  it('omits the console lookup entirely when no credentials were supplied', () => {
    const deps = createHttpEnrichers(memoryCache());

    expect(deps.fetchConsolePlatforms).toBeUndefined();
  });
});

describe('per-host pacing', () => {
  it('does not make one service wait on an unrelated one', async () => {
    let now = 0;
    const deps = createHttpEnrichers(memoryCache(), {
      fetchImpl: (async () => new Response('{}', { status: 200 })) as typeof fetch,
      minIntervalMs: 1_500,
      sleepImpl: async (ms) => {
        now += ms;
      },
      nowImpl: () => now,
    });

    // Steam, then SteamSpy, then ProtonDB — three different hosts, so none of
    // them should wait on the others.
    await deps.fetchAppDetails(1);
    const before = now;
    await deps.fetchSteamSpy(1);
    await deps.fetchProtonTier(1);

    expect(now).toBe(before);
  });

  it('still paces two requests to the same host', async () => {
    let now = 0;
    const deps = createHttpEnrichers(memoryCache(), {
      fetchImpl: (async () => new Response('{}', { status: 200 })) as typeof fetch,
      minIntervalMs: 1_500,
      sleepImpl: async (ms) => {
        now += ms;
      },
      nowImpl: () => now,
    });

    // appdetails and storesearch are both store.steampowered.com.
    await deps.fetchAppDetails(1);
    const before = now;
    await deps.searchStore('tunic');

    expect(now - before).toBeGreaterThanOrEqual(1_500);
  });
});
