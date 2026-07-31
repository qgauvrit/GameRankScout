import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILTERS,
  MIN_USEFUL_RESULTS,
  applyRanking,
  handheldSuitable,
  matchesFilters,
} from './apply.js';
import { evidence, game } from '../../../test/factory.js';
import type { Filters } from './apply.js';
import type { GameEntry, RankingWindow } from '../../corpus/schema.js';

const NOW = Date.parse('2026-07-28T00:00:00.000Z');

function filters(overrides: Partial<Filters> = {}): Filters {
  return { ...DEFAULT_FILTERS, ...overrides };
}

/** A game whose evidence sits in exactly the given windows. */
function inWindows(id: string, windows: RankingWindow[], overrides: Partial<GameEntry> = {}) {
  return game({
    id,
    name: id,
    evidence: windows.map((window) => evidence({ community: 'r/patientgamers', window })),
    ...overrides,
  });
}

function names(games: GameEntry[], value: Filters) {
  return applyRanking(games, value, { now: NOW }).ranked.map((entry) => entry.game.name);
}

describe('metadata filtering', () => {
  it('matches everything when nothing is selected', () => {
    expect(matchesFilters(game({ id: 'a' }), DEFAULT_FILTERS)).toBe(true);
  });

  it('restricts to a platform the game actually ships on', () => {
    const switchGame = game({ id: 'a', platforms: ['switch', 'pc'] });
    const pcOnly = game({ id: 'b', platforms: ['pc'] });

    expect(matchesFilters(switchGame, filters({ platform: 'switch' }))).toBe(true);
    expect(matchesFilters(pcOnly, filters({ platform: 'switch' }))).toBe(false);
  });

  it('matches a genre through community tags rather than store genres', () => {
    // "Metroidvania" has no formal-genre equivalent at all, which is the whole
    // reason genre filtering is built on tags (D9).
    const metroidvania = game({ id: 'a', tags: ['Metroidvania', 'Pixel Graphics'], genres: [] });

    expect(matchesFilters(metroidvania, filters({ genre: 'action-adventure' }))).toBe(true);
    expect(matchesFilters(metroidvania, filters({ genre: 'strategy' }))).toBe(false);
  });

  it('falls back to formal genres when a game resolved no tags', () => {
    const untagged = game({ id: 'a', tags: [], genres: ['Strategy'] });

    expect(matchesFilters(untagged, filters({ genre: 'strategy' }))).toBe(true);
  });

  it('ignores punctuation and casing differences between tag vocabularies', () => {
    const game1 = game({ id: 'a', tags: ['action-adventure'], genres: [] });
    const game2 = game({ id: 'b', tags: ['Action Adventure'], genres: [] });

    expect(matchesFilters(game1, filters({ genre: 'action-adventure' }))).toBe(true);
    expect(matchesFilters(game2, filters({ genre: 'action-adventure' }))).toBe(true);
  });

  it('filters on an exact community tag, including one with no top-level home', () => {
    const cozy = game({ id: 'a', tags: ['Cozy', 'Farming Sim'] });

    expect(matchesFilters(cozy, filters({ tag: 'Cozy' }))).toBe(true);
    expect(matchesFilters(cozy, filters({ tag: 'Roguelike' }))).toBe(false);
  });

  it('composes genre, platform and tag rather than replacing one with another', () => {
    const target = game({ id: 'a', platforms: ['pc'], tags: ['Roguelike', 'Action'] });

    expect(
      matchesFilters(target, filters({ platform: 'pc', genre: 'action-adventure', tag: 'Roguelike' })),
    ).toBe(true);
    expect(
      matchesFilters(target, filters({ platform: 'ps5', genre: 'action-adventure', tag: 'Roguelike' })),
    ).toBe(false);
  });
});

describe('handheld suitability', () => {
  it('accepts a game Steam has verified or called playable', () => {
    expect(handheldSuitable({ deck: 'verified', protonTier: null })).toBe(true);
    expect(handheldSuitable({ deck: 'playable', protonTier: null })).toBe(true);
    expect(handheldSuitable({ deck: 'unsupported', protonTier: 'platinum' })).toBe(false);
  });

  it('falls back to the community tier when Steam has issued no verdict', () => {
    expect(handheldSuitable({ deck: 'unknown', protonTier: 'gold' })).toBe(true);
    expect(handheldSuitable({ deck: 'unknown', protonTier: 'borked' })).toBe(false);
  });

  it('treats an unrated game as unproven rather than suitable', () => {
    expect(handheldSuitable(null)).toBe(false);
    expect(handheldSuitable({ deck: 'unknown', protonTier: null })).toBe(false);
  });

  it('is only applied inside a PC selection (R23)', () => {
    const unratedOnSwitch = game({ id: 'a', platforms: ['switch'], handheld: null });

    // Handheld means Deck-suitable, which is a PC concept; asking for it
    // outside a PC selection must not quietly exclude console games.
    expect(matchesFilters(unratedOnSwitch, filters({ platform: 'any', handheldOnly: true }))).toBe(
      true,
    );
    expect(
      matchesFilters(game({ id: 'b', platforms: ['pc'], handheld: null }), filters({ platform: 'pc', handheldOnly: true })),
    ).toBe(false);
  });
});

