import { describe, it, expect } from 'vitest';
import { rankGames } from './score.js';
import { RANKING_MODES } from './modes.js';
import type { EvidenceRecord, GameEntry, RankingWindow, SourceId } from '../corpus/schema.js';

const NOW = Date.parse('2026-07-28T00:00:00.000Z');

let threadCounter = 0;

function evidence(
  overrides: Partial<EvidenceRecord> & { community: string; window: RankingWindow },
): EvidenceRecord {
  threadCounter += 1;
  return {
    source: 'reddit' as SourceId,
    thread: {
      id: `t3_${threadCounter}`,
      title: 'thread',
      permalink: `https://example.test/${threadCounter}`,
    },
    rankPosition: 0,
    postedAt: new Date(NOW - 24 * 60 * 60 * 1000).toISOString(),
    mention: 'game',
    gameId: 'steam:1',
    ...overrides,
  };
}

function game(overrides: Partial<GameEntry> & { id: string }): GameEntry {
  return {
    name: overrides.id,
    storeLinks: [],
    tags: [],
    genres: [],
    platforms: ['pc'],
    ownerBand: { min: 500_000, max: 1_000_000 },
    reviewCount: 1_000,
    handheld: null,
    windowWeights: { week: 1, month: 1, sixMonths: 1, year: 1 },
    evidence: [],
    ...overrides,
  };
}

/** Same thread appearing in several windows is how magnitude is inferred (KTD4). */
function threadAcrossWindows(
  id: string,
  community: string,
  windows: RankingWindow[],
  rankPosition = 0,
): EvidenceRecord[] {
  return windows.map((window) => ({
    ...evidence({ community, window }),
    thread: { id, title: 'big thread', permalink: `https://example.test/${id}` },
    rankPosition,
  }));
}

function order(games: GameEntry[], options: Parameters<typeof rankGames>[1]): string[] {
  return rankGames(games, options).map((r) => r.game.id);
}

describe('ranking modes', () => {
  it('exposes exactly the v1 modes', () => {
    expect(Object.keys(RANKING_MODES).sort()).toEqual(
      ['breakout', 'hiddenGems', 'mostDiscussed', 'rising', 'top'].sort(),
    );
  });

  it('drives every mode from one scoring path, changing parameters only', () => {
    // Each preset must be a parameter set, not a separate algorithm (R19).
    for (const preset of Object.values(RANKING_MODES)) {
      expect(preset).toHaveProperty('obscurityWeight');
      expect(preset).toHaveProperty('engagementWeight');
      expect(preset).toHaveProperty('momentumWeight');
      expect(preset).toHaveProperty('magnitudeWeight');
    }
  });
});

describe('obscurity (AE3)', () => {
  const mainstream = game({
    id: 'mainstream',
    ownerBand: { min: 20_000_000, max: 50_000_000 },
    evidence: [
      ...threadAcrossWindows('t-main-1', 'r/a', ['week', 'month', 'year'], 0),
      evidence({ community: 'r/b', window: 'year', rankPosition: 1 }),
    ],
  });
  const obscure = game({
    id: 'obscure',
    ownerBand: { min: 100_000, max: 200_000 },
    evidence: [
      ...threadAcrossWindows('t-obs-1', 'r/a', ['week', 'month', 'year'], 1),
      evidence({ community: 'r/b', window: 'year', rankPosition: 2 }),
    ],
  });

  it('ranks a widely-owned title below a less-owned one in the default mode', () => {
    expect(order([mainstream, obscure], { mode: 'hiddenGems', window: 'year', now: NOW })).toEqual([
      'obscure',
      'mainstream',
    ]);
  });

  it('ranks that same widely-owned title at the top once obscurity is disabled', () => {
    expect(order([mainstream, obscure], { mode: 'top', window: 'year', now: NOW })).toEqual([
      'mainstream',
      'obscure',
    ]);
  });

  it('treats an unknown owner band as neither a boost nor a penalty spike', () => {
    const unknown = rankGames(
      [
        game({
          id: 'unknown',
          ownerBand: null,
          evidence: [evidence({ community: 'r/a', window: 'year' })],
        }),
      ],
      { mode: 'hiddenGems', window: 'year', now: NOW },
    );

    expect(Number.isFinite(unknown[0]!.components.obscurity)).toBe(true);
    expect(unknown[0]!.components.obscurity).toBeGreaterThan(0);
  });
});

