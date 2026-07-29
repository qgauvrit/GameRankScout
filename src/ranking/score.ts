import { RANKING_MODES } from './modes.js';
import { threadMagnitudes } from './magnitude.js';
import type { ModePreset, RankingMode } from './modes.js';
import type { EvidenceRecord, GameEntry, RankingWindow, SourceId } from '../corpus/schema.js';

/**
 * Reciprocal-rank-fusion constant. Large enough that the top few positions are
 * not wildly separated, small enough that position still matters deep in a list.
 */
const RRF_K = 60;

/** How strongly breadth of communities lifts a game. */
const BREADTH_WEIGHT = 0.8;

/** Owner count at which obscurity is neutral; below it games are lifted. */
const OWNER_PIVOT = 1_000_000;
const OBSCURITY_EXPONENT = 0.35;
const OWNER_FLOOR = 5_000;

/**
 * Applied when a game resolved to no catalogue entry. Slightly favourable —
 * absence usually means genuinely small rather than genuinely huge — but far
 * short of what a confirmed tiny owner count earns.
 */
const UNKNOWN_OBSCURITY = 1.15;

/** Half-life of a game's freshness, per window. The year window does not decay. */
const DECAY_HALF_LIFE_DAYS: Record<RankingWindow, number | null> = {
  week: 3.5,
  month: 15,
  sixMonths: 90,
  year: null,
};

/** Ceiling applied to the momentum ratio so a zero baseline cannot run away. */
const MAX_MOMENTUM = 12;

export interface ScoreComponents {
  fusion: number;
  breadth: number;
  engagement: number;
  magnitude: number;
  obscurity: number;
  decay: number;
  momentum: number;
}

export interface RankedGame {
  game: GameEntry;
  score: number;
  components: ScoreComponents;
  /**
   * The evidence records that actually produced this score — the selected
   * window, from the enabled sources only. Carried out of the scoring function
   * rather than re-derived by the view, so "why did this rank" cannot drift
   * away from what was ranked (R14, R34).
   */
  contributing: EvidenceRecord[];
}

export interface RankingOptions {
  mode: RankingMode;
  window: RankingWindow;
  /** Injected so ranking stays a pure function of its inputs (R29). */
  now?: number;
  /** When given, only evidence from these sources contributes (R9). */
  enabledSources?: SourceId[];
  dismissedGameIds?: string[];
}

function obscurityMultiplier(game: GameEntry): number {
  if (!game.ownerBand) return UNKNOWN_OBSCURITY;
  const owners = Math.max(game.ownerBand.max || game.ownerBand.min || 0, OWNER_FLOOR);
  return (OWNER_PIVOT / owners) ** OBSCURITY_EXPONENT;
}

function freshnessDecay(
  evidence: EvidenceRecord[],
  window: RankingWindow,
  now: number,
): number {
  const halfLife = DECAY_HALF_LIFE_DAYS[window];
  if (halfLife === null) return 1;
  if (evidence.length === 0) return 1;

  // Freshness is taken from the most recent contributing thread: a game with one
  // active thread this week is current even if its other threads are older.
  const newest = evidence.reduce((max, record) => {
    const at = Date.parse(record.postedAt);
    return Number.isNaN(at) ? max : Math.max(max, at);
  }, Number.NEGATIVE_INFINITY);

  if (!Number.isFinite(newest)) return 1;

  const ageDays = Math.max(0, (now - newest) / 86_400_000);
  return 2 ** (-ageDays / halfLife);
}

/**
 * Recent-window weight over historical-window weight, computed inside a single
 * run (KTD12).
 *
 * Both windows are fetched together over the same communities, so a change to
 * the community set moves numerator and denominator together and cannot
 * manufacture a spike. A game absent from the historical window is new rather
 * than unpopular, so it scores maximum rise instead of dividing by zero.
 */
