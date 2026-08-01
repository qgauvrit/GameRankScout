import { describe, it, expect } from 'vitest';
import { runIngest, AllSourcesFailedError } from './run.js';
import { memoryCache } from '../enrich/cache.js';
import { buildDictionary } from '../extract/dictionary.js';
import type { IngestDeps, SourceAdapter } from './run.js';
import type { EnrichDeps } from '../enrich/resolve.js';
import type { Corpus, SourceItem } from '../corpus/schema.js';

const dictionary = buildDictionary([
  { appid: 553420, name: 'Tunic', owners: '1,000,000 .. 2,000,000', positive: 20_000, negative: 900 },
  { appid: 753640, name: 'Outer Wilds', owners: '1,000,000 .. 2,000,000', positive: 40_000, negative: 2_000 },
]);

function item(overrides: Partial<SourceItem> = {}): SourceItem {
  return {
    source: 'reddit',
    community: 'r/patientgamers',
    thread: { id: 't3_1', title: 'thread', permalink: 'https://example.test/1' },
    window: 'year',
    rankPosition: 0,
    postedAt: '2026-07-01T00:00:00.000Z',
    kind: 'post',
    parentThreadId: null,
    text: 'Tunic is wonderful.',
    ...overrides,
  };
}

function adapter(id: SourceItem['source'], items: SourceItem[] | Error): SourceAdapter {
  return {
    id,
    communities: ['one'],
    async collect() {
      if (items instanceof Error) throw items;
      return items;
    },
  };
}

function stubEnrich(): EnrichDeps {
  return {
    cache: memoryCache(),
    async fetchAppDetails(appid) {
      return {
        name: appid === 553420 ? 'TUNIC' : 'Outer Wilds',
        type: 'game',
        genres: ['Action'],
        platforms: { windows: true, mac: false, linux: false },
      };
    },
    async fetchSteamSpy() {
      return { tags: ['Metroidvania'], ownerBand: { min: 1_000_000, max: 2_000_000 }, reviews: 20_900 };
    },
    async fetchDeckReport() {
      return 'verified' as const;
    },
    async fetchProtonTier() {
      return 'platinum' as const;
    },
    async searchStore() {
      return null;
    },
  };
}

