/**
 * Checks that every identifier in the community catalogue still resolves.
 *
 * This is a script and not a test on purpose: no test may reach a live source
 * (KTD8), and a suite that fails because Reddit is having a bad afternoon is a
 * suite people learn to ignore. Run it before shipping a catalogue change.
 *
 *   npm run verify:communities              # everything
 *   npm run verify:communities -- curated   # just the defaults
 *
 * A curated identifier that does not resolve exits non-zero, because a default
 * community that returns nothing is a genre filter that looks broken on a cold
 * open. A recommended one only warns.
 */
import { COMMUNITY_CATALOGUE, CURATED_COMMUNITIES } from '../src/communities/catalogue.js';
import { createRedditClient } from '../src/sources/reddit.js';
import { createLemmyClient } from '../src/sources/lemmy.js';
import { LEMMY_INSTANCE } from '../src/ingest/communities.js';
import type { CommunityRef } from '../src/communities/catalogue.js';

/**
 * The same spacing the ingest uses. Trying to go faster was measured, not
 * assumed: at 8s Reddit rejected almost exactly every second request, which
 * turns a check into a coin toss — a rejection reads as "this community is
 * gone" when it only means "you asked too quickly". A slow, trustworthy answer
 * is the only kind worth having here.
 */
const VERIFY_INTERVAL_MS = Number(process.env.GRS_VERIFY_INTERVAL_MS ?? 30_000);

/** No source gets to hang the check indefinitely. */
const REQUEST_TIMEOUT_MS = 20_000;

interface Outcome {
  community: CommunityRef;
  ok: boolean;
  detail: string;
}

async function check(
  community: CommunityRef,
  reddit: ReturnType<typeof createRedditClient>,
  lemmy: ReturnType<typeof createLemmyClient>,
): Promise<Outcome> {
  try {
    if (community.source === 'reddit') {
      const { items } = await reddit.fetchListing(community.id, 'year');
      return {
        community,
        // A feed that parses but carries nothing is the multireddit failure mode:
        // reachable and useless, which is worse than an error because it looks fine.
        ok: items.length > 0,
        detail: items.length > 0 ? `${items.length} entries` : 'reachable but empty',
      };
    }
    const items = await lemmy.fetchListing(community.id, 'year');
    return {
      community,
      ok: items.length > 0,
      detail: items.length > 0 ? `${items.length} entries` : 'reachable but empty',
    };
  } catch (error) {
    return { community, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const only = process.argv[2];
  const targets =
    only === 'curated'
      ? CURATED_COMMUNITIES
      : only === undefined
        ? COMMUNITY_CATALOGUE
        : COMMUNITY_CATALOGUE.filter((community) => community.tier === only);

  if (targets.length === 0) {
    console.error(`No communities matched ${JSON.stringify(only)}.`);
    process.exitCode = 1;
    return;
  }

  const timedFetch: typeof fetch = (input, init) =>
    fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

  const reddit = createRedditClient({
    minIntervalMs: VERIFY_INTERVAL_MS,
    fetchImpl: timedFetch,
  });
  const lemmy = createLemmyClient({ instance: LEMMY_INSTANCE, fetchImpl: timedFetch });

  console.log(`Checking ${targets.length} communities at ${VERIFY_INTERVAL_MS}ms spacing…\n`);

  const outcomes: Outcome[] = [];
  for (const community of targets) {
    const outcome = await check(community, reddit, lemmy);
    outcomes.push(outcome);
    console.log(
      `${outcome.ok ? 'ok  ' : 'FAIL'}  ${community.tier.padEnd(11)} ${community.id.padEnd(24)} ${outcome.detail}`,
    );
  }

  const failedCurated = outcomes.filter((o) => !o.ok && o.community.tier === 'curated');
  const failedRecommended = outcomes.filter((o) => !o.ok && o.community.tier === 'recommended');

  console.log(
    `\n${outcomes.length - failedCurated.length - failedRecommended.length}/${outcomes.length} resolved.`,
  );

  if (failedRecommended.length > 0) {
    console.warn(
      `Recommended communities that did not resolve: ${failedRecommended
        .map((o) => o.community.id)
        .join(', ')}`,
    );
  }

  if (failedCurated.length > 0) {
    console.error(
      `\nCurated communities that did not resolve: ${failedCurated
        .map((o) => o.community.id)
        .join(', ')}`,
    );
    console.error('These are on by default, so a reader would see them contribute nothing.');
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
