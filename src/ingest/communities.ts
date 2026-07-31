import { COMMUNITY_CATALOGUE } from '../communities/catalogue.js';
import type { RankingWindow } from '../corpus/schema.js';

/**
 * The community set the scheduled ingest sweeps: the whole catalogue, both
 * tiers.
 *
 * The recommended tier is opt-in *for the reader*, not for the ingest. Reader
 * opt-ins live in browser storage, which a scheduled server job cannot see — so
 * sweeping only what someone has opted into is not a thing this architecture
 * can do. Sweeping everything and letting the app filter is both simpler and
 * better: switching a recommended community on takes effect immediately against
 * the corpus already loaded, rather than after the next run. It is the same
 * shape as every other reader control (KTD1).
 *
 * The cost is run length, which is why the workflow's timeout has the headroom
 * it does. Each identifier is checked against the live source by
 * `npm run verify:communities`.
 */
const DEFAULT_REDDIT_COMMUNITIES = COMMUNITY_CATALOGUE.filter(
  (community) => community.source === 'reddit',
).map((community) => community.id);

const DEFAULT_LEMMY_COMMUNITIES = COMMUNITY_CATALOGUE.filter(
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