function deps(overrides: Partial<IngestDeps> = {}): IngestDeps & { published: Corpus[] } {
  const published: Corpus[] = [];
  const base: IngestDeps = {
    adapters: [adapter('reddit', [item()])],
    dictionary,
    enrich: stubEnrich(),
    publish(corpus) {
      published.push(corpus);
      return { path: '/tmp/corpus.json', bytes: JSON.stringify(corpus).length, games: corpus.games.length };
    },
    now: () => '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
  return Object.assign(base, { published });
}

describe('ingest run', () => {
  it('publishes a corpus and reports per-source counts that match it', async () => {
    const d = deps();

    const report = await runIngest(d);

    expect(report.ok).toBe(true);
    expect(d.published).toHaveLength(1);

    const corpus = d.published[0]!;
    const publishedEvidence = corpus.games.reduce((n, g) => n + g.evidence.length, 0);
    const reportedEvidence = report.sources.reduce((n, s) => n + s.evidenceCount, 0);

    expect(reportedEvidence).toBe(publishedEvidence);
    expect(report.games).toBe(corpus.games.length);
  });

  it('completes when one source fails, recording it as failed', async () => {
    const d = deps({
      adapters: [
        adapter('reddit', [item()]),
        adapter('lemmy', new Error('rate limited for too long')),
      ],
    });

    const report = await runIngest(d);

    expect(report.ok).toBe(true);
    expect(d.published).toHaveLength(1);

    const lemmy = report.sources.find((s) => s.source === 'lemmy');
    expect(lemmy?.ok).toBe(false);
    expect(lemmy?.error).toContain('rate limited');
    expect(report.sources.find((s) => s.source === 'reddit')?.ok).toBe(true);
  });

  it('reports a run that produced nothing, without publishing over a good corpus', async () => {
    // A source can succeed and still yield nothing usable, which satisfies the
    // every-source-failed guard while producing a corpus with no games. The
    // heartbeat KTD6 needs is the run *report*, not a published corpus, so this
    // still produces a report — and refuses to publish.
    const d = deps({ adapters: [adapter('reddit', [])] });

    const error = await runIngest(d).then(
      () => null,
      (e: unknown) => e as AllSourcesFailedError,
    );

    expect(error).toBeInstanceOf(AllSourcesFailedError);
    expect(d.published).toHaveLength(0);
    expect(error?.report.games).toBe(0);
    expect(error?.report.ok).toBe(false);
    expect(error?.message).toMatch(/no games/i);
  });

  it('publishes as soon as the run produced at least one game', async () => {
    const d = deps({ adapters: [adapter('reddit', [item({ community: 'r/a' })])] });

    const report = await runIngest(d);

    expect(report.ok).toBe(true);
    expect(d.published).toHaveLength(1);
  });

  it('refuses to publish an empty corpus over a good one when every source fails', async () => {
    const d = deps({
      adapters: [
        adapter('reddit', new Error('reddit down')),
        adapter('lemmy', new Error('lemmy down')),
      ],
    });

    await expect(runIngest(d)).rejects.toBeInstanceOf(AllSourcesFailedError);
    expect(d.published).toHaveLength(0);
  });

  it('records the failure of every source even when the run aborts', async () => {
    const d = deps({
      adapters: [
        adapter('reddit', new Error('reddit down')),
        adapter('lemmy', new Error('lemmy down')),
      ],
    });

    await expect(runIngest(d)).rejects.toMatchObject({
      report: expect.objectContaining({ ok: false }),
    });
  });

  it('carries no source content into the run report', async () => {
    const d = deps({
      adapters: [
        adapter('reddit', [item({ text: 'Tunic is wonderful. SECRET BODY TEXT that must not leak' })]),
      ],
    });

    const report = await runIngest(d);

    expect(JSON.stringify(report)).not.toContain('SECRET BODY TEXT');
    // Thread titles are references and belong in the corpus, but the report is
    // counts and outcomes only.
    expect(JSON.stringify(report)).not.toContain('thread');
  });

  it('counts communities covered per source', async () => {
    const d = deps({
      adapters: [
        {
          id: 'reddit',
          communities: ['a', 'b'],
          async collect() {
            return [item({ community: 'r/a' }), item({ community: 'r/b', thread: { id: 't3_2', title: 'x', permalink: 'https://example.test/2' } })];
          },
        },
      ],
    });

    const report = await runIngest(d);

    expect(report.sources[0]?.communitiesCovered).toBe(2);
  });

  it('is deterministic for identical input', async () => {
    const a = await runIngest(deps());
    const b = await runIngest(deps());

    expect(a).toEqual(b);
  });

  // The publish outcome is written here and overwritten later, from a different
  // job, after this file has already been committed. So the only honest value
  // the ingest can write is the one that says it does not know yet — anything
  // else would be a claim about a deploy that has not been attempted.
  describe('the publish outcome it cannot yet know', () => {
    it('leaves a successful run marked not_attempted', async () => {
      expect((await runIngest(deps())).publish).toBe('not_attempted');
    });

    it('marks a run that never produced a corpus not_attempted too', async () => {
      // Not `deploy_failed`: nothing was deployed, and reading those as the
      // same thing would hide the difference the field exists to show.
      const d = deps({ adapters: [adapter('reddit', new Error('reddit down'))] });

      const error = await runIngest(d).then(
        () => null,
        (e: unknown) => e as AllSourcesFailedError,
      );

      expect(error?.report.publish).toBe('not_attempted');
    });

    it('marks a run that swept fine but yielded no games not_attempted', async () => {
      // The third path out of this module: sources succeeded, the corpus was
      // empty, so there is nothing to publish and nothing was.
      const d = deps({ adapters: [adapter('reddit', [])] });

      const error = await runIngest(d).then(
        () => null,
        (e: unknown) => e as AllSourcesFailedError,
      );

      expect(error?.report.publish).toBe('not_attempted');
    });
  });
});
