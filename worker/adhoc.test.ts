import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CACHE_TTL_MS,
  CommunityNotFoundError,
  InvalidCommunityError,
  MAX_ENTRIES,
  fetchCommunity,
  handleRequest,
  memoryCache,
  resolveTarget,
  ADHOC_PATH,
} from './adhoc.js';
import worker from './adhoc.js';
import type { AdhocDeps } from './adhoc.js';

const REDDIT_FEED = readFileSync('test/fixtures/reddit/top-year.xml', 'utf8');
const LEMMY_LISTING = readFileSync('test/fixtures/lemmy/top-year.json', 'utf8');
/** How a community that does not exist actually presents: well-formed and empty. */
const EMPTY_FEED = readFileSync('test/fixtures/reddit/empty.xml', 'utf8');

function deps(body: string, status = 200, overrides: Partial<AdhocDeps> = {}): AdhocDeps {
  return {
    fetchImpl: vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch,
    cache: memoryCache(),
    now: () => 1_000_000,
    sleep: async () => {},
    ...overrides,
  };
}

describe('composing the outbound URL', () => {
  it('builds a Reddit listing URL from a validated name', () => {
    const target = resolveTarget('reddit', 'r/cozygames', 'week');

    expect(target.url.startsWith('https://www.reddit.com/r/cozygames/top/.rss?')).toBe(true);
    expect(target.community).toBe('r/cozygames');
  });

  it('accepts a bare name as well as the r/ form', () => {
    expect(resolveTarget('reddit', 'cozygames', 'week').community).toBe('r/cozygames');
  });

  it('maps the six-month window onto the widest window the source offers', () => {
    // Reddit has no six-month listing; asking for one must not compose `t=sixMonths`.
    expect(resolveTarget('reddit', 'r/cozygames', 'sixMonths').url).toContain('t=year');
  });

  it('builds a Lemmy listing URL against the allowlisted instance', () => {
    const target = resolveTarget('lemmy', 'c/games', 'year');

    expect(target.url.startsWith('https://lemmy.world/api/v3/post/list?')).toBe(true);
    expect(target.community).toBe('games');
  });
});

describe('rejecting anything that is not a community name', () => {
  const hostile = [
    'https://evil.test/steal',
    'http://localhost:8080',
    '//evil.test',
    'r/../../admin',
    '../secrets',
    'cozygames/../../etc/passwd',
    'cozy%2Fgames',
    'cozy games',
    'cozygames?x=1',
    'cozygames#frag',
    'r/cozygames@evil.test',
    '',
    'a',
  ];

  it('rejects every identifier that could redirect the request', () => {
    for (const community of hostile) {
      expect(() => resolveTarget('reddit', community, 'week')).toThrow(InvalidCommunityError);
    }
  });

  it('rejects an unknown source rather than guessing a host', () => {
    expect(() => resolveTarget('evil', 'cozygames', 'week')).toThrow(InvalidCommunityError);
    // Prototype keys must not read as a configured source.
    expect(() => resolveTarget('constructor', 'cozygames', 'week')).toThrow(InvalidCommunityError);
    expect(() => resolveTarget('__proto__', 'cozygames', 'week')).toThrow(InvalidCommunityError);
  });

  it('makes no outbound request at all for a rejected identifier', async () => {
    const options = deps(REDDIT_FEED);

    await expect(
      fetchCommunity('reddit', 'https://evil.test/steal', 'week', options),
    ).rejects.toBeInstanceOf(InvalidCommunityError);

    expect(options.fetchImpl).not.toHaveBeenCalled();
  });

  it('only ever fetches an allowlisted host', async () => {
    const options = deps(REDDIT_FEED);
    await fetchCommunity('reddit', 'r/cozygames', 'week', options);

    const called = vi.mocked(options.fetchImpl!).mock.calls[0]![0] as string;
    expect(new URL(called).origin).toBe('https://www.reddit.com');
  });
});

