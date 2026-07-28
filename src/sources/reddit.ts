import { XMLParser } from 'fast-xml-parser';
import type { RankingWindow, SourceItem } from '../corpus/schema.js';

/** Reddit caps a listing page at 100 entries; asking for more silently returns 100. */
export const REDDIT_PAGE_LIMIT = 100;

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
  sixMonths: 'year', // Reddit has no six-month window; the year listing is filtered by date.
  year: 'year',
};

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

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Entity decoding is done by decodeEntities below, not by the parser.
  // The parser aborts a document whose text nodes carry more than ~1000
  // entities, which a real full-size feed routinely exceeds, and its
  // entityExpansionLimit option does not lift that ceiling in v4. Decoding
  // here was redundant anyway: Reddit double-escapes HTML inside XML, so the
  // payload needs two decode passes regardless of what the parser does.
  processEntities: false,
  parseTagValue: false,
  trimValues: true,
});

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

/**
 * Reddit wraps post and comment bodies in escaped HTML. Extraction reads plain
 * prose, so markup and entities are resolved here rather than at each call site.
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

/**
 * An element carrying attributes (such as `<content type="html">`) is parsed as
 * an object with the text under `#text`, not as a bare string.
 */
function nodeText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    const text = (value as Record<string, unknown>)['#text'];
    if (text !== undefined && text !== null) return String(text);
  }
  return '';
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
}

export interface ListingResult {
  items: SourceItem[];
  communities: string[];
  /** Pass as `after` to fetch the next page, or null when the feed is exhausted. */
  nextCursor: string | null;
}

export function parseListingFeed(xml: string, options: ParseListingOptions): ListingResult {
  const { window, rankOffset = 0 } = options;
  const doc = parser.parse(xml) as { feed?: Record<string, unknown> };
  const feed = doc.feed ?? {};
  const fallbackCommunity = feedCommunity(feed);
  const entries = toArray(feed.entry as RawEntry | RawEntry[] | undefined);

  const items: SourceItem[] = [];
  const communities = new Set<string>();

  entries.forEach((entry, index) => {
    const id = typeof entry.id === 'string' ? entry.id : null;
    const permalink = entryHref(entry);
    const community = entryCommunity(entry, fallbackCommunity);
    if (!id || !permalink || !community) return;

    const title = decodeEntities(nodeText(entry.title));
    const body = htmlToText(nodeText(entry.content));

    communities.add(community);
    items.push({
      source: 'reddit',
      community,
      thread: { id, title, permalink },
      window,
      rankPosition: rankOffset + index,
      postedAt: normalizeTimestamp(entry),
      kind: 'post',
      parentThreadId: null,
      // Title first: a recommendation thread often names the game in its title only.
      text: body ? `${title}\n\n${body}` : title,
    });
  });

  return {
    items,
    communities: [...communities],
    nextCursor: items.length > 0 ? (items[items.length - 1]?.thread.id ?? null) : null,
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

const REJECTION_STATUSES = new Set([429, 503]);

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

  let lastRequestAt: number | null = null;

  async function pace(): Promise<void> {
    if (lastRequestAt === null) return;
    const elapsed = nowImpl() - lastRequestAt;
    if (elapsed < minIntervalMs) await sleepImpl(minIntervalMs - elapsed);
  }

  async function request(url: string): Promise<string> {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      await pace();
      lastRequestAt = nowImpl();

      const response = await fetchImpl(url, {
        headers: { 'user-agent': userAgent, accept: 'application/atom+xml' },
      });

      if (response.ok) return await response.text();

      if (REJECTION_STATUSES.has(response.status)) {
        if (attempt > maxRetries) throw new RedditRejectedError(response.status, attempt);
        // Exponential backoff. Rejection is expected traffic shaping, not an
        // exceptional condition, so it never propagates as a corpus failure.
        await sleepImpl(baseBackoffMs * 2 ** (attempt - 1));
        continue;
      }

      throw new Error(`Reddit request failed with HTTP ${response.status}: ${url}`);
    }
  }

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
      return parseListingFeed(xml, { window, rankOffset: opts.rankOffset ?? 0 });
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
