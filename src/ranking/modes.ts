import type { RankingWindow } from '../corpus/schema.js';

/**
 * The v1 ranking modes (R18). Every mode is a parameter set over the single
 * scoring function in `score.ts` (R19) — there is no per-mode algorithm.
 */
export type RankingMode = 'hiddenGems' | 'top' | 'mostDiscussed' | 'breakout' | 'rising';

export interface ModePreset {
  /**
   * How strongly to demote widely-owned games. 1 is the default lens; 0
   * disables obscurity entirely and produces a faithful popularity ranking.
   */
  obscurityWeight: number;
  /** How much real engagement figures lift a game, where a source exposes them. */
  engagementWeight: number;
  /** How much a thread's inferred magnitude contributes. */
  magnitudeWeight: number;
  /** How strongly the recent-over-historical ratio contributes. */
  momentumWeight: number;
  /**
   * Which windows the momentum ratio compares. Ignored when momentumWeight is 0.
   */
  momentum?: { recent: RankingWindow; historical: RankingWindow };
}

export const RANKING_MODES: Record<RankingMode, ModePreset> = {
  /**
   * The default. The stated failure is never hearing about the good thing, so
   * obscurity carries full weight here rather than being an opt-in lens (D4).
   */
  hiddenGems: {
    obscurityWeight: 1,
    engagementWeight: 1,
    magnitudeWeight: 1,
    momentumWeight: 0,
  },

  /** A faithful popularity ranking: obscurity off, everything else unchanged. */
  top: {
    obscurityWeight: 0,
    engagementWeight: 1,
    magnitudeWeight: 1,
    momentumWeight: 0,
  },

  /** Volume of conversation, rather than how obscure the game is. */
  mostDiscussed: {
    obscurityWeight: 0,
    engagementWeight: 2.5,
    magnitudeWeight: 2,
    momentumWeight: 0,
  },

  /** Sharp recent spike against the long baseline. */
  breakout: {
    obscurityWeight: 0.35,
    engagementWeight: 1,
    magnitudeWeight: 1,
    momentumWeight: 2.5,
    momentum: { recent: 'week', historical: 'year' },
  },

  /** The gentler version of Breakout, over a longer recent window. */
  rising: {
    obscurityWeight: 0.35,
    engagementWeight: 1,
    magnitudeWeight: 1,
    momentumWeight: 1.25,
    momentum: { recent: 'month', historical: 'year' },
  },
};
