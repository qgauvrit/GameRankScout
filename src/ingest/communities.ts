import { CURATED_COMMUNITIES } from '../communities/catalogue.js';
import type { RankingWindow } from '../corpus/schema.js';

/**
 * The community set the scheduled ingest sweeps.
 *
 * Drawn from the curated tier of the shared catalogue, so the communities the
 * app shows as on-by-default are exactly the ones the ingest actually visits —
 * a reader looking at an enabled community that no run ever swept would be
 * reading a lie. Each identifier is checked against the live source by
 * `npm run verify:communities`.
 */
const DEFAULT_REDDIT_COMMUNITIES = CURATED_COMMUNITIES.filter(
  (community) => community.source === 'reddit',
).map((community) => community.id);

const DEFAULT_LEMMY_COMMUNITIES = CURATED_COMMUNITIES.filter(
  (community) => community.source === 'lemmy',
).map((community) => community.id);

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