export function momentumRatio(recent: number, historical: number): number {
  if (recent <= 0) return 0;
  if (historical <= 0) return MAX_MOMENTUM;
  return Math.min(MAX_MOMENTUM, recent / historical);
}

function scoreGame(
  game: GameEntry,
  preset: ModePreset,
  options: Required<Pick<RankingOptions, 'window' | 'now'>> & {
    enabledSources?: SourceId[];
  },
): RankedGame | null {
  const { window, now, enabledSources } = options;

  const relevant = game.evidence.filter(
    (record) =>
      record.window === window &&
      (enabledSources === undefined || enabledSources.includes(record.source)),
  );
  if (relevant.length === 0) return null;

  // Magnitude is inferred across *all* windows, not just the selected one —
  // that cross-window presence is the whole signal (KTD4).
  const magnitudes = threadMagnitudes(
    game.evidence.filter(
      (record) => enabledSources === undefined || enabledSources.includes(record.source),
    ),
  );

  let fusion = 0;
  let magnitudeTotal = 0;
  let engagementTotal = 0;
  const communities = new Set<string>();

  for (const record of relevant) {
    const magnitude = magnitudes.get(record.thread.id) ?? 1;
    const weightedMagnitude = magnitude ** preset.magnitudeWeight;

    // Thread count is deliberately not damped (D7): a genuinely viral thread is
    // allowed to dominate, because obscurity does the mainstream suppression.
    fusion += weightedMagnitude * (1 / (RRF_K + record.rankPosition));
    magnitudeTotal += magnitude;
    communities.add(record.community);

    const score = record.engagement?.score;
    const comments = record.engagement?.comments;
    if (typeof score === 'number') engagementTotal += Math.max(0, score);
    if (typeof comments === 'number') engagementTotal += comments;
  }

  const breadth = 1 + BREADTH_WEIGHT * Math.log1p(communities.size);
  // Absent engagement means "unknown", never zero — most sources expose none,
  // and a game must not be sunk for being discussed where scores are hidden.
  const engagement =
    engagementTotal > 0 ? 1 + preset.engagementWeight * Math.log1p(engagementTotal) / 10 : 1;

  const obscurity = obscurityMultiplier(game) ** preset.obscurityWeight;
  const decay = freshnessDecay(relevant, window, now);

  let momentum = 1;
  if (preset.momentumWeight > 0 && preset.momentum) {
    const ratio = momentumRatio(
      game.windowWeights[preset.momentum.recent],
      game.windowWeights[preset.momentum.historical],
    );
    // log1p keeps a maximum-rise game ahead without letting it dwarf everything.
    momentum = (1 + Math.log1p(ratio)) ** preset.momentumWeight;
  }

  const score = fusion * breadth * engagement * obscurity * decay * momentum;

  return {
    game,
    score,
    contributing: relevant,
    components: {
      fusion,
      breadth,
      engagement,
      magnitude: relevant.length > 0 ? magnitudeTotal / relevant.length : 0,
      obscurity,
      decay,
      momentum,
    },
  };
}

/**
 * Ranks games over a corpus. Pure: no fetch, no storage, no clock access beyond
 * the injected `now`, so the same input always produces the same output and the
 * function runs identically in a test, in the browser, and on a server (R29).
 */
export function rankGames(games: GameEntry[], options: RankingOptions): RankedGame[] {
  const preset = RANKING_MODES[options.mode];
  const now = options.now ?? Date.now();
  const dismissed = new Set(options.dismissedGameIds ?? []);

  const ranked: RankedGame[] = [];
  for (const game of games) {
    if (dismissed.has(game.id)) continue;
    const scored = scoreGame(game, preset, {
      window: options.window,
      now,
      ...(options.enabledSources !== undefined ? { enabledSources: options.enabledSources } : {}),
    });
    if (scored && scored.score > 0) ranked.push(scored);
  }

  // Ties break on id so the order is total and stable across runs.
  ranked.sort((a, b) => b.score - a.score || a.game.id.localeCompare(b.game.id));
  return ranked;
}
