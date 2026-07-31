import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  parseListingFeed,
  parseCommentFeed,
  createRedditClient,
  windowCutoff,
  RedditRejectedError,
  REDDIT_PAGE_LIMIT,
} from './reddit.js';
import { sourceItemSchema } from '../corpus/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(resolve(here, '../../test/fixtures/reddit', name), 'utf8');

describe('reddit listing feed', () => {
  it('yields one item per entry, each carrying its rank position in feed order', () => {
    const { items } = parseListingFeed(fixture('top-year.xml'), { window: 'year' });

    expect(items.length).toBeGreaterThan(0);
    expect(items.map((i) => i.rankPosition)).toEqual(items.map((_, index) => index));
    for (const item of items) {
      expect(() => sourceItemSchema.parse(item)).not.toThrow();
      expect(item.source).toBe('reddit');
      expect(item.window).toBe('year');
      expect(item.kind).toBe('post');
    }
  });

  it('carries no engagement figures, since Reddit RSS exposes no score', () => {
    const { items } = parseListingFeed(fixture('top-year.xml'), { window: 'year' });

    for (const item of items) {
      expect(item.engagement).toBeUndefined();
    }
  });

  it('reads the community from each entry rather than assuming one per feed', () => {
    const { items, communities } = parseListingFeed(fixture('multireddit.xml'), {
      window: 'week',
    });

    // A multi-community feed interleaves entries, so per-entry attribution is
    // the only correct source of the community name.
    expect(communities.length).toBeGreaterThan(1);
    expect(new Set(items.map((i) => i.community)).size).toBeGreaterThan(1);
    for (const item of items) {
      expect(item.community).toMatch(/^r\//);
    }
  });

  it('produces records from a deep page that do not duplicate the first page', () => {
    const first = parseListingFeed(fixture('top-year.xml'), { window: 'year' });
    const second = parseListingFeed(fixture('top-year-page2.xml'), { window: 'year' });

    const firstIds = new Set(first.items.map((i) => i.thread.id));
    const overlap = second.items.filter((i) => firstIds.has(i.thread.id));

    expect(second.items.length).toBeGreaterThan(0);
    expect(overlap).toEqual([]);
  });

  it('reports the cursor needed to fetch the next page', () => {
    const { items, nextCursor } = parseListingFeed(fixture('top-year.xml'), { window: 'year' });

    // `after` is the last fullname seen; `count` is only a display offset and
    // does not advance the cursor.
    expect(nextCursor).toBe(items[items.length - 1]?.thread.id);
  });

  it('continues rank positions across pages when a starting offset is given', () => {
    const { items } = parseListingFeed(fixture('top-year-page2.xml'), {
      window: 'year',
      rankOffset: REDDIT_PAGE_LIMIT,
    });

    expect(items[0]?.rankPosition).toBe(REDDIT_PAGE_LIMIT);
  });

  it('parses a feed whose text nodes exceed the parser default entity limit', () => {
    // A real full-size feed carries well over 1000 entities in a single post
    // body. The parser aborts the whole document at that point, so this
    // reproduces the density (not the content) of a real payload.
    const body = '&lt;p&gt;It&amp;#39;s good&lt;/p&gt;'.repeat(300);
    const bulk =
      `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">` +
      `<category term="patientgamers" label="r/patientgamers"/><id>/r/patientgamers/top/.rss</id>` +
      `<entry><category term="patientgamers" label="r/patientgamers"/>` +
      `<content type="html">${body}</content><id>t3_dense</id>` +
      `<link href="https://www.reddit.com/r/patientgamers/comments/dense/" />` +
      `<published>2026-02-05T15:05:07+00:00</published>` +
      // Titles are single-escaped in real feeds; only bodies are double-escaped.
      `<title>Dense &#39;thread&#39; &amp; more</title></entry></feed>`;

    const { items } = parseListingFeed(bulk, { window: 'year' });

    expect(items).toHaveLength(1);
    expect(items[0]?.text).toContain("It's good");
    // Entities in the title are decoded too, now that the parser leaves them alone.
    expect(items[0]?.thread.title).toBe("Dense 'thread' & more");
  });

  it('returns no items and no cursor for a feed containing no entries', () => {
    const empty = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>top scoring links : nothing</title><id>/r/nothing/top/.rss</id></feed>`;

    const { items, nextCursor } = parseListingFeed(empty, { window: 'week' });

    expect(items).toEqual([]);
    expect(nextCursor).toBeNull();
  });
});

describe('reddit comment feed', () => {
  it('yields comment text suitable for extraction', () => {
    const { items } = parseCommentFeed(fixture('comments.xml'), { window: 'year' });

    const comments = items.filter((i) => i.kind === 'comment');
    expect(comments.length).toBeGreaterThan(0);
    for (const comment of comments) {
      expect(comment.text.length).toBeGreaterThan(0);
      // Entities and markup must be resolved to plain text, or the extractor
      // would be matching against `&amp;#39;` and `&lt;p&gt;`.
      expect(comment.text).not.toMatch(/&(amp|lt|gt|quot|#39);/);
      expect(comment.text).not.toMatch(/<\/?(p|div|strong|em)>/);
      expect(comment.parentThreadId).toBe('t3_1qwnnlz');
    }
  });

  it('distinguishes the originating post from its comments', () => {
    const { items } = parseCommentFeed(fixture('comments.xml'), { window: 'year' });

    const posts = items.filter((i) => i.kind === 'post');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.thread.id).toBe('t3_1qwnnlz');
    expect(posts[0]?.parentThreadId).toBeNull();
  });

  it('preserves text that mentions a game so extraction has something to find', () => {
    const { items } = parseCommentFeed(fixture('comments.xml'), { window: 'year' });

    expect(items.some((i) => i.text.includes('Tunic'))).toBe(true);
  });
});

describe('reddit client pacing and rejection', () => {
  function stubClock() {
    let now = 0;
    const waits: number[] = [];
    return {
      now: () => now,
      sleep: async (ms: number) => {
        waits.push(ms);
        now += ms;
      },
      waits,
    };
  }

  it('backs off and retries when a request is rejected, then succeeds', async () => {
    const clock = stubClock();
    const responses = [
      { status: 429, body: '' },
      { status: 429, body: '' },
      { status: 200, body: fixture('top-year.xml') },
    ];
    let calls = 0;
    const client = createRedditClient({
      fetchImpl: async () => {
        const next = responses[calls] ?? responses[responses.length - 1]!;
        calls += 1;
        return new Response(next.body, { status: next.status });
      },
      sleepImpl: clock.sleep,
      nowImpl: clock.now,
      minIntervalMs: 1000,
    });

    const result = await client.fetchListing('r/patientgamers', 'year');

    expect(calls).toBe(3);
    expect(result.items.length).toBeGreaterThan(0);
    // Backoff must grow, not retry at a fixed interval.
    const backoffs = clock.waits.filter((w) => w > 1000);
    expect(backoffs.length).toBeGreaterThanOrEqual(2);
    expect(backoffs[1]).toBeGreaterThan(backoffs[0]!);
  });

  it('surfaces a persistent rejection as a source-level error, not a corpus failure', async () => {
    const clock = stubClock();
    const client = createRedditClient({
      fetchImpl: async () => new Response('', { status: 429 }),
      sleepImpl: clock.sleep,
      nowImpl: clock.now,
      maxRetries: 2,
    });

    await expect(client.fetchListing('r/patientgamers', 'year')).rejects.toBeInstanceOf(
      RedditRejectedError,
    );
  });

  it('paces consecutive requests to at least the configured interval', async () => {
    const clock = stubClock();
    const client = createRedditClient({
      fetchImpl: async () => new Response(fixture('top-year.xml'), { status: 200 }),
      sleepImpl: clock.sleep,
      nowImpl: clock.now,
      minIntervalMs: 5000,
    });

    await client.fetchListing('r/patientgamers', 'year');
    const before = clock.now();
    await client.fetchListing('r/gamingsuggestions', 'year');

    expect(clock.now() - before).toBeGreaterThanOrEqual(5000);
  });

  it('treats a non-rejection HTTP error as a distinct failure', async () => {
    const clock = stubClock();
    const client = createRedditClient({
      fetchImpl: async () => new Response('', { status: 404 }),
      sleepImpl: clock.sleep,
      nowImpl: clock.now,
      maxRetries: 1,
    });

    await expect(client.fetchListing('r/doesnotexist', 'year')).rejects.toThrow(/404/);
  });

  it('synthesizes the six-month window rather than re-fetching the year', async () => {
    // Reddit's tokens jump from month to year. Before the cutoff existed both
    // windows returned byte-identical results, and because magnitude counts how
    // many windows a thread appears in (KTD4), every thread older than a month
    // scored as if it had twice the reach it really did.
    const seen: string[] = [];
    const client = createRedditClient({
      fetchImpl: async (url) => {
        seen.push(String(url));
        return new Response(fixture('top-year.xml'), { status: 200 });
      },
      sleepImpl: async () => {},
      nowImpl: () => Date.parse('2026-07-28T00:00:00.000Z'),
    });

    const year = await client.fetchListing('r/patientgamers', 'year');
    const six = await client.fetchListing('r/patientgamers', 'sixMonths');

    // Same request — Reddit has nothing narrower to ask for...
    expect(seen[0]).toContain('t=year');
    expect(seen[1]).toContain('t=year');
    // ...so the narrowing has to happen here, and must actually narrow.
    expect(six.items.length).toBeLessThan(year.items.length);
    const cutoff = Date.parse('2026-07-28T00:00:00.000Z') - 182 * 24 * 60 * 60 * 1000;
    for (const item of six.items) {
      expect(Date.parse(item.postedAt)).toBeGreaterThanOrEqual(cutoff);
    }
  });

  it('renumbers rank position over the entries that survive the cutoff', () => {
    const cutoff = Date.parse('2026-07-01T00:00:00.000Z');
    const { items } = parseListingFeed(fixture('top-year.xml'), {
      window: 'sixMonths',
      notBefore: cutoff,
    });

    // A synthesized listing's rank is position within *it*, not a sparse
    // remnant of the listing it was cut from.
    expect(items.map((i) => i.rankPosition)).toEqual(items.map((_, index) => index));
  });

  it('pages from the last entry seen, not the last entry kept', () => {
    // Paging from a filtered-out entry would re-request the tail just dropped.
    const all = parseListingFeed(fixture('top-year.xml'), { window: 'year' });
    const filtered = parseListingFeed(fixture('top-year.xml'), {
      window: 'sixMonths',
      notBefore: Date.now() + 1, // drops everything
    });

    expect(filtered.items).toHaveLength(0);
    expect(filtered.nextCursor).toBe(all.nextCursor);
  });

  it('only narrows the window Reddit cannot express', () => {
    const now = Date.parse('2026-07-28T00:00:00.000Z');

    expect(windowCutoff('sixMonths', now)).toBe(now - 182 * 24 * 60 * 60 * 1000);
    for (const window of ['week', 'month', 'year'] as const) {
      expect(windowCutoff(window, now)).toBeNull();
    }
  });

  it('never composes a request from a community name it did not validate', async () => {
    const client = createRedditClient({
      fetchImpl: async () => new Response(fixture('top-year.xml'), { status: 200 }),
    });

    for (const bad of ['r/../admin', 'https://evil.test/r/x', 'r/a b', 'r/a%2Fb']) {
      await expect(client.fetchListing(bad, 'year')).rejects.toThrow(/community/i);
    }
  });
});
