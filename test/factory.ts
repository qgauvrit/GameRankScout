import { SCHEMA_VERSION } from '../src/corpus/schema.js';
import type {
  Corpus,
  EvidenceRecord,
  GameEntry,
  RankingWindow,
  SourceStatus,
} from '../src/corpus/schema.js';

/**
 * Corpus fixtures for tests that need a realistic shape rather than a real
 * corpus. Shared across the app tests so a schema change breaks in one place.
 */

let threadCounter = 0;

export function evidence(
  overrides: Partial<EvidenceRecord> & { community: string; window: RankingWindow },
): EvidenceRecord {
  threadCounter += 1;
  return {
    source: 'reddit',
    thread: {
      id: `t3_${threadCounter}`,
      title: `Thread ${threadCounter}`,
      permalink: `https://reddit.test/comments/${threadCounter}/`,
    },
    rankPosition: 0,
    postedAt: '2026-07-27T12:00:00.000Z',
    mention: 'a game',
    gameId: 'steam:1',
    ...overrides,
  };
}

export function game(overrides: Partial<GameEntry> & { id: string }): GameEntry {
  return {
    name: overrides.id,
    storeLinks: [{ store: 'steam', url: `https://store.steampowered.com/app/1/` }],
    tags: ['Roguelike', 'Pixel Graphics'],
    genres: ['Indie'],
    platforms: ['pc'],
    ownerBand: { min: 200_000, max: 500_000 },
    reviewCount: 4_200,
    handheld: { deck: 'verified', protonTier: 'platinum' },
    windowWeights: { week: 1, month: 1, sixMonths: 1, year: 1 },
    evidence: [evidence({ community: 'r/patientgamers', window: 'week' })],
    ...overrides,
  };
}

export function sourceStatus(overrides: Partial<SourceStatus> = {}): SourceStatus {
  return {
    source: 'reddit',
    ok: true,
    evidenceCount: 100,
    communitiesCovered: 2,
    rejections: 0,
    error: null,
    ...overrides,
  };
}

export function corpus(overrides: Partial<Corpus> = {}): Corpus {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: '2026-07-28T00:00:00.000Z',
    games: [],
    sources: [sourceStatus()],
    ...overrides,
  };
}
