import { rankGames } from '../../ranking/score.js';
import { RANKING_MODES } from '../../ranking/modes.js';
import { ANY, inGenre, normalizeTag } from './genres.js';
import type { RankedGame } from '../../ranking/score.js';
import type { RankingMode } from '../../ranking/modes.js';
import type { GameEntry, Handheld, Platform, RankingWindow, SourceId } from '../../corpus/schema.js';

export interface Filters {
  mode: RankingMode;
  window: RankingWindow;
  /** `any` is a real selection, not an absent one — it is the default view. */
  platform: Platform | typeof ANY;
  /** Only meaningful inside a PC selection (R23). */
  handheldOnly: boolean;
  /** A top-level genre id from `TOP_LEVEL_GENRES`, or `any`. */
  genre: string;
  /** An exact community tag, or `any`. */
  tag: string;
}

/**
 * Unfamiliar-first, this week, everywhere (D4, R31). A reader who changes
 * nothing must still land on a ranking worth scrolling.
 */
export const DEFAULT_FILTERS: Filters = {
  mode: 'hiddenGems',
  window: 'week',
  platform: ANY,
  handheldOnly: false,
  genre: ANY,
  tag: ANY,
};

/**
 * Below this many results a ranking stops being something to browse and starts
 * being a dead end, which is what triggers relaxation (D11, R25).
 */
export const MIN_USEFUL_RESULTS = 6;

/** Timeframes in widening order. `null` marks the widest — relaxation stops there. */
const WIDER_WINDOW: Record<RankingWindow, RankingWindow | null> = {
  week: 'month',
  month: 'sixMonths',
  sixMonths: 'year',
  year: null,
};

const DECK_SUITABLE = new Set(['verified', 'playable']);
const PROTON_SUITABLE = new Set(['platinum', 'gold']);

/**
 * Whether a game is worth putting on a handheld. Steam's own verdict wins;
 * the community tier is the fallback when Steam has issued none.
 *
 * An unrated game is unproven, not suitable. A filter that means "I am going to
 * play this on a train" is worth nothing if it returns games that might not run.
 */
export function handheldSuitable(handheld: Handheld | null): boolean {
  if (!handheld) return false;
  if (DECK_SUITABLE.has(handheld.deck)) return true;
  if (handheld.deck === 'unsupported') return false;
  return handheld.protonTier !== null && PROTON_SUITABLE.has(handheld.protonTier);
}

/**
 * Metadata filtering only — the timeframe is applied by ranking, because a
 * window selects evidence rather than games.
 */
export function matchesFilters(game: GameEntry, filters: Filters): boolean {
  if (filters.platform !== ANY && !game.platforms.includes(filters.platform)) return false;

  // Handheld suitability is a PC concept, so it is offered and applied only
  // inside a PC selection; elsewhere it would silently exclude every console.
  if (filters.handheldOnly && filters.platform === 'pc' && !handheldSuitable(game.handheld)) {
    return false;
  }

  if (filters.genre !== ANY) {
    // Tags first, formal genres as the coarse fallback for a game whose tag
    // lookup returned nothing (D9).
    const vocabulary = game.tags.length > 0 ? [...game.tags, ...game.genres] : game.genres;
    if (!inGenre(vocabulary, filters.genre)) return false;
  }

  if (filters.tag !== ANY) {
    const wanted = normalizeTag(filters.tag);
    if (!game.tags.some((tag) => normalizeTag(tag) === wanted)) return false;
  }

  return true;
}

/**
 * Whether the selected mode's momentum term can say anything at all.
 *
 * Momentum is a recent-over-historical ratio computed inside one run (KTD12),
 * so it needs the recent window to carry weight. A run scoped to fewer windows
 * leaves that side empty, and the ratio then collapses to the same value for
 * every game — the mode still ranks, but not by what its name promises. That is
 * worth saying rather than letting the reader read a Breakout list that is not
 * one (R35).
 */
export function momentumAvailable(games: GameEntry[], mode: RankingMode): boolean {
  const preset = RANKING_MODES[mode];
  if (preset.momentumWeight === 0 || !preset.momentum) return true;
  const recent = preset.momentum.recent;
  return games.some((game) => game.windowWeights[recent] > 0);
}

export interface ApplyOptions {
  now?: number;
  enabledSources?: SourceId[];
  disabledCommunities?: string[];
  dismissedGameIds?: string[];
}

export interface RankingResult {
  ranked: RankedGame[];
  /** The timeframe the results actually came from. */
  window: RankingWindow;
  /** The reader's original timeframe, when it had to be widened. */
  relaxedFrom: RankingWindow | null;
  /** Which filter gave way. Only the timeframe is ever relaxed (D11). */
  relaxed: 'timeframe' | null;
  /** True when no timeframe produced anything — an honest empty, not a widening. */
  exhausted: boolean;
}

function rankIn(
  candidates: GameEntry[],
  filters: Filters,
  window: RankingWindow,
  options: ApplyOptions,
): RankedGame[] {
  return rankGames(candidates, {
    mode: filters.mode,
    window,
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.enabledSources !== undefined ? { enabledSources: options.enabledSources } : {}),
    ...(options.disabledCommunities !== undefined
      ? { disabledCommunities: options.disabledCommunities }
      : {}),
    ...(options.dismissedGameIds !== undefined
      ? { dismissedGameIds: options.dismissedGameIds }
      : {}),
  });
}

/**
 * Filters the corpus, ranks it, and widens the timeframe when the result is too
 * sparse to be worth browsing (R25, AE1).
 *
 * Only the timeframe gives way. The reader's platform, genre and tag choices
 * are what they came for; quietly ignoring one of those would answer a question
 * they did not ask. Widening is also not assumed to help — evidence windows are
 * separate listings, so a game seen only this week genuinely is absent from the
 * year — which is why the best timeframe found is kept rather than the last one
 * tried.
 */
export function applyRanking(
  games: GameEntry[],
  filters: Filters,
  options: ApplyOptions = {},
): RankingResult {
  const candidates = games.filter((game) => matchesFilters(game, filters));

  let best: { window: RankingWindow; ranked: RankedGame[] } = {
    window: filters.window,
    ranked: rankIn(candidates, filters, filters.window, options),
  };

  let window: RankingWindow | null = filters.window;
  while (best.ranked.length < MIN_USEFUL_RESULTS) {
    window = WIDER_WINDOW[window];
    if (window === null) break;

    const ranked = rankIn(candidates, filters, window, options);
    if (ranked.length > best.ranked.length) best = { window, ranked };
    if (best.ranked.length >= MIN_USEFUL_RESULTS) break;
  }

  const relaxed = best.window !== filters.window;
  return {
    ranked: best.ranked,
    window: best.window,
    relaxedFrom: relaxed ? filters.window : null,
    relaxed: relaxed ? 'timeframe' : null,
    exhausted: best.ranked.length === 0,
  };
}
