import { describe, it, expect } from 'vitest';
import { enrichGames, buildEvidence } from './resolve.js';
import { memoryCache } from './cache.js';
import type { EnrichDeps } from './resolve.js';
import type { EvidenceRecord, SourceItem } from '../corpus/schema.js';
import { buildDictionary } from '../extract/dictionary.js';

const CATALOGUE = [
  { appid: 553420, name: 'Tunic', owners: '1,000,000 .. 2,000,000', positive: 20_000, negative: 900 },
  { appid: 753640, name: 'Outer Wilds', owners: '1,000,000 .. 2,000,000', positive: 40_000, negative: 2_000 },
];

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    source: 'reddit',
    community: 'r/patientgamers',
    thread: { id: 't3_1', title: 'thread', permalink: 'https://example.test/1' },
    window: 'year',
    rankPosition: 0,
    postedAt: '2026-07-01T00:00:00.000Z',
    mention: 'Tunic',
    gameId: 'steam:553420',
    ...overrides,
  };
}

/** Records how often each remote surface was consulted, for the cache test. */
function stubDeps(overrides: Partial<EnrichDeps> = {}) {
  const calls = { appDetails: 0, steamSpy: 0, deck: 0, proton: 0, search: 0, console: 0 };
  const deps: EnrichDeps = {
    cache: memoryCache(),
    async fetchAppDetails(appid) {
      calls.appDetails += 1;
      return {
        name: appid === 553420 ? 'TUNIC' : 'Outer Wilds',
        type: 'game',
        genres: ['Action', 'Adventure'],
        platforms: { windows: true, mac: true, linux: false },
      };
    },
    async fetchSteamSpy() {
      calls.steamSpy += 1;
      return {
        tags: ['Metroidvania', 'Isometric', 'Souls-like'],
        ownerBand: { min: 1_000_000, max: 2_000_000 },
        reviews: 20_900,
      };
    },
    async fetchDeckReport() {
      calls.deck += 1;
      return 'verified' as const;
    },
    async fetchProtonTier() {
      calls.proton += 1;
      return 'platinum' as const;
    },
    async searchStore(name) {
      calls.search += 1;
      return name.toLowerCase().includes('silksong') ? { id: 1030300, name: 'Hollow Knight: Silksong' } : null;
    },
    ...overrides,
  };
  return { deps, calls };
}

describe('buildEvidence', () => {
  const dictionary = buildDictionary(CATALOGUE);

  function item(overrides: Partial<SourceItem> = {}): SourceItem {
    return {
      source: 'reddit',
      community: 'r/patientgamers',
      thread: { id: 't3_1', title: 'thread', permalink: 'https://example.test/1' },
      window: 'year',
      rankPosition: 0,
      postedAt: '2026-07-01T00:00:00.000Z',
      kind: 'post',
      parentThreadId: null,
      text: 'Tunic is wonderful.',
      ...overrides,
    };
  }

  it('produces one evidence record per game mentioned in an item', () => {
    const records = buildEvidence(
      [item({ text: 'Both Tunic and Outer Wilds are worth it.' })],
      dictionary,
    );

    expect(records.map((r) => r.gameId).sort()).toEqual(['steam:553420', 'steam:753640']);
    for (const record of records) {
      expect(record.thread.id).toBe('t3_1');
      expect(record.rankPosition).toBe(0);
    }
  });

  it('carries no post or comment body into the evidence it produces', () => {
    const records = buildEvidence([item({ text: 'Tunic is wonderful and here is a long body.' })], dictionary);

    // Only the surface form survives; the body is dropped after extraction (KTD11).
    expect(records[0]?.mention).toBe('Tunic');
    expect(JSON.stringify(records[0])).not.toContain('long body');
  });

  it('drops an item mentioning no game', () => {
    expect(buildEvidence([item({ text: 'Just looking for something short.' })], dictionary)).toEqual([]);
  });

  it('attributes a comment to its own permalink so evidence links deep', () => {
    const records = buildEvidence(
      [
        item({
          kind: 'comment',
          parentThreadId: 't3_1',
          thread: { id: 't1_9', title: '', permalink: 'https://example.test/1/c9' },
        }),
      ],
      dictionary,
    );

    expect(records[0]?.thread.permalink).toBe('https://example.test/1/c9');
  });
});

