import { parseListingFeed } from '../src/sources/reddit.js';
import { parseLemmyListing, LEMMY_SORTS } from '../src/sources/lemmy.js';
import { RANKING_WINDOWS } from '../src/corpus/schema.js';
import type { RankingWindow, SourceItem } from '../src/corpus/schema.js';

/**
 * The on-demand path for a community the scheduled ingest has not swept yet
 * (R8, KTD7).
 *
 * The browser cannot fetch these sources directly — none of them send
 * cross-origin headers — so this handler owns the outbound request, its pacing,
 * and a short-lived cache. It returns parsed items rather than resolved game
 * mentions: the dictionary is a build artifact far too large to load and index
 * inside a per-invocation CPU budget measured in milliseconds, while the app
 * already holds a corpus full of canonical game names and can do that matching
 * itself. Nothing here is stored; the response is transient, exactly as the
 * post bodies are during a scheduled ingest (KTD11).
 */

/**
 * The only hosts this handler will ever talk to. The target URL is composed
 * here from a validated identifier — a caller-supplied URL is never fetched,
 * because a handler that will fetch what it is told is an open proxy into
 * whatever else shares its network.
 */
const SOURCE_HOSTS = {
  reddit: 'https://www.reddit.com',
  lemmy: 'https://lemmy.world',
} as const;

export type AdhocSource = keyof typeof SOURCE_HOSTS;

/**
 * Deliberately stricter than the sources themselves would accept. Anything with
 * a scheme, host, slash, dot, percent-escape or whitespace fails here, before
 * any URL is composed.
 */
const REDDIT_NAME = /^[A-Za-z0-9_]{2,21}$/;
const LEMMY_NAME = /^[a-z0-9_]{2,50}$/;

/** How long a fetched community stays warm. Long enough to absorb a retry. */
export const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Entries parsed per request. A full Reddit page is 100; the ceiling exists so
 * an unusually large feed degrades into fewer entries rather than exhausting
 * the invocation's CPU budget and failing outright.
 */
export const MAX_ENTRIES = 100;

/** Minimum spacing between outbound requests from one isolate. */
const MIN_INTERVAL_MS = 1_000;

export class InvalidCommunityError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidCommunityError';
  }
}

export interface ResolvedTarget {
  source: AdhocSource;
  community: string;
  url: string;
}

/**
 * Validates a reader-supplied identifier and composes the URL to fetch.
 *
 * Throws rather than returning a partial result, so there is no path where an
 * unvalidated identifier reaches a fetch.
 */
export function resolveTarget(
  source: string,
  community: string,
  window: RankingWindow,
): ResolvedTarget {
  if (!Object.prototype.hasOwnProperty.call(SOURCE_HOSTS, source)) {
    throw new InvalidCommunityError(`Unknown source ${JSON.stringify(source)}`);
  }
  const typed = source as AdhocSource;
  const host = SOURCE_HOSTS[typed];

  if (typed === 'reddit') {
    // Accept `r/name` or a bare name; nothing else, and never a URL.
    const name = community.startsWith('r/') ? community.slice(2) : community;
    if (!REDDIT_NAME.test(name)) {
      throw new InvalidCommunityError(`Invalid Reddit community ${JSON.stringify(community)}`);
    }
    const params = new URLSearchParams({
      t: window === 'sixMonths' ? 'year' : window,
      limit: String(MAX_ENTRIES),
    });
    return { source: typed, community: `r/${name}`, url: `${host}/r/${name}/top/.rss?${params}` };
  }

  const name = community.startsWith('c/') ? community.slice(2) : community;
  if (!LEMMY_NAME.test(name)) {
    throw new InvalidCommunityError(`Invalid Lemmy community ${JSON.stringify(community)}`);
  }
  const params = new URLSearchParams({
    community_name: name,
    sort: LEMMY_SORTS[window],
    limit: '50',
  });
  return { source: typed, community: name, url: `${host}/api/v3/post/list?${params}` };
}

export interface AdhocResult {
  source: AdhocSource;
  community: string;
  window: RankingWindow;
  items: SourceItem[];
  /** True when the feed carried more entries than the ceiling allows. */
  truncated: boolean;
  /** Whether this response came from the short-lived cache. */
  cached: boolean;
}