describe('progressive relaxation', () => {
  function crowd(window: RankingWindow, count: number): GameEntry[] {
    return Array.from({ length: count }, (_, index) => inWindows(`${window}-${index}`, [window]));
  }

  it('leaves a healthy result set exactly as asked for', () => {
    const games = crowd('week', MIN_USEFUL_RESULTS + 2);

    const result = applyRanking(games, filters({ window: 'week' }), { now: NOW });

    expect(result.window).toBe('week');
    expect(result.relaxedFrom).toBeNull();
    expect(result.ranked).toHaveLength(MIN_USEFUL_RESULTS + 2);
  });

  it('covers AE1: widens the timeframe and says which filter it relaxed', () => {
    const games = [
      inWindows('scarce', ['week'], { platforms: ['pc'], tags: ['Roguelike'] }),
      ...crowd('month', MIN_USEFUL_RESULTS).map((entry) => ({
        ...entry,
        platforms: ['pc'] as GameEntry['platforms'],
        tags: ['Roguelike'],
      })),
    ];

    const result = applyRanking(
      games,
      filters({ window: 'week', platform: 'pc', handheldOnly: true, tag: 'Roguelike' }),
      { now: NOW },
    );

    expect(result.window).toBe('month');
    expect(result.relaxedFrom).toBe('week');
    expect(result.relaxed).toBe('timeframe');
    expect(result.ranked.length).toBeGreaterThanOrEqual(MIN_USEFUL_RESULTS);
  });

  it('keeps every other filter intact while widening', () => {
    const games = [
      ...crowd('month', MIN_USEFUL_RESULTS).map((entry) => ({
        ...entry,
        platforms: ['pc'] as GameEntry['platforms'],
      })),
      // Same window, wrong platform: widening must not sweep this back in.
      ...crowd('month', 4).map((entry) => ({
        ...entry,
        id: `ps5-${entry.id}`,
        name: `ps5-${entry.name}`,
        platforms: ['ps5'] as GameEntry['platforms'],
      })),
    ];

    const result = applyRanking(games, filters({ window: 'week', platform: 'pc' }), { now: NOW });

    expect(result.relaxedFrom).toBe('week');
    expect(result.ranked.every((entry) => entry.game.platforms.includes('pc'))).toBe(true);
  });

  it('stops at the first timeframe that is actually useful', () => {
    const games = [...crowd('month', MIN_USEFUL_RESULTS), ...crowd('year', 40)];

    const result = applyRanking(games, filters({ window: 'week' }), { now: NOW });

    expect(result.window).toBe('month');
  });

  it('does not widen past the widest timeframe', () => {
    const result = applyRanking([inWindows('a', ['year'])], filters({ window: 'year' }), {
      now: NOW,
    });

    expect(result.window).toBe('year');
    expect(result.relaxedFrom).toBeNull();
  });

  it('reports honestly rather than widening forever when nothing matches at all', () => {
    const games = [inWindows('a', ['week', 'year'], { platforms: ['pc'] })];

    const result = applyRanking(games, filters({ window: 'week', platform: 'ios' }), { now: NOW });

    expect(result.ranked).toHaveLength(0);
    expect(result.exhausted).toBe(true);
    expect(result.relaxedFrom).toBeNull();
  });

  it('keeps the best timeframe it found when no timeframe clears the threshold', () => {
    // Widening is not monotone: a game with week-only evidence vanishes from the
    // year window. Settling for the emptier wider window would be a regression.
    const games = crowd('week', 3);

    const result = applyRanking(games, filters({ window: 'week' }), { now: NOW });

    expect(result.window).toBe('week');
    expect(result.ranked).toHaveLength(3);
    expect(result.relaxedFrom).toBeNull();
    expect(result.exhausted).toBe(false);
  });

  it('widens to the fullest timeframe it can when none is sufficient', () => {
    const games = [inWindows('a', ['week']), ...crowd('year', 3)];

    const result = applyRanking(games, filters({ window: 'week' }), { now: NOW });

    expect(result.window).toBe('year');
    expect(result.relaxedFrom).toBe('week');
    expect(result.ranked).toHaveLength(3);
  });
});

describe('ranking pass-through', () => {
  it('applies the selected mode', () => {
    const games = [
      inWindows('obscure', ['week'], { ownerBand: { min: 20_000, max: 50_000 } }),
      inWindows('mainstream', ['week'], { ownerBand: { min: 5_000_000, max: 10_000_000 } }),
    ];

    expect(names(games, filters({ mode: 'hiddenGems' }))[0]).toBe('obscure');
    // Covers AE3 through the filter layer: Top is the same games, obscurity off.
    expect(names(games, filters({ mode: 'top' }))[0]).toBe('mainstream');
  });

  it('drops dismissed games and disabled sources before ranking', () => {
    const games = [
      inWindows('kept', ['week']),
      inWindows('dismissed', ['week']),
      game({
        id: 'lemmy-only',
        name: 'lemmy-only',
        evidence: [evidence({ community: 'c/games', window: 'week', source: 'lemmy' })],
      }),
    ];

    const result = applyRanking(games, filters(), {
      now: NOW,
      dismissedGameIds: ['dismissed'],
      enabledSources: ['reddit'],
    });

    expect(result.ranked.map((entry) => entry.game.name)).toEqual(['kept']);
  });
});
