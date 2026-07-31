import { createFeedParser, decodeEntities, nodeText, toArray } from './xml.js';
import { createPacedFetch } from './pacing.js';
import type { RankingWindow, SourceItem } from '../corpus/schema.js';

/** Reddit caps a listing page at 100 entries; asking for more silently returns 100. */
export const REDDIT_PAGE_LIMIT = 100;

const parser = createFeedParser();

const REDDIT_ORIGIN = 'https://www.reddit.com';

/**
 * A community identifier as GRS accepts it: `r/name`, or `r/a+b` for the
 * multi-community form. Deliberately strict — this value is interpolated into
 * an outbound URL, so anything carrying a scheme, separator, traversal segment
 * or percent-encoding must be rejected before a request is composed.
 */
const COMMUNITY_PATTERN = /^r\/[A-Za-z0-9_]{2,21}(?:\+[A-Za-z0-9_]{2,21})*$/;

/** Reddit's time-window tokens, keyed by the windows the corpus ranks over. */
const WINDOW_TOKENS: Record<RankingWindow, string> = {
  week: 'week',
  month: 'month',
  sixMonths: 'year', // No six-month listing exists; see windowCutoff.
  year: 'year',
};

const SIX_MONTHS_MS = 182 * 24 * 60 * 60 * 1000;

/**
 * How far back a window reaches, for windows Reddit does not offer natively.
 *
 * Only `sixMonths` needs one: Reddit's tokens jump from month to year, so the
 * six-month window is synthesized by fetching the year listing and dropping
 * everything older. Without that cutoff the two windows returned byte-identical
 * results, and because thread magnitude is inferred from how many windows a
 * thread appears in (KTD4), every thread older than a month scored as if it had
 * twice the reach it does.
 */
export function windowCutoff(window: RankingWindow, now: number): number | null {
  return window === 'sixMonths' ? now - SIX_MONTHS_MS : null;
}

/** The source rejected the request — rate limiting, not a malformed one. */
export class RedditRejectedError extends Error {
  readonly status: number;
  readonly attempts: number;

  constructor(status: number, attempts: number) {
    super(`Reddit rejected the request with ${status} after ${attempts} attempt(s)`);
    this.name = 'RedditRejectedError';
    this.status = status;
    this.attempts = attempts;
  }
}

export function assertValidCommunity(community: string): void {
  if (!COMMUNITY_PATTERN.test(community)) {
    throw new Error(
      `Invalid Reddit community identifier: ${JSON.stringify(community)}. ` +
        'Expected the form "r/name" using letters, digits and underscores.',
    );
  }
}


/**
 * Reddit-specific: post bodies arrive as HTML escaped inside XML, so the text
 * needs two decode passes with the markup stripped between them.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    decodeEntities(html)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t\u00A0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface RawEntry {
  id?: unknown;
  title?: unknown;
  content?: unknown;
  published?: unknown;
  updated?: unknown;
  link?: { '@_href'?: unknown } | Array<{ '@_href'?: unknown }>;
  category?: { '@_term'?: unknown; '@_label'?: unknown };
}

function entryCommunity(entry: RawEntry, fallback: string | null): string | null {
  const label = entry.category?.['@_label'];
  if (typeof label === 'string' && label.startsWith('r/')) return label;
  const term = entry.category?.['@_term'];
  if (typeof term === 'string' && term && term !== 'multi') return `r/${term}`;
  return fallback;
}

function entryHref(entry: RawEntry): string | null {
  const link = Array.isArray(entry.link) ? entry.link[0] : entry.link;
  const href = link?.['@_href'];
  return typeof href === 'string' ? href : null;
}

function feedCommunity(feed: Record<string, unknown>): string | null {
  const category = feed.category as { '@_label'?: unknown; '@_term'?: unknown } | undefined;
  const label = category?.['@_label'];
  if (typeof label === 'string' && label.startsWith('r/')) return label;
  const term = category?.['@_term'];
  if (typeof term === 'string' && term && term !== 'multi') return `r/${term}`;
  return null;
}

function normalizeTimestamp(entry: RawEntry): string {
  const raw = entry.published ?? entry.updated;
  const parsed = typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
  return Number.isNaN(parsed) ? new Date(0).toISOString() : new Date(parsed).toISOString();
}

export interface ParseListingOptions {
  window: RankingWindow;
  /** Rank positions continue from here, so deep pages keep a global ordering. */
  rankOffset?: number;
  /**
   * Drop entries posted before this epoch, so a window Reddit does not offer
   * can be synthesized from the next widest one it does.
   */
  notBefore?: number;
}

export interface ListingResult {
  items: SourceItem[];
  communities: string[];
  /** Pass as `after` to fetch the next page, or null when the feed is exhausted. */
  nextCursor: string | null;
}