export interface CacheStore {
  get(key: string): { at: number; value: AdhocResult } | undefined;
  set(key: string, entry: { at: number; value: AdhocResult }): void;
}

export function memoryCache(): CacheStore {
  const entries = new Map<string, { at: number; value: AdhocResult }>();
  return {
    get: (key) => entries.get(key),
    set: (key, entry) => {
      entries.set(key, entry);
    },
  };
}

export interface AdhocDeps {
  fetchImpl?: typeof fetch;
  cache?: CacheStore;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
}

/** Distinguishes "that community does not exist" from "it exists and is quiet". */
export class CommunityNotFoundError extends Error {
  constructor(community: string) {
    super(`No community found for ${JSON.stringify(community)}`);
    this.name = 'CommunityNotFoundError';
  }
}

const sharedCache = memoryCache();
let lastRequestAt: number | null = null;

export async function fetchCommunity(
  source: string,
  community: string,
  window: RankingWindow,
  deps: AdhocDeps = {},
): Promise<AdhocResult> {
  const {
    fetchImpl = fetch,
    cache = sharedCache,
    now = () => Date.now(),
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    userAgent = 'GameRankScout/0.1 (+https://github.com/qgauvrit/GameRankScout)',
  } = deps;

  const target = resolveTarget(source, community, window);
  const key = `${target.source}:${target.community}:${window}`;

  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_TTL_MS) {
    return { ...hit.value, cached: true };
  }

  if (lastRequestAt !== null) {
    const elapsed = now() - lastRequestAt;
    if (elapsed < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - elapsed);
  }
  lastRequestAt = now();

  const response = await fetchImpl(target.url, {
    headers: {
      'user-agent': userAgent,
      accept: target.source === 'reddit' ? 'application/atom+xml' : 'application/json',
    },
  });

  if (response.status === 404) throw new CommunityNotFoundError(community);
  if (!response.ok) {
    throw new Error(`${target.source} request failed with HTTP ${response.status}`);
  }

  const body = await response.text();
  const parsed =
    target.source === 'reddit'
      ? parseListingFeed(body, { window }).items
      : parseLemmyListing(body, { window, instance: SOURCE_HOSTS.lemmy });

  // A feed that parses to nothing at all is how a non-existent community
  // presents on these sources — reachable, well-formed, and empty. Reporting
  // that as a successful fetch of zero games would be indistinguishable from a
  // real but quiet community, so it is called what it is.
  if (parsed.length === 0) throw new CommunityNotFoundError(community);

  const result: AdhocResult = {
    source: target.source,
    community: target.community,
    window,
    items: parsed.slice(0, MAX_ENTRIES),
    truncated: parsed.length > MAX_ENTRIES,
    cached: false,
  };

  cache.set(key, { at: now(), value: result });
  return result;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // The app is the only caller, but it is served from a different origin
      // than this function, so the response has to say so.
      'access-control-allow-origin': '*',
      'cache-control': `public, max-age=${Math.floor(CACHE_TTL_MS / 1000)}`,
    },
  });
}

function isRankingWindow(value: string | null): value is RankingWindow {
  return value !== null && (RANKING_WINDOWS as readonly string[]).includes(value);
}

/** The HTTP surface. Kept thin so the logic above stays testable without one. */
export async function handleRequest(request: Request, deps: AdhocDeps = {}): Promise<Response> {
  const url = new URL(request.url);
  const source = url.searchParams.get('source') ?? 'reddit';
  const community = url.searchParams.get('community') ?? '';
  const windowParam = url.searchParams.get('window') ?? 'week';

  if (!isRankingWindow(windowParam)) {
    return json({ error: 'invalid_window', window: windowParam }, 400);
  }

  try {
    const result = await fetchCommunity(source, community, windowParam, deps);
    return json(result, 200);
  } catch (error) {
    if (error instanceof InvalidCommunityError) {
      return json({ error: 'invalid_community', detail: error.message }, 400);
    }
    if (error instanceof CommunityNotFoundError) {
      return json({ error: 'not_found', community }, 404);
    }
    return json({ error: 'upstream_failed' }, 502);
  }
}

export default {
  fetch: (request: Request) => handleRequest(request),
};
