import type { RankingWindow } from '../corpus/schema.js';

/**
 * The seed community set the scheduled ingest sweeps.
 *
 * Every identifier here was verified reachable on 2026-07-28 by fetching it.
 * U12 owns the full curated and recommended lists spanning every top-level
 * genre in R21, along with the check that each identifier still resolves before
 * shipping; this list is deliberately limited to what has actually been
 * confirmed rather than assumed.
 */
const DEFAULT_REDDIT_COMMUNITIES = [
  'r/patientgamers',
  'r/gamingsuggestions',
  'r/ShouldIbuythisgame',
  'r/truegaming',
];

const DEFAULT_LEMMY_COMMUNITIES = ['games'];

const ALL_WINDOWS: RankingWindow[] = ['week', 'month', 'sixMonths', 'year'];

/**
 * A full sweep is paced to stay inside every source's rate limits and takes
 * the best part of an hour. These overrides let an operator scope a run —
 * proving the pipeline, or re-running a single source after an outage —
 * without editing the seed list.
 */
function fromEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : fallback;
}

export const REDDIT_COMMUNITIES = fromEnv('GRS_REDDIT_COMMUNITIES', DEFAULT_REDDIT_COMMUNITIES);

export const LEMMY_INSTANCE = process.env.GRS_LEMMY_INSTANCE ?? 'https://lemmy.world';

export const LEMMY_COMMUNITIES = fromEnv('GRS_LEMMY_COMMUNITIES', DEFAULT_LEMMY_COMMUNITIES);

/**
 * The windows every run sweeps. All four are fetched together so momentum can
 * be computed within the run as a recent-over-historical ratio (KTD12);
 * narrowing this makes momentum less meaningful and is for scoped runs only.
 */
export const INGEST_WINDOWS: RankingWindow[] = fromEnv(
  'GRS_WINDOWS',
  ALL_WINDOWS,
).filter((window): window is RankingWindow =>
  (ALL_WINDOWS as string[]).includes(window),
);
