import type { RankingWindow, SourceItem } from '../corpus/schema.js';

/**
 * Lemmy is the only community source that exposes real engagement figures, so
 * it is the only one whose items carry a score and comment count.
 */
export const LEMMY_SORTS: Record<RankingWindow, string> = {
  week: 'TopWeek',
  month: 'TopMonth',
  sixMonths: 'TopSixMonths',
  year: 'TopYear',
};

/** Community slugs are interpolated into an outbound URL, so they are constrained. */
const COMMUNITY_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

export function assertValidLemmyCommunity(community: string): void {
  if (!COMMUNITY_PATTERN.test(community)) {
    throw new Error(
      `Invalid Lemmy community name: ${JSON.stringify(community)}. ` +
        'Expected a bare slug using letters, digits and underscores.',
    );
  }
}

function assertValidInstance(instance: string): URL {
  let url: URL;
  try {
    url = new URL(instance);
  } catch {
    throw new Error(`Invalid Lemmy instance: ${JSON.stringify(instance)}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Invalid Lemmy instance protocol: ${JSON.stringify(instance)}`);
  }
  return url;
}

interface RawLemmyPost {
  post?: {
    id?: unknown;
    name?: unknown;
    body?: unknown;
    published?: unknown;
    removed?: unknown;
    deleted?: unknown;
  };
  community?: { name?: unknown; actor_id?: unknown };
  counts?: { score?: unknown; comments?: unknown };
}

/**
 * `actor_id` is the federated canonical URL, e.g. `https://lemmy.world/c/games`.
 * Reducing it to `host/c/slug` keeps the community name stable and readable
 * while staying distinct across instances.
 */
function communityName(entry: RawLemmyPost, instanceHost: string): string | null {
  const actor = entry.community?.actor_id;
  if (typeof actor === 'string') {
    try {
      const url = new URL(actor);
      return `${url.host}${url.pathname}`.replace(/\/$/, '');
    } catch {
      /* fall through to the slug form */
    }
  }
  const name = entry.community?.name;
  return typeof name === 'string' && name ? `${instanceHost}/c/${name}` : null;
}

export interface ParseLemmyOptions {
  window: RankingWindow;
  /** The instance the listing was fetched from; permalinks resolve against it. */
  instance: string;
}

export function parseLemmyListing(json: string, options: ParseLemmyOptions): SourceItem[] {
  const instanceUrl = assertValidInstance(options.instance);

  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `Lemmy payload is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const posts = (payload as { posts?: unknown })?.posts;
  if (!Array.isArray(posts)) {
    throw new Error('Lemmy payload is missing a posts array');
  }

  return (posts as RawLemmyPost[])
    .filter((entry) => entry.post?.removed !== true && entry.post?.deleted !== true)
    .flatMap((entry): SourceItem[] => {
      const id = entry.post?.id;
      const name = entry.post?.name;
      const community = communityName(entry, instanceUrl.host);
      if (typeof id !== 'number' || typeof name !== 'string' || !community) return [];

      const published = entry.post?.published;
      const parsed = typeof published === 'string' ? Date.parse(published) : Number.NaN;
      const body = typeof entry.post?.body === 'string' ? entry.post.body : '';
      const score = entry.counts?.score;
      const comments = entry.counts?.comments;

      return [
        {
          source: 'lemmy',
          community,
          thread: {
            id: String(id),
            title: name,
            // Link to the queried instance rather than the federated origin, so
            // the link resolves even when the origin instance is unreachable.
            permalink: `${instanceUrl.origin}/post/${id}`,
          },
          window: options.window,
          rankPosition: 0, // replaced below, after removed posts are dropped
          postedAt: new Date(Number.isNaN(parsed) ? 0 : parsed).toISOString(),
          kind: 'post',
          parentThreadId: null,
          text: body ? `${name}\n\n${body}` : name,
          engagement: {
            ...(typeof score === 'number' ? { score } : {}),
            ...(typeof comments === 'number' ? { comments } : {}),
          },
        },
      ];
    })
    .map((item, index) => ({ ...item, rankPosition: index }));
}

export interface LemmyClientOptions {
  instance: string;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  nowImpl?: () => number;
  minIntervalMs?: number;
  limit?: number;
  userAgent?: string;
}

export function createLemmyClient(options: LemmyClientOptions) {
  const instanceUrl = assertValidInstance(options.instance);
  const {
    fetchImpl = fetch,
    sleepImpl = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    nowImpl = () => Date.now(),
    minIntervalMs = 2_000,
    limit = 50,
    userAgent = 'GameRankScout/0.1 (+https://github.com/qgauvrit/GameRankScout)',
  } = options;

  let lastRequestAt: number | null = null;

  return {
    async fetchListing(community: string, window: RankingWindow): Promise<SourceItem[]> {
      assertValidLemmyCommunity(community);

      if (lastRequestAt !== null) {
        const elapsed = nowImpl() - lastRequestAt;
        if (elapsed < minIntervalMs) await sleepImpl(minIntervalMs - elapsed);
      }
      lastRequestAt = nowImpl();

      const params = new URLSearchParams({
        community_name: community,
        sort: LEMMY_SORTS[window],
        limit: String(limit),
      });
      const response = await fetchImpl(`${instanceUrl.origin}/api/v3/post/list?${params}`, {
        headers: { 'user-agent': userAgent, accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Lemmy request failed with HTTP ${response.status}`);
      }
      return parseLemmyListing(await response.text(), {
        window,
        instance: instanceUrl.origin,
      });
    },
  };
}
