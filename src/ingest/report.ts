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
export interface RunReport {
  startedAt: string;
  finishedAt: string;
  /** False when the run failed to produce a publishable corpus. */
  ok: boolean;
  sources: SourceStatus[];
  games: number;
  evidence: number;
  corpusBytes: number;
}

export function summarizeRunReport(report: RunReport): string {
  const lines = [
    `${report.ok ? 'ok' : 'FAILED'} — ${report.games} games, ${report.evidence} evidence records`,
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
