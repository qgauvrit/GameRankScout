import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseItchFeed, createItchClient } from './itch.js';
import { parseListingFeed } from './reddit.js';
import { parseLemmyListing } from './lemmy.js';
import { sourceItemKey } from './key.js';
import { sourceItemSchema } from '../corpus/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (dir: string, name: string) =>
  readFileSync(resolve(here, '../../test/fixtures', dir, name), 'utf8');

describe('itch.io feed', () => {
  it('produces records with empty engagement fields', () => {
    const items = parseItchFeed(fixture('itch', 'newest.xml'), { window: 'week' });

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(() => sourceItemSchema.parse(item)).not.toThrow();
      expect(item.source).toBe('itch');
      expect(item.engagement).toBeUndefined();
    }
  });

  it('prefers the undecorated title, dropping price and platform tags', () => {
    const items = parseItchFeed(fixture('itch', 'newest.xml'), { window: 'week' });

    for (const item of items) {
      // The decorated <title> looks like "NAME [Free] [Windows]"; the
      // extractor should never see those brackets as part of a game name.
      expect(item.thread.title).not.toMatch(/\[(Free|Paid|\$)/);
    }
  });

  it('carries rank position in feed order', () => {
    const items = parseItchFeed(fixture('itch', 'newest.xml'), { window: 'week' });

    expect(items.map((i) => i.rankPosition)).toEqual(items.map((_, index) => index));
  });

  it('returns no items for a feed with no entries', () => {
    const empty = `<?xml version="1.0"?><rss version="2.0"><channel><title>Latest games - itch.io</title></channel></rss>`;

    expect(parseItchFeed(empty, { window: 'week' })).toEqual([]);
  });
});

describe('merging all three community sources', () => {
  it('merges into one corpus without identifier collision', () => {
    const reddit = parseListingFeed(fixture('reddit', 'top-year.xml'), { window: 'year' }).items;
    const lemmy = parseLemmyListing(fixture('lemmy', 'top-year.json'), {
      window: 'year',
      instance: 'https://lemmy.world',
    });
    const itch = parseItchFeed(fixture('itch', 'newest.xml'), { window: 'week' });

    const merged = [...reddit, ...lemmy, ...itch];
    const keys = merged.map(sourceItemKey);

    expect(merged.length).toBe(reddit.length + lemmy.length + itch.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps every merged record valid against the shared evidence contract', () => {
    const merged = [
      ...parseListingFeed(fixture('reddit', 'top-year.xml'), { window: 'year' }).items,
      ...parseLemmyListing(fixture('lemmy', 'top-year.json'), {
        window: 'year',
        instance: 'https://lemmy.world',
      }),
      ...parseItchFeed(fixture('itch', 'newest.xml'), { window: 'week' }),
    ];

    for (const item of merged) {
      expect(() => sourceItemSchema.parse(item)).not.toThrow();
    }
    expect(new Set(merged.map((i) => i.source))).toEqual(new Set(['reddit', 'lemmy', 'itch']));
  });

  it('distinguishes two sources that happen to use the same native id', () => {
    const a = parseLemmyListing(
      JSON.stringify({
        posts: [
          {
            post: { id: 42, name: 'A', body: '', published: '2026-01-01T00:00:00Z' },
            community: { name: 'games', actor_id: 'https://lemmy.world/c/games' },
            counts: { score: 1, comments: 0 },
          },
        ],
      }),
      { window: 'year', instance: 'https://lemmy.world' },
    );
    const b = parseLemmyListing(
      JSON.stringify({
        posts: [
          {
            post: { id: 42, name: 'B', body: '', published: '2026-01-01T00:00:00Z' },
            community: { name: 'games', actor_id: 'https://lemmy.ml/c/games' },
            counts: { score: 1, comments: 0 },
          },
        ],
      }),
      { window: 'year', instance: 'https://lemmy.ml' },
    );

    expect(sourceItemKey(a[0]!)).not.toBe(sourceItemKey(b[0]!));
  });
});

describe('itch client', () => {
  it('backs off and retries a rate-limit rejection instead of failing the source', async () => {
    let call = 0;
    const client = createItchClient({
      fetchImpl: (async () =>
        call++ === 0
          ? new Response('', { status: 503 })
          : new Response(fixture('itch', 'newest.xml'), { status: 200 })) as unknown as typeof fetch,
      sleepImpl: async () => {},
      nowImpl: () => 0,
      baseBackoffMs: 1,
    });

    const items = await client.fetchFeed('week');

    expect(items.length).toBeGreaterThan(0);
    expect(client.rejections()).toBe(1);
  });
});
