import { describe, it, expect } from 'vitest';
import {
  SCHEMA_VERSION,
  RANKING_WINDOWS,
  parseCorpus,
  serializeCorpus,
  evidenceRecordSchema,
  CorpusSchemaVersionError,
  CorpusValidationError,
  type Corpus,
  type EvidenceRecord,
} from './schema.js';

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    source: 'reddit',
    community: 'r/gamingsuggestions',
    thread: {
      id: 't3_abc123',
      title: 'What under-the-radar game stuck with you this year?',
      permalink: 'https://www.reddit.com/r/gamingsuggestions/comments/abc123/',
    },
    window: 'year',
    rankPosition: 0,
    postedAt: '2026-07-01T12:00:00.000Z',
    mention: 'Tunic',
    gameId: 'steam:553420',
    ...overrides,
  };
}

function corpus(overrides: Partial<Corpus> = {}): Corpus {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: '2026-07-28T00:00:00.000Z',
    games: [
      {
        id: 'steam:553420',
        name: 'Tunic',
        storeLinks: [{ store: 'steam', url: 'https://store.steampowered.com/app/553420/' }],
        tags: ['isometric', 'metroidvania', 'souls-like'],
        genres: ['action-adventure'],
        platforms: ['pc', 'switch', 'xbox-series'],
        ownerBand: { min: 500_000, max: 1_000_000 },
        reviewCount: 12_500,
        handheld: { deck: 'verified', protonTier: null },
        windowWeights: { week: 0, month: 1.5, sixMonths: 3.25, year: 4 },
        evidence: [evidence()],
      },
    ],
    sources: [
      {
        source: 'reddit',
        ok: true,
        evidenceCount: 1,
        communitiesCovered: 1,
        rejections: 0,
        error: null,
      },
    ],
    ...overrides,
  };
}

describe('corpus envelope', () => {
  it('round-trips a known-version envelope through serialize and parse without loss', () => {
    const original = corpus();

    const parsed = parseCorpus(serializeCorpus(original));

    expect(parsed).toEqual(original);
  });

  it('rejects an unrecognized schema version with a distinguishable error', () => {
    const future = JSON.stringify({ ...corpus(), schemaVersion: SCHEMA_VERSION + 1 });

    expect(() => parseCorpus(future)).toThrow(CorpusSchemaVersionError);

    // The version mismatch must not surface as a generic validation failure — the app
    // discards a superseded cache on this signal rather than treating it as corruption.
    try {
      parseCorpus(future);
      expect.unreachable('parseCorpus should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CorpusSchemaVersionError);
      expect(error).not.toBeInstanceOf(CorpusValidationError);
      expect((error as CorpusSchemaVersionError).found).toBe(SCHEMA_VERSION + 1);
      expect((error as CorpusSchemaVersionError).expected).toBe(SCHEMA_VERSION);
    }
  });

  it('rejects a structurally invalid envelope as a validation error, not a version error', () => {
    const broken = JSON.stringify({ ...corpus(), games: [{ id: 'steam:1', name: 'Nameless' }] });

    expect(() => parseCorpus(broken)).toThrow(CorpusValidationError);
    expect(() => parseCorpus(broken)).not.toThrow(CorpusSchemaVersionError);
  });

  it('rejects malformed JSON as a validation error rather than leaking a syntax error', () => {
    expect(() => parseCorpus('{ not json')).toThrow(CorpusValidationError);
  });

  it('accepts an envelope with no ranked games', () => {
    const empty = corpus({ games: [] });

    expect(parseCorpus(serializeCorpus(empty)).games).toEqual([]);
  });

  it('carries a weight for every ranking window on each ranked game', () => {
    const parsed = parseCorpus(serializeCorpus(corpus()));

    for (const game of parsed.games) {
      for (const window of RANKING_WINDOWS) {
        expect(game.windowWeights[window]).toBeTypeOf('number');
      }
    }
  });
});

describe('evidence record', () => {
  it('parses a record with no engagement figures, since most sources expose none', () => {
    const withoutEngagement = evidence();

    const parsed = evidenceRecordSchema.parse(withoutEngagement);

    expect(parsed.engagement).toBeUndefined();
    expect(parsed.source).toBe('reddit');
  });

  it('parses a record carrying score and comment count', () => {
    const withEngagement = evidence({
      source: 'lemmy',
      community: 'lemmy.world/c/games',
      engagement: { score: 412, comments: 88 },
    });

    expect(evidenceRecordSchema.parse(withEngagement).engagement).toEqual({
      score: 412,
      comments: 88,
    });
  });

  it('accepts a negative score, since community votes can go below zero', () => {
    const downvoted = evidence({ engagement: { score: -12, comments: 3 } });

    expect(evidenceRecordSchema.parse(downvoted).engagement?.score).toBe(-12);
  });

  it('accepts an unresolved mention whose canonical game is not yet known', () => {
    const unresolved = evidence({ gameId: null });

    expect(evidenceRecordSchema.parse(unresolved).gameId).toBeNull();
  });

  it('rejects a record whose permalink is not an http(s) URL', () => {
    const badLink = evidence({
      thread: { id: 't3_x', title: 'x', permalink: 'javascript:alert(1)' },
    });

    expect(() => evidenceRecordSchema.parse(badLink)).toThrow();
  });

  it('rejects a negative rank position', () => {
    expect(() => evidenceRecordSchema.parse(evidence({ rankPosition: -1 }))).toThrow();
  });
});
