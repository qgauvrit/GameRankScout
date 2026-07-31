import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishCorpus, buildCorpus, CorpusPublishError } from './publish.js';
import { parseCorpus, SCHEMA_VERSION } from './schema.js';
import type { EvidenceRecord, GameEntry, SourceStatus } from './schema.js';

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), 'grs-publish-'));
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    source: 'reddit',
    community: 'r/patientgamers',
    thread: {
      id: 't3_1',
      title: 'What did you play this year?',
      permalink: 'https://www.reddit.com/r/patientgamers/comments/1/',
    },
    window: 'year',
    rankPosition: 0,
    postedAt: '2026-07-01T00:00:00.000Z',
    mention: 'Tunic',
    gameId: 'steam:553420',
    ...overrides,
  };
}

function game(overrides: Partial<GameEntry> = {}): GameEntry {
  return {
    id: 'steam:553420',
    name: 'TUNIC',
    storeLinks: [{ store: 'steam', url: 'https://store.steampowered.com/app/553420/' }],
    tags: ['Metroidvania'],
    genres: ['Action'],
    platforms: ['pc'],
    ownerBand: { min: 1_000_000, max: 2_000_000 },
    reviewCount: 20_900,
    handheld: { deck: 'verified', protonTier: 'platinum' },
    windowWeights: { week: 0.01, month: 0.02, sixMonths: 0.03, year: 0.04 },
    evidence: [evidence()],
    ...overrides,
  };
}

const sources: SourceStatus[] = [
  { source: 'reddit', ok: true, evidenceCount: 1, communitiesCovered: 1, rejections: 0, error: null },
];

describe('buildCorpus', () => {
  it('carries a weight for every window on each ranked game', () => {
    const corpus = buildCorpus([game()], sources, { now: '2026-07-28T00:00:00.000Z' });

    for (const entry of corpus.games) {
      for (const window of ['week', 'month', 'sixMonths', 'year'] as const) {
        expect(entry.windowWeights[window]).toBeTypeOf('number');
      }
    }
  });

  it('gives every ranked game at least one thread permalink', () => {
    const corpus = buildCorpus([game()], sources, { now: '2026-07-28T00:00:00.000Z' });

    for (const entry of corpus.games) {
      expect(entry.evidence.length).toBeGreaterThan(0);
      expect(entry.evidence[0]?.thread.permalink).toMatch(/^https?:\/\//);
    }
  });

  it('drops a game carrying no evidence rather than publishing an unexplainable rank', () => {
    const corpus = buildCorpus([game(), game({ id: 'steam:1', evidence: [] })], sources, {
      now: '2026-07-28T00:00:00.000Z',
    });

    expect(corpus.games.map((g) => g.id)).toEqual(['steam:553420']);
  });

  it('drops evidence whose permalink is not a usable link', () => {
    const corpus = buildCorpus(
      [
        game({
          evidence: [
            evidence(),
            evidence({
              thread: { id: 't3_2', title: 'x', permalink: 'javascript:alert(1)' },
            }),
          ],
        }),
      ],
      sources,
      { now: '2026-07-28T00:00:00.000Z' },
    );

    expect(corpus.games[0]?.evidence).toHaveLength(1);
  });

  it('orders games and evidence deterministically, so identical input publishes identical bytes', () => {
    const a = buildCorpus([game({ id: 'steam:2' }), game({ id: 'steam:1' })], sources, {
      now: '2026-07-28T00:00:00.000Z',
    });
    const b = buildCorpus([game({ id: 'steam:1' }), game({ id: 'steam:2' })], sources, {
      now: '2026-07-28T00:00:00.000Z',
    });

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('publishCorpus', () => {
  it('leaves exactly one corpus when published twice, the second superseding the first', () => {
    const first = buildCorpus([game()], sources, { now: '2026-07-01T00:00:00.000Z' });
    const second = buildCorpus([game({ name: 'TUNIC (updated)' })], sources, {
      now: '2026-07-28T00:00:00.000Z',
    });

    publishCorpus(first, { outDir });
    publishCorpus(second, { outDir });

    const files = readdirSync(outDir).filter((f) => f.endsWith('.json'));
    expect(files).toEqual(['corpus.json']);

    const written = parseCorpus(readFileSync(join(outDir, 'corpus.json'), 'utf8'));
    expect(written.generatedAt).toBe('2026-07-28T00:00:00.000Z');
    expect(written.games[0]?.name).toBe('TUNIC (updated)');
  });

  it('publishes a corpus the app can parse', () => {
    publishCorpus(buildCorpus([game()], sources, { now: '2026-07-28T00:00:00.000Z' }), { outDir });

    const parsed = parseCorpus(readFileSync(join(outDir, 'corpus.json'), 'utf8'));
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.games).toHaveLength(1);
  });

  it('carries no post or comment body text', () => {
    const body = 'This is the body of a real post that must never be republished.';
    publishCorpus(
      buildCorpus(
        [game({ evidence: [{ ...evidence(), mention: 'Tunic' }] })],
        sources,
        { now: '2026-07-28T00:00:00.000Z' },
      ),
      { outDir },
    );

    const raw = readFileSync(join(outDir, 'corpus.json'), 'utf8');
    expect(raw).not.toContain(body);
    // No evidence record may carry a `text` field at all — the transient body
    // lives on the source item and must not survive into the corpus (KTD11).
    for (const entry of JSON.parse(raw).games) {
      for (const record of entry.evidence) {
        expect(record).not.toHaveProperty('text');
      }
    }
  });

  it('refuses to publish a corpus that would fail validation', () => {
    const broken = {
      ...buildCorpus([game()], sources, { now: '2026-07-28T00:00:00.000Z' }),
      schemaVersion: 999,
    };

    expect(() => publishCorpus(broken as never, { outDir })).toThrow(CorpusPublishError);
    expect(existsSync(join(outDir, 'corpus.json'))).toBe(false);
  });

  it('reports where it wrote and how large the corpus is', () => {
    const result = publishCorpus(buildCorpus([game()], sources, { now: '2026-07-28T00:00:00.000Z' }), {
      outDir,
    });

    expect(result.path).toBe(join(outDir, 'corpus.json'));
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.games).toBe(1);
  });
});

describe('the corpus is never committed (KTD11)', () => {
  it('has every publish target ignored by version control', () => {
    // The corpus is a deployment artifact. If a target ever stops being
    // ignored, a run would start committing source-derived data.
    for (const target of ['public/corpus.json', 'dist/corpus.json', 'data/corpus/corpus.json']) {
      const ignored = execFileSync('git', ['check-ignore', '--quiet', target], {
        cwd: join(import.meta.dirname, '../..'),
        stdio: 'pipe',
      });
      expect(ignored.toString()).toBe('');
    }
  });
});