describe('thread magnitude (AE4)', () => {
  it('does not rank a single large thread below several small ones', () => {
    // Both games are discussed in the same number of communities.
    const oneBigThread = game({
      id: 'one-big',
      evidence: [
        ...threadAcrossWindows('big', 'r/a', ['week', 'month', 'sixMonths', 'year'], 0),
        ...threadAcrossWindows('big2', 'r/b', ['week', 'month', 'sixMonths', 'year'], 0),
      ],
    });
    const manySmallThreads = game({
      id: 'many-small',
      evidence: [
        evidence({ community: 'r/a', window: 'year', rankPosition: 5 }),
        evidence({ community: 'r/a', window: 'year', rankPosition: 6 }),
        evidence({ community: 'r/a', window: 'year', rankPosition: 7 }),
        evidence({ community: 'r/b', window: 'year', rankPosition: 8 }),
        evidence({ community: 'r/b', window: 'year', rankPosition: 9 }),
      ],
    });

    const ranked = order([manySmallThreads, oneBigThread], {
      mode: 'top',
      window: 'year',
      now: NOW,
    });

    expect(ranked[0]).toBe('one-big');
  });

  it('never damps a game for being discussed in few threads', () => {
    const few = game({ id: 'few', evidence: [evidence({ community: 'r/a', window: 'year' })] });
    const same = game({
      id: 'same-plus-one',
      evidence: [
        evidence({ community: 'r/a', window: 'year' }),
        evidence({ community: 'r/a', window: 'year' }),
      ],
    });

    const scores = rankGames([few, same], { mode: 'top', window: 'year', now: NOW });
    const fewScore = scores.find((s) => s.game.id === 'few')!.score;
    const sameScore = scores.find((s) => s.game.id === 'same-plus-one')!.score;

    // More threads must never score lower than fewer threads, all else equal.
    expect(sameScore).toBeGreaterThan(fewScore);
  });
});

describe('community breadth', () => {
  it('outranks a game whose equal mentions are concentrated in one community', () => {
    const broad = game({
      id: 'broad',
      evidence: [
        evidence({ community: 'r/a', window: 'year', rankPosition: 3 }),
        evidence({ community: 'r/b', window: 'year', rankPosition: 3 }),
        evidence({ community: 'r/c', window: 'year', rankPosition: 3 }),
        evidence({ community: 'r/d', window: 'year', rankPosition: 3 }),
      ],
    });
    const narrow = game({
      id: 'narrow',
      evidence: [
        evidence({ community: 'r/a', window: 'year', rankPosition: 3 }),
        evidence({ community: 'r/a', window: 'year', rankPosition: 3 }),
        evidence({ community: 'r/a', window: 'year', rankPosition: 3 }),
        evidence({ community: 'r/a', window: 'year', rankPosition: 3 }),
      ],
    });

    expect(order([narrow, broad], { mode: 'top', window: 'year', now: NOW })[0]).toBe('broad');
  });
});

describe('momentum (AE2, KTD12)', () => {
  it('ranks a game absent from the historical window as strongly rising', () => {
    const brandNew = game({
      id: 'brand-new',
      windowWeights: { week: 5, month: 5, sixMonths: 0, year: 0 },
      evidence: [evidence({ community: 'r/a', window: 'week' })],
    });
    const steady = game({
      id: 'steady',
      windowWeights: { week: 5, month: 5, sixMonths: 5, year: 5 },
      evidence: [evidence({ community: 'r/a', window: 'week' })],
    });

    const ranked = rankGames([steady, brandNew], { mode: 'breakout', window: 'week', now: NOW });

    expect(ranked[0]!.game.id).toBe('brand-new');
    expect(ranked[0]!.score).toBeGreaterThan(0);
    expect(Number.isFinite(ranked[0]!.score)).toBe(true);
  });

  it('does not exclude or zero a game that has no history', () => {
    const ranked = rankGames(
      [
        game({
          id: 'no-history',
          windowWeights: { week: 2, month: 2, sixMonths: 0, year: 0 },
          evidence: [evidence({ community: 'r/a', window: 'week' })],
        }),
      ],
      { mode: 'breakout', window: 'week', now: NOW },
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.score).toBeGreaterThan(0);
  });

  it('does not move a game up Breakout merely because a community was added', () => {
    // Adding a community lifts both windows together, so the ratio is unchanged.
    const before = [
      game({
        id: 'a',
        windowWeights: { week: 2, month: 2, sixMonths: 4, year: 4 },
        evidence: [evidence({ community: 'r/a', window: 'week' })],
      }),
      game({
        id: 'b',
        windowWeights: { week: 6, month: 6, sixMonths: 4, year: 4 },
        evidence: [evidence({ community: 'r/a', window: 'week' })],
      }),
    ];
    const scale = 1.5;
    const after = before.map((g) =>
      game({
        ...g,
        windowWeights: {
          week: g.windowWeights.week * scale,
          month: g.windowWeights.month * scale,
          sixMonths: g.windowWeights.sixMonths * scale,
          year: g.windowWeights.year * scale,
        },
      }),
    );

    const optsBefore = { mode: 'breakout' as const, window: 'week' as const, now: NOW };
    expect(order(after, optsBefore)).toEqual(order(before, optsBefore));
  });
});