describe('enrichGames', () => {
  it('resolves the same game under different surface forms into one entry', async () => {
    const { deps } = stubDeps();

    const games = await enrichGames(
      [
        evidence({ mention: 'Tunic', community: 'r/patientgamers' }),
        evidence({ mention: 'TUNIC', community: 'r/gamingsuggestions', thread: { id: 't3_2', title: 'x', permalink: 'https://example.test/2' } }),
      ],
      deps,
    );

    expect(games).toHaveLength(1);
    expect(games[0]?.id).toBe('steam:553420');
    expect(games[0]?.evidence).toHaveLength(2);
  });

  it('attaches genres, community tags, platforms, owner band and a store link', async () => {
    const { deps } = stubDeps();

    const [game] = await enrichGames([evidence()], deps);

    expect(game?.name).toBe('TUNIC');
    expect(game?.genres).toContain('Action');
    expect(game?.tags).toContain('Metroidvania');
    expect(game?.platforms).toContain('pc');
    expect(game?.ownerBand).toEqual({ min: 1_000_000, max: 2_000_000 });
    expect(game?.storeLinks[0]).toEqual({
      store: 'steam',
      url: 'https://store.steampowered.com/app/553420/',
    });
  });

  it('still ranks a game with no catalogue entry, carrying what resolved', async () => {
    const { deps } = stubDeps({
      async fetchAppDetails() {
        return null;
      },
      async fetchSteamSpy() {
        return null;
      },
      async fetchDeckReport() {
        return null;
      },
      async fetchProtonTier() {
        return null;
      },
    });

    const [game] = await enrichGames(
      [evidence({ gameId: null, mention: 'Some Unlisted Game' })],
      deps,
    );

    expect(game).toBeDefined();
    expect(game?.name).toBe('Some Unlisted Game');
    expect(game?.ownerBand).toBeNull();
    // A game with no metadata must still be rankable rather than dropped.
    expect(game?.evidence).toHaveLength(1);
  });

  it('resolves an unlisted name through catalogue search when one matches', async () => {
    const { deps, calls } = stubDeps();

    const [game] = await enrichGames(
      [evidence({ gameId: null, mention: 'Hollow Knight Silksong' })],
      deps,
    );

    expect(calls.search).toBe(1);
    expect(game?.id).toBe('steam:1030300');
  });

  it('falls back to the community rating source when no compatibility report exists', async () => {
    const { deps } = stubDeps({
      async fetchDeckReport() {
        return null;
      },
    });

    const [game] = await enrichGames([evidence()], deps);

    expect(game?.handheld).toEqual({ deck: 'unknown', protonTier: 'platinum' });
  });

  it('prefers the compatibility report over the community rating when both exist', async () => {
    const { deps } = stubDeps();

    const [game] = await enrichGames([evidence()], deps);

    expect(game?.handheld?.deck).toBe('verified');
  });

  it('serves metadata for a previously seen game from cache rather than refetching', async () => {
    const { deps, calls } = stubDeps();

    await enrichGames([evidence()], deps);
    expect(calls.appDetails).toBe(1);

    await enrichGames([evidence({ thread: { id: 't3_9', title: 'x', permalink: 'https://example.test/9' } })], deps);

    expect(calls.appDetails).toBe(1);
    expect(calls.steamSpy).toBe(1);
  });

  it('degrades console metadata and still succeeds when credentials are absent', async () => {
    const { deps } = stubDeps();
    // No fetchConsolePlatforms supplied — the IGDB path is unavailable.

    const [game] = await enrichGames([evidence()], deps);

    expect(game).toBeDefined();
    expect(game?.platforms).toEqual(['pc']);
  });

  it('adds console platforms when the credentialed source is available', async () => {
    const { deps } = stubDeps({
      async fetchConsolePlatforms() {
        return ['switch', 'xbox-series'];
      },
    });

    const [game] = await enrichGames([evidence()], deps);

    expect(game?.platforms.sort()).toEqual(['pc', 'switch', 'xbox-series']);
  });

  it('survives a console lookup that throws, rather than failing the run', async () => {
    const { deps } = stubDeps({
      async fetchConsolePlatforms() {
        throw new Error('IGDB token expired');
      },
    });

    const [game] = await enrichGames([evidence()], deps);

    expect(game?.platforms).toEqual(['pc']);
  });

  it('carries a weight for every window, so momentum is computable within the run', async () => {
    const { deps } = stubDeps();

    const [game] = await enrichGames(
      [
        evidence({ window: 'week', rankPosition: 0 }),
        evidence({ window: 'year', rankPosition: 10, thread: { id: 't3_2', title: 'x', permalink: 'https://example.test/2' } }),
      ],
      deps,
    );

    expect(game?.windowWeights.week).toBeGreaterThan(0);
    expect(game?.windowWeights.year).toBeGreaterThan(0);
    expect(game?.windowWeights.month).toBe(0);
    expect(game?.windowWeights.sixMonths).toBe(0);
    // A better-ranked thread contributes more weight than a worse-ranked one.
    expect(game?.windowWeights.week).toBeGreaterThan(game!.windowWeights.year);
  });

  it('skips a resolved entry that is not a game', async () => {
    const { deps } = stubDeps({
      async fetchAppDetails() {
        return { name: 'Tunic Soundtrack', type: 'music', genres: [], platforms: { windows: true, mac: false, linux: false } };
      },
    });

    expect(await enrichGames([evidence()], deps)).toEqual([]);
  });
});