describe('fetching a community the corpus does not cover', () => {
  it('returns items the app can merge', async () => {
    const result = await fetchCommunity('reddit', 'r/cozygames', 'year', deps(REDDIT_FEED));

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]).toMatchObject({
      source: 'reddit',
      window: 'year',
      kind: 'post',
    });
    expect(result.items[0]!.thread.permalink).toMatch(/^https?:\/\//);
  });

  it('carries Lemmy engagement figures through unchanged', async () => {
    const result = await fetchCommunity('lemmy', 'games', 'year', deps(LEMMY_LISTING));

    expect(result.items[0]!.engagement).toBeDefined();
  });

  it('serves a repeated request from cache without refetching', async () => {
    const options = deps(REDDIT_FEED);

    const first = await fetchCommunity('reddit', 'r/cozygames', 'year', options);
    const second = await fetchCommunity('reddit', 'r/cozygames', 'year', options);

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(options.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refetches once the cache window has passed', async () => {
    let clock = 1_000_000;
    const options = deps(REDDIT_FEED, 200, { now: () => clock });

    await fetchCommunity('reddit', 'r/cozygames', 'year', options);
    clock += CACHE_TTL_MS + 1;
    const second = await fetchCommunity('reddit', 'r/cozygames', 'year', options);

    expect(second.cached).toBe(false);
    expect(options.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('caches per window, so one timeframe does not answer for another', async () => {
    const options = deps(REDDIT_FEED);

    await fetchCommunity('reddit', 'r/cozygames', 'year', options);
    await fetchCommunity('reddit', 'r/cozygames', 'week', options);

    expect(options.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports an unknown community as not found, not as an empty success', async () => {
    await expect(
      fetchCommunity('reddit', 'r/nosuchplace', 'year', deps(EMPTY_FEED)),
    ).rejects.toBeInstanceOf(CommunityNotFoundError);

    await expect(
      fetchCommunity('reddit', 'r/nosuchplace', 'year', deps('', 404)),
    ).rejects.toBeInstanceOf(CommunityNotFoundError);
  });
});

describe('staying inside the invocation budget', () => {
  it('degrades to fewer entries rather than failing on an oversized feed', async () => {
    // Duplicate the recorded feed's entries until it exceeds the ceiling.
    const entry = REDDIT_FEED.slice(REDDIT_FEED.indexOf('<entry>'), REDDIT_FEED.indexOf('</entry>') + 8);
    const inflated = REDDIT_FEED.replace(entry, entry.repeat(MAX_ENTRIES + 20));

    const result = await fetchCommunity('reddit', 'r/cozygames', 'year', deps(inflated));

    expect(result.items).toHaveLength(MAX_ENTRIES);
    expect(result.truncated).toBe(true);
  });

  it('parses a full page well inside the per-invocation ceiling', async () => {
    const entry = REDDIT_FEED.slice(REDDIT_FEED.indexOf('<entry>'), REDDIT_FEED.indexOf('</entry>') + 8);
    const fullPage = REDDIT_FEED.replace(entry, entry.repeat(MAX_ENTRIES));

    const started = performance.now();
    await fetchCommunity('reddit', 'r/cozygames', 'year', deps(fullPage));
    const elapsed = performance.now() - started;

    // Wall clock is a proxy for the platform's CPU budget, so the assertion is
    // deliberately loose: it catches an accidentally quadratic parse, which is
    // the failure mode that would actually blow the ceiling.
    expect(elapsed).toBeLessThan(200);
  });
});

describe('the HTTP surface', () => {
  const url = (query: string) => new Request(`https://grs.test/adhoc?${query}`);

  it('answers a valid request with the parsed community', async () => {
    const response = await handleRequest(url('source=reddit&community=r/cozygames'), deps(REDDIT_FEED));

    expect(response.status).toBe(200);
    // The app is served by this same Worker, so the only legitimate caller is
    // same-origin. A wildcard grant here would be a CORS-bypassing relay into
    // the allowlisted sources for any third-party page.
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    const body = (await response.json()) as { community: string; items: unknown[] };
    expect(body.community).toBe('r/cozygames');
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('answers a hostile identifier with a 400 and no fetch', async () => {
    const options = deps(REDDIT_FEED);
    const response = await handleRequest(url('community=https://evil.test'), options);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_community' });
    expect(options.fetchImpl).not.toHaveBeenCalled();
  });

  it('answers an unknown community with a distinguishable 404', async () => {
    const response = await handleRequest(url('community=r/nosuchplace'), deps(EMPTY_FEED));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'not_found' });
  });

  it('rejects a timeframe it does not have', async () => {
    const response = await handleRequest(url('community=r/cozygames&window=forever'), deps(REDDIT_FEED));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_window' });
  });

  it('reports an upstream failure as an upstream failure', async () => {
    const response = await handleRequest(url('community=r/cozygames'), deps('', 503));

    expect(response.status).toBe(502);
  });
});

describe('routing between the handler and the static site', () => {
  /**
   * `run_worker_first` in `wrangler.toml` is what actually routes production
   * traffic, so in a correct deployment the delegation below never runs. These
   * cover the fallback anyway: the failure it absorbs is total, and it is the
   * only part of the routing that can be exercised without a deployment.
   */
  function env() {
    const assets = vi.fn(async () => new Response('<!doctype html>shell', { status: 200 }));
    return { assets, binding: { ASSETS: { fetch: assets } } };
  }

  it('keeps /adhoc in the handler and away from the asset store', async () => {
    const { assets, binding } = env();

    // An invalid window fails before any outbound fetch, so this exercises the
    // routing decision without reaching the network.
    const response = await worker.fetch(
      new Request('https://grs.test/adhoc?community=r/cozygames&window=forever'),
      binding,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_window' });
    expect(assets).not.toHaveBeenCalled();
  });

  it('serves the site root from the asset store', async () => {
    const { assets, binding } = env();

    const response = await worker.fetch(new Request('https://grs.test/'), binding);

    expect(assets).toHaveBeenCalledOnce();
    expect(await response.text()).toContain('shell');
  });

  it('sends an unknown route to the asset store rather than the handler', async () => {
    const { assets, binding } = env();

    // Route-shaped: no extension. Whether an asset-shaped 404 should stay a 404
    // is `not_found_handling`'s call, and this assertion holds either way.
    const response = await worker.fetch(new Request('https://grs.test/settings/communities'), binding);

    expect(assets).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
  });

  it('routes on the same path the wrangler manifest sends to the Worker', () => {
    const manifest = readFileSync('wrangler.toml', 'utf8');

    // Two files have to agree on one string; a drift here silently routes the
    // whole site into the handler or the handler into the asset store.
    expect(manifest).toContain(`run_worker_first = ["${ADHOC_PATH}"]`);
  });
});