describe('source and dismissal filtering', () => {
  it('changes the ranking when a source is disabled, without re-ingesting (AE5)', () => {
    const games = [
      game({
        id: 'reddit-heavy',
        evidence: [
          evidence({ community: 'r/a', window: 'year', rankPosition: 0 }),
          evidence({ community: 'r/b', window: 'year', rankPosition: 0 }),
        ],
      }),
      game({
        id: 'lemmy-heavy',
        evidence: [
          { ...evidence({ community: 'l/a', window: 'year', rankPosition: 0 }), source: 'lemmy' },
          { ...evidence({ community: 'l/b', window: 'year', rankPosition: 0 }), source: 'lemmy' },
          { ...evidence({ community: 'l/c', window: 'year', rankPosition: 0 }), source: 'lemmy' },
        ],
      }),
    ];

    const withAll = order(games, { mode: 'top', window: 'year', now: NOW });
    const withoutLemmy = order(games, {
      mode: 'top',
      window: 'year',
      now: NOW,
      enabledSources: ['reddit'],
    });

    expect(withAll[0]).toBe('lemmy-heavy');
    expect(withoutLemmy).toEqual(['reddit-heavy']);
  });

  it('omits a dismissed game from every mode and window (AE6)', () => {
    const games = [
      game({ id: 'keep', evidence: [evidence({ community: 'r/a', window: 'year' })] }),
      game({ id: 'dismissed', evidence: [evidence({ community: 'r/a', window: 'year' })] }),
    ];

    for (const mode of Object.keys(RANKING_MODES) as Array<keyof typeof RANKING_MODES>) {
      for (const window of ['week', 'month', 'sixMonths', 'year'] as RankingWindow[]) {
        const ids = order(games, { mode, window, now: NOW, dismissedGameIds: ['dismissed'] });
        expect(ids).not.toContain('dismissed');
      }
    }
  });
});

describe('engagement', () => {
  it('lifts a game whose source exposes real figures, without requiring them', () => {
    const withFigures = game({
      id: 'with-figures',
      evidence: [
        {
          ...evidence({ community: 'l/a', window: 'year' }),
          source: 'lemmy',
          engagement: { score: 4_000, comments: 500 },
        },
      ],
    });
    const withoutFigures = game({
      id: 'without-figures',
      evidence: [evidence({ community: 'r/a', window: 'year' })],
    });

    const ranked = order([withoutFigures, withFigures], {
      mode: 'mostDiscussed',
      window: 'year',
      now: NOW,
    });

    expect(ranked[0]).toBe('with-figures');
    // Absent engagement must not be read as zero engagement and sink the game.
    expect(
      rankGames([withoutFigures], { mode: 'mostDiscussed', window: 'year', now: NOW })[0]!.score,
    ).toBeGreaterThan(0);
  });
});

