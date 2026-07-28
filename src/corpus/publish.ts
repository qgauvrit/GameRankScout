import { writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { corpusSchema, RANKING_WINDOWS, SCHEMA_VERSION } from './schema.js';
import type { Corpus, EvidenceRecord, GameEntry, SourceStatus } from './schema.js';

export const CORPUS_FILENAME = 'corpus.json';

export class CorpusPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorpusPublishError';
  }
}

function isUsableLink(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Fields that must never appear on a published evidence record. `text` is the
 * transient body extraction reads; it lives on the source item and is dropped
 * before evidence is built, but stripping again here makes the guarantee
 * structural rather than dependent on every upstream caller behaving (KTD11).
 */
function toPublishedEvidence(record: EvidenceRecord): EvidenceRecord {
  const { source, community, thread, window, rankPosition, postedAt, mention, gameId, engagement } =
    record;
  return {
    source,
    community,
    thread: { id: thread.id, title: thread.title, permalink: thread.permalink },
    window,
    rankPosition,
    postedAt,
    mention,
    gameId,
    ...(engagement ? { engagement } : {}),
  };
}

export interface BuildCorpusOptions {
  /** Injected so a corpus is a pure function of its inputs and is reproducible. */
  now?: string;
}

/**
 * Assembles the corpus the app reads.
 *
 * Carries references rather than reproductions: game identifiers, community
 * names, thread titles and permalinks, with post and comment bodies already
 * discarded (KTD11). Per-window weights are retained so momentum is computable
 * within a single run and no history needs storing (KTD5, KTD12).
 */
export function buildCorpus(
  games: GameEntry[],
  sources: SourceStatus[],
  options: BuildCorpusOptions = {},
): Corpus {
  const generatedAt = options.now ?? new Date().toISOString();

  const published = games
    .map((game) => {
      const evidence = game.evidence
        .filter((record) => isUsableLink(record.thread.permalink))
        .map(toPublishedEvidence)
        // Stable order: best-ranked first, then thread id to break ties.
        .sort(
          (a, b) =>
            a.rankPosition - b.rankPosition ||
            a.window.localeCompare(b.window) ||
            a.thread.id.localeCompare(b.thread.id),
        );

      const windowWeights = { ...game.windowWeights };
      for (const window of RANKING_WINDOWS) {
        if (typeof windowWeights[window] !== 'number' || !Number.isFinite(windowWeights[window])) {
          windowWeights[window] = 0;
        }
      }

      return { ...game, evidence, windowWeights };
    })
    // A game with no surviving evidence cannot be explained to the reader, and
    // an unexplainable rank is worse than an absent one (R14, R34).
    .filter((game) => game.evidence.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    games: published,
    sources: [...sources].sort((a, b) => a.source.localeCompare(b.source)),
  };
}

export interface PublishOptions {
  outDir: string;
  fileName?: string;
}

export interface PublishResult {
  path: string;
  bytes: number;
  games: number;
}

/**
 * Writes the corpus as a build output, replacing whatever was there before.
 *
 * Only the latest state is retained (KTD5): each run's corpus supersedes the
 * last, nothing accumulates, and because momentum is computed within a run the
 * corpus needs no history at all.
 */
export function publishCorpus(corpus: Corpus, options: PublishOptions): PublishResult {
  const { outDir, fileName = CORPUS_FILENAME } = options;

  // Validate before touching disk, so a bad run cannot replace a good corpus
  // with an unusable one.
  const validated = corpusSchema.safeParse(corpus);
  if (!validated.success) {
    throw new CorpusPublishError(
      `Refusing to publish an invalid corpus: ${validated.error.issues[0]?.message ?? 'unknown issue'}`,
    );
  }

  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });

  // Remove any previous corpus, including one written under a different name,
  // so exactly one corpus is ever present.
  if (existsSync(dir)) {
    for (const existing of readdirSync(dir)) {
      if (existing === fileName || /^corpus.*\.json$/.test(existing)) {
        rmSync(join(dir, existing), { force: true });
      }
    }
  }

  const path = join(dir, fileName);
  const body = JSON.stringify(validated.data);
  writeFileSync(path, body);

  return { path, bytes: Buffer.byteLength(body), games: validated.data.games.length };
}