export function parseListingFeed(xml: string, options: ParseListingOptions): ListingResult {
  const { window, rankOffset = 0, notBefore } = options;
  const doc = parser.parse(xml) as { feed?: Record<string, unknown> };
  const feed = doc.feed ?? {};
  const fallbackCommunity = feedCommunity(feed);
  const entries = toArray(feed.entry as RawEntry | RawEntry[] | undefined);

  const items: SourceItem[] = [];
  const communities = new Set<string>();
  /**
   * The cursor must be the last entry Reddit actually returned, not the last
   * one kept — paging from a filtered-out entry would re-request the tail we
   * just dropped, forever.
   */
  let lastSeenId: string | null = null;

  for (const entry of entries) {
    const id = typeof entry.id === 'string' ? entry.id : null;
    const permalink = entryHref(entry);
    const community = entryCommunity(entry, fallbackCommunity);
    if (!id || !permalink || !community) continue;

    lastSeenId = id;

    const postedAt = normalizeTimestamp(entry);
    if (notBefore !== undefined && Date.parse(postedAt) < notBefore) continue;

    const title = decodeEntities(nodeText(entry.title));
    const body = htmlToText(nodeText(entry.content));

    communities.add(community);
    items.push({
      source: 'reddit',
      community,
      thread: { id, title, permalink },
      window,
      // Position among the entries that survived the cutoff: this is a
      // synthesized listing, so rank is where the entry sits in *it*.
      rankPosition: rankOffset + items.length,
      postedAt,
      kind: 'post',
      parentThreadId: null,
      // Title first: a recommendation thread often names the game in its title only.
      text: body ? `${title}\n\n${body}` : title,
    });
  }

  return {
    items,
    communities: [...communities],
    nextCursor: lastSeenId,
  };
}

export interface CommentResult {
  items: SourceItem[];
  community: string | null;
  threadId: string | null;
}

export function parseCommentFeed(
  xml: string,
  options: { window: RankingWindow },
): CommentResult {
  const doc = parser.parse(xml) as { feed?: Record<string, unknown> };
  const feed = doc.feed ?? {};
  const fallbackCommunity = feedCommunity(feed);
  const entries = toArray(feed.entry as RawEntry | RawEntry[] | undefined);

  // The post this feed belongs to, taken from the feed id so comments can be
  // attributed even when the post entry itself is absent from the page.
  const feedId = typeof feed.id === 'string' ? feed.id : '';
  const fromFeedId = /\/comments\/([a-z0-9]+)/i.exec(feedId)?.[1];
  const threadId = fromFeedId ? `t3_${fromFeedId}` : null;

  const items: SourceItem[] = [];

  entries.forEach((entry, index) => {
    const id = typeof entry.id === 'string' ? entry.id : null;
    const permalink = entryHref(entry);
    const community = entryCommunity(entry, fallbackCommunity);
    if (!id || !permalink || !community) return;

    const isComment = id.startsWith('t1_');
    const title = decodeEntities(nodeText(entry.title));
    const body = htmlToText(nodeText(entry.content));

    items.push({
      source: 'reddit',
      community,
      thread: { id, title, permalink },
      window: options.window,
      rankPosition: index,
      postedAt: normalizeTimestamp(entry),
      kind: isComment ? 'comment' : 'post',
      parentThreadId: isComment ? threadId : null,
      text: isComment ? body : body ? `${title}\n\n${body}` : title,
    });
  });

  return { items, community: fallbackCommunity, threadId };
}

export interface RedditClientOptions {
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  nowImpl?: () => number;
  /**
   * Minimum spacing between requests. Reddit rejected at 25s spacing during
   * plan research, so the default is deliberately slower than that.
   */
  minIntervalMs?: number;
  baseBackoffMs?: number;
  maxRetries?: number;
  userAgent?: string;
}


export function createRedditClient(options: RedditClientOptions = {}) {
  const {
    fetchImpl = fetch,
    sleepImpl = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    nowImpl = () => Date.now(),
    minIntervalMs = 30_000,
    baseBackoffMs = 2_000,
    maxRetries = 4,
    userAgent = 'GameRankScout/0.1 (+https://github.com/qgauvrit/GameRankScout)',
  } = options;

  const request = createPacedFetch({
    source: 'Reddit',
    fetchImpl,
    sleepImpl,
    nowImpl,
    minIntervalMs,
    baseBackoffMs,
    maxRetries,
    headers: { 'user-agent': userAgent, accept: 'application/atom+xml' },
    // Reddit's own error type is part of this module's published surface.
    onRejected: (status, attempts) => new RedditRejectedError(status, attempts),
  });

  return {
    async fetchListing(
      community: string,
      window: RankingWindow,
      opts: { after?: string; rankOffset?: number } = {},
    ): Promise<ListingResult> {
      assertValidCommunity(community);
      const params = new URLSearchParams({
        t: WINDOW_TOKENS[window],
        limit: String(REDDIT_PAGE_LIMIT),
      });
      if (opts.after) params.set('after', opts.after);
      const xml = await request(`${REDDIT_ORIGIN}/${community}/top/.rss?${params.toString()}`);
      const cutoff = windowCutoff(window, nowImpl());
      return parseListingFeed(xml, {
        window,
        rankOffset: opts.rankOffset ?? 0,
        ...(cutoff !== null ? { notBefore: cutoff } : {}),
      });
    },

    async fetchComments(
      community: string,
      postId: string,
      window: RankingWindow,
    ): Promise<CommentResult> {
      assertValidCommunity(community);
      const bare = postId.replace(/^t3_/, '');
      if (!/^[a-z0-9]+$/i.test(bare)) {
        throw new Error(`Invalid Reddit post id: ${JSON.stringify(postId)}`);
      }
      const xml = await request(
        `${REDDIT_ORIGIN}/${community}/comments/${bare}/.rss?limit=${REDDIT_PAGE_LIMIT}`,
      );
      return parseCommentFeed(xml, { window });
    },
  };
}
