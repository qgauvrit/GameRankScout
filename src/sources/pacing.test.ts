import { describe, it, expect, vi } from 'vitest';
import { createPacedFetch, SourceRejectedError } from './pacing.js';

/** A clock that advances only when something sleeps, so pacing is deterministic. */
function clock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

function respondWith(statuses: number[]) {
  let call = 0;
  return vi.fn(async () => {
    const status = statuses[Math.min(call++, statuses.length - 1)]!;
    return new Response(status === 200 ? 'ok' : '', { status });
  }) as unknown as typeof fetch;
}

describe('paced fetch', () => {
  it('spaces sequential requests by the configured interval', async () => {
    const c = clock();
    const fetchImpl = respondWith([200]);
    const request = createPacedFetch({
      source: 'Test',
      fetchImpl,
      sleepImpl: c.sleep,
      nowImpl: c.now,
      minIntervalMs: 1_000,
      headers: {},
    });

    await request('https://example.test/a');
    expect(c.now()).toBe(0); // the first request waits for nothing
    await request('https://example.test/b');
    expect(c.now()).toBe(1_000);
  });

  it('spaces concurrent requests from each other, not just from the past', async () => {
    // A read-await-write on a shared timestamp is not a mutex: every concurrent
    // caller reads the same value, waits the same interval, and fires together.
    const c = clock();
    const fetchImpl = respondWith([200]);
    const request = createPacedFetch({
      source: 'Test',
      fetchImpl,
      sleepImpl: c.sleep,
      nowImpl: c.now,
      minIntervalMs: 1_000,
      headers: {},
    });

    await Promise.all([
      request('https://example.test/a'),
      request('https://example.test/b'),
      request('https://example.test/c'),
    ]);

    // Three requests, two gaps.
    expect(c.now()).toBe(2_000);
  });

  it('backs off and retries a rejection rather than failing the source', async () => {
    const c = clock();
    const fetchImpl = respondWith([429, 429, 200]);
    const request = createPacedFetch({
      source: 'Test',
      fetchImpl,
      sleepImpl: c.sleep,
      nowImpl: c.now,
      minIntervalMs: 0,
      baseBackoffMs: 100,
      headers: {},
    });

    await expect(request('https://example.test/a')).resolves.toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(request.rejections()).toBe(2);
    expect(c.now()).toBe(300); // 100 then 200, exponential
  });

  it('gives up after the retry budget, naming the source', async () => {
    const c = clock();
    const request = createPacedFetch({
      source: 'Lemmy',
      fetchImpl: respondWith([503]),
      sleepImpl: c.sleep,
      nowImpl: c.now,
      minIntervalMs: 0,
      baseBackoffMs: 1,
      maxRetries: 2,
      headers: {},
    });

    await expect(request('https://example.test/a')).rejects.toThrow(SourceRejectedError);
    await expect(request('https://example.test/a')).rejects.toThrow(/Lemmy/);
  });

  it('treats a non-rejection failure as an error, not something to wait out', async () => {
    const request = createPacedFetch({
      source: 'Test',
      fetchImpl: respondWith([404]),
      sleepImpl: async () => {},
      nowImpl: () => 0,
      minIntervalMs: 0,
      headers: {},
    });

    await expect(request('https://example.test/a')).rejects.toThrow(/404/);
    expect(request.rejections()).toBe(0);
  });
});
