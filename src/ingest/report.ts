import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { SourceStatus } from '../corpus/schema.js';

/**
 * The record of one ingest run.
 *
 * Deliberately counts and outcomes only — never source content. This file is
 * committed on every run, which is what keeps the schedule alive past the
 * host's 60-day inactivity cutoff (KTD6), so it must stay cheap and must not
 * accumulate anything derived from posts or comments.
 */
/**
 * What became of the deploy that should have followed this run.
 *
 * A closed set, deliberately. The report is committed to a public repository
 * on every run, so a captured `wrangler` error string would put account
 * identifiers and internal URLs into permanent history — the same reasoning
 * that keeps source content out of it.
 *
 * `not_attempted` is distinct from `deploy_failed`: a run whose sweep failed
 * never reached a deploy, and reading those as the same thing would hide the
 * failure this field exists to surface.
 */
export const PUBLISH_OUTCOMES = [
  'not_attempted',
  'published',
  'deploy_failed',
  'smoke_failed',
] as const;
export type PublishOutcome = (typeof PUBLISH_OUTCOMES)[number];

export function isPublishOutcome(value: unknown): value is PublishOutcome {
  return typeof value === 'string' && (PUBLISH_OUTCOMES as readonly string[]).includes(value);
}

export class InvalidOutcomeError extends Error {
  constructor(rejected: string) {
    super(
      `Refusing to record "${rejected.slice(0, 40)}": the publish outcome must be one of ` +
        `${PUBLISH_OUTCOMES.join(', ')}. Arbitrary text is not stored — this report is public.`,
    );
    this.name = 'InvalidOutcomeError';
  }
}

/**
 * Returns the updated report rather than writing it, so the decision and the
 * side effect can be tested apart.
 *
 * This lives here rather than in the script that calls it because it is the
 * `publish` field's invariant, and the field is defined here.
 */
export function withPublishOutcome(report: RunReport, outcome: string): RunReport {
  if (!isPublishOutcome(outcome)) throw new InvalidOutcomeError(outcome);
  return { ...report, publish: outcome };
}

export interface RunReport {
  startedAt: string;
  finishedAt: string;
  /** False when the run failed to produce a publishable corpus. */
  ok: boolean;
  sources: SourceStatus[];
  games: number;
  evidence: number;
  corpusBytes: number;
  /**
   * Written by the ingest as `not_attempted` and overwritten by the publish job
   * once it knows. The ingest cannot know: publishing happens in a later job,
   * after this file has already been written and committed.
   */
  publish: PublishOutcome;
}

export function summarizeRunReport(report: RunReport): string {
  const lines = [
    `${report.ok ? 'ok' : 'FAILED'} — ${report.games} games, ${report.evidence} evidence records`,
    `  publish: ${report.publish}`,
  ];
  for (const source of report.sources) {
    lines.push(
      `  ${source.source.padEnd(7)} ${source.ok ? 'ok    ' : 'FAILED'} ` +
        `${String(source.evidenceCount).padStart(5)} evidence  ` +
        `${String(source.communitiesCovered).padStart(3)} communities  ` +
        `${String(source.rejections).padStart(3)} rejections` +
        (source.error ? `  — ${source.error}` : ''),
    );
  }
  return lines.join('\n');
}

export function writeRunReport(path: string, report: RunReport): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`);
}
