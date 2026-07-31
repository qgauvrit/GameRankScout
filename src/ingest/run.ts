import { buildEvidence, enrichGames } from '../enrich/resolve.js';
import { buildCorpus } from '../corpus/publish.js';
import type { RunReport } from './report.js';
import type { Dictionary } from '../extract/dictionary.js';
import type { EnrichDeps } from '../enrich/resolve.js';
import type { PublishResult } from '../corpus/publish.js';
import type { Corpus, SourceId, SourceItem, SourceStatus } from '../corpus/schema.js';

/**
 * One source, responsible for its own communities, windows and pacing. Adding a
 * source means writing an adapter, not touching the orchestrator (KTD2).
 */
export interface SourceAdapter {
  id: SourceId;
  /** Community identifiers this adapter will sweep, for reporting. */
  communities: string[];
  collect(): Promise<SourceItem[]>;
  /** Rejections observed while collecting, if the adapter tracks them. */
  rejections?(): number;
}

export interface IngestDeps {
  adapters: SourceAdapter[];
  dictionary: Dictionary;
  enrich: EnrichDeps;
  publish(corpus: Corpus): PublishResult;
  now(): string;
}

/**
 * Every source failed. The run must not publish, because an empty corpus would
 * replace a good one and the app would render nothing rather than stale data.
 */
export class AllSourcesFailedError extends Error {
  readonly report: RunReport;

  constructor(report: RunReport, message = 'Every source failed; refusing to publish an empty corpus over a good one') {
    super(message);
    this.name = 'AllSourcesFailedError';
    this.report = report;
  }
}

/**
 * Runs one ingest: sweep every adapter, extract mentions, resolve and enrich,
 * then publish.
 *
 * A single source failing is expected and degrades the corpus rather than
 * ending the run — its outcome is recorded so a quietly dead source becomes
 * visible in the app rather than only in workflow logs (R35).
 */
export async function runIngest(deps: IngestDeps): Promise<RunReport> {
  const startedAt = deps.now();

  const items: SourceItem[] = [];
  const sources: SourceStatus[] = [];

  for (const adapter of deps.adapters) {
    try {
      const collected = await adapter.collect();
      items.push(...collected);
      sources.push({
        source: adapter.id,
        ok: true,
        // Filled in below, once extraction has decided what counts as evidence.
        evidenceCount: 0,
        communitiesCovered: new Set(collected.map((i) => i.community)).size,
        rejections: adapter.rejections?.() ?? 0,
        error: null,
      });
    } catch (error) {
      sources.push({
        source: adapter.id,
        ok: false,
        evidenceCount: 0,
        communitiesCovered: 0,
        rejections: adapter.rejections?.() ?? 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const evidence = buildEvidence(items, deps.dictionary);

  // Report the evidence actually produced per source, not the items swept, so
  // the figures reconcile against what was published.
  for (const status of sources) {
    if (!status.ok) continue;
    status.evidenceCount = evidence.filter((record) => record.source === status.source).length;
  }

  const everySourceFailed = sources.length > 0 && sources.every((status) => !status.ok);
  if (everySourceFailed) {
    throw new AllSourcesFailedError({
      startedAt,
      finishedAt: deps.now(),
      ok: false,
      sources,
      games: 0,
      evidence: 0,
      corpusBytes: 0,
    });
  }

  const games = await enrichGames(evidence, deps.enrich);

  // The all-sources-failed guard above is not enough on its own: one source
  // reporting success with nothing usable satisfies it while still producing a
  // corpus with no games, which then replaces a good one. Publishing is the
  // destructive step, so the floor belongs here rather than in each adapter —
  // this covers sources that do not exist yet.
  if (games.length === 0) {
    throw new AllSourcesFailedError(
      {
        startedAt,
        finishedAt: deps.now(),
        ok: false,
        sources,
        games: 0,
        evidence: evidence.length,
        corpusBytes: 0,
      },
      'Run produced no games; refusing to publish an empty corpus over a good one',
    );
  }

  const corpus = buildCorpus(games, sources, { now: startedAt });
  const published = deps.publish(corpus);

  return {
    startedAt,
    finishedAt: deps.now(),
    ok: true,
    sources,
    games: published.games,
    evidence: corpus.games.reduce((total, game) => total + game.evidence.length, 0),
    corpusBytes: published.bytes,
  };
}