describe('time decay', () => {
  it('applies decay on short windows and not on the year window', () => {
    const stale = game({
      id: 'stale',
      evidence: [
        {
          ...evidence({ community: 'r/a', window: 'week' }),
          postedAt: new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          ...evidence({ community: 'r/a', window: 'year' }),
          postedAt: new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    });

    const onWeek = rankGames([stale], { mode: 'top', window: 'week', now: NOW })[0]!;
    const onYear = rankGames([stale], { mode: 'top', window: 'year', now: NOW })[0]!;

    expect(onWeek.components.decay).toBeLessThan(1);
    expect(onYear.components.decay).toBe(1);
  });
});

describe('purity (R29)', () => {
  it('returns identical output for identical input across repeated calls', () => {
    const games = [
      game({
        id: 'a',
        evidence: [
          evidence({ community: 'r/a', window: 'year' }),
          evidence({ community: 'r/b', window: 'year' }),
        ],
      }),
      game({ id: 'b', evidence: [evidence({ community: 'r/c', window: 'year' })] }),
    ];
    const options = { mode: 'hiddenGems' as const, window: 'year' as const, now: NOW };

    expect(rankGames(games, options)).toEqual(rankGames(games, options));
  });

  it('does not mutate the games it is given', () => {
    const games = [
      game({ id: 'a', evidence: [evidence({ community: 'r/a', window: 'year' })] }),
    ];
    const snapshot = structuredClone(games);

    rankGames(games, { mode: 'hiddenGems', window: 'year', now: NOW });

    expect(games).toEqual(snapshot);
  });

  it('drops a game with no evidence in the selected window', () => {
    const games = [
      game({ id: 'week-only', evidence: [evidence({ community: 'r/a', window: 'week' })] }),
    ];

    expect(order(games, { mode: 'top', window: 'year', now: NOW })).toEqual([]);
  });

  it('explains each ranked entry with its scoring components', () => {
    const ranked = rankGames(
      [game({ id: 'a', evidence: [evidence({ community: 'r/a', window: 'year' })] })],
      { mode: 'hiddenGems', window: 'year', now: NOW },
    );

    expect(Object.keys(ranked[0]!.components).sort()).toEqual(
      ['breadth', 'decay', 'engagement', 'fusion', 'magnitude', 'momentum', 'obscurity'].sort(),
    );
  });

  it('demotes a mega-selling title even when it is discussed more', () => {
    // AE3 at the strength the real corpus demands: on a cold open the default
    // view must not lead with the games everyone has already heard of, and a
    // household name genuinely does out-discuss an unfamiliar one (R17, R31).
    const householdName = game({
      id: 'household',
      ownerBand: { min: 20_000_000, max: 50_000_000 },
      evidence: Array.from({ length: 12 }, () =>
        evidence({ community: 'r/a', window: 'month' }),
      ),
    });
    const unfamiliar = game({
      id: 'unfamiliar',
      ownerBand: { min: 100_000, max: 200_000 },
      evidence: Array.from({ length: 4 }, () => evidence({ community: 'r/a', window: 'month' })),
    });

    expect(order([householdName, unfamiliar], { mode: 'hiddenGems', window: 'month', now: NOW })).toEqual([
      'unfamiliar',
      'household',
    ]);
    // And Top is still a faithful popularity ranking, unchanged by any of this.
    expect(order([householdName, unfamiliar], { mode: 'top', window: 'month', now: NOW })).toEqual([
      'household',
      'unfamiliar',
    ]);
  });

  it('drops a community the reader switched off, without re-ingesting', () => {
    const games = [
      game({
        id: 'a',
        evidence: [
          evidence({ community: 'r/kept', window: 'year' }),
          evidence({ community: 'r/dropped', window: 'year' }),
        ],
      }),
      game({ id: 'b', evidence: [evidence({ community: 'r/dropped', window: 'year' })] }),
    ];

    const ranked = rankGames(games, {
      mode: 'top',
      window: 'year',
      now: NOW,
      disabledCommunities: ['r/dropped'],
    });

    expect(ranked.map((entry) => entry.game.id)).toEqual(['a']);
    expect(ranked[0]!.contributing.map((record) => record.community)).toEqual(['r/kept']);
  });

  it('keeps contributing a community the reader never chose', () => {
    // Disabling is stored as an exception, so a community the corpus gains
    // arrives contributing rather than silently absent.
    const games = [game({ id: 'a', evidence: [evidence({ community: 'r/brand-new', window: 'year' })] })];

    const ranked = rankGames(games, {
      mode: 'top',
      window: 'year',
      now: NOW,
      disabledCommunities: ['r/dropped'],
    });

    expect(ranked).toHaveLength(1);
  });

  it('carries out exactly the evidence that produced the score', () => {
    // The drill-down cites these records directly rather than re-deriving them,
    // so what the reader is shown cannot drift from what was ranked (R14).
    const scoring = evidence({ community: 'r/a', window: 'year' });
    const games = [
      game({
        id: 'a',
        evidence: [
          scoring,
          evidence({ community: 'r/a', window: 'week' }),
          evidence({ community: 'r/b', window: 'year', source: 'lemmy' }),
        ],
      }),
    ];

    const ranked = rankGames(games, {
      mode: 'hiddenGems',
      window: 'year',
      now: NOW,
      enabledSources: ['reddit'],
    });

    expect(ranked[0]!.contributing).toEqual([scoring]);
  });
});
