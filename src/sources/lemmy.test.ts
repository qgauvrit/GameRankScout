import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseLemmyListing, createLemmyClient, LEMMY_SORTS } from './lemmy.js';
import { sourceItemSchema } from '../corpus/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(resolve(here, '../../test/fixtures/lemmy', name), 'utf8');

describe('lemmy listing', () => {
  it('produces records carrying both score and comment count', () => {
    const items = parseLemmyListing(fixture('top-year.json'), {
      window: 'year',
      instance: 'https://lemmy.world',
    });

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(() => sourceItemSchema.parse(item)).not.toThrow();
      expect(item.source).toBe('lemmy');
      expect(item.engagement?.score).toBeTypeOf('number');
      expect(item.engagement?.comments).toBeTypeOf('number');
    }
  });

  it('carries rank position in listing order', () => {
    const items = parseLemmyListing(fixture('top-year.json'), {
      window: 'year',
      instance: 'https://lemmy.world',
    });

    expect(items.map((i) => i.rankPosition)).toEqual(items.map((_, index) => index));
  });

  it('names the community by instance and slug so two instances do not collide', () => {
    const items = parseLemmyListing(fixture('top-year.json'), {
      window: 'year',
      instance: 'https://lemmy.world',
    });

    for (const item of items) {
      expect(item.community).toBe('lemmy.world/c/games');
    }
  });

  it('links to the queried instance rather than the federated origin', () => {
    const items = parseLemmyListing(fixture('top-year.json'), {
      window: 'year',
      instance: 'https://lemmy.world',
    });

    for (const item of items) {
      expect(item.thread.permalink).toMatch(/^https:\/\/lemmy\.world\/post\/\d+$/);
    }
  });

  it('still produces an item for a post with no body', () => {
    const items = parseLemmyListing(fixture('no-body.json'), {
      window: 'year',
      instance: 'https://lemmy.world',
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.text).toContain('Silksong');
  });

  it('maps every ranking window to a supported sort', () => {
    expect(Object.keys(LEMMY_SORTS).sort()).toEqual(
      ['month', 'sixMonths', 'week', 'year'].sort(),
    );
  });

  it('rejects malformed payloads rather than yielding partial records', () => {
    expect(() =>
      parseLemmyListing('{"posts":"nope"}', { window: 'year', instance: 'https://lemmy.world' }),
    ).toThrow();
    expect(() =>
      parseLemmyListing('not json', { window: 'year', instance: 'https://lemmy.world' }),
    ).toThrow();
  });

  it('skips a removed or deleted post rather than ranking it', () => {
    const payload = JSON.stringify({
      posts: [
        {
          post: {
            id: 1,
            name: 'Deleted thread',
            body: '',
            published: '2026-01-01T00:00:00Z',
            removed: true,
            deleted: false,
          },
          community: { name: 'games', actor_id: 'https://lemmy.world/c/games' },
          counts: { score: 10, comments: 2 },
        },
      ],
    });

    expect(
      parseLemmyListing(payload, { window: 'year', instance: 'https://lemmy.world' }),
    ).toEqual([]);
  });
});

describe('lemmy client', () => {
  it('validates the community name before composing a request', async () => {
    const client = createLemmyClient({
      instance: 'https://lemmy.world',
      fetchImpl: async () => new Response(fixture('top-year.json'), { status: 200 }),
    });

    for (const bad of ['../admin', 'https://evil.test/c/x', 'a b', 'a/b']) {
      await expect(client.fetchListing(bad, 'year')).rejects.toThrow(/community/i);
    }
  });

  it('rejects an instance that is not an http(s) origin', () => {
    expect(() => createLemmyClient({ instance: 'javascript:alert(1)' })).toThrow(/instance/i);
  });

  it('paces consecutive requests', async () => {
    let now = 0;
    const client = createLemmyClient({
      instance: 'https://lemmy.world',
      fetchImpl: async () => new Response(fixture('top-year.json'), { status: 200 }),
      sleepImpl: async (ms) => {
        now += ms;
      },
      nowImpl: () => now,
      minIntervalMs: 2000,
    });

    await client.fetchListing('games', 'year');
    const before = now;
    await client.fetchListing('patientgamers', 'year');

    expect(now - before).toBeGreaterThanOrEqual(2000);
  });
});
