import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordPublish } from './record-publish.js';
import type { RunReport } from '../src/ingest/report.js';

/**
 * `withPublishOutcome` owns the outcome rule and is covered beside the field it
 * guards, in `src/ingest/report.test.ts`. What is only decidable here is what
 * the CLI does when the file it was pointed at is not a run report — because
 * this step runs with `always()`, so it is reached on exactly the runs where
 * something else has already gone wrong.
 */

function reportAt(contents: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'grs-publish-')), 'run-report.json');
  writeFileSync(path, contents);
  return path;
}

const SWEPT: RunReport = {
  startedAt: '2026-08-01T05:17:00.000Z',
  finishedAt: '2026-08-01T07:44:00.000Z',
  ok: true,
  sources: [],
  games: 120,
  evidence: 4300,
  corpusBytes: 3_598_958,
  publish: 'not_attempted',
};

describe('stamping the publish outcome onto this run report', () => {
  it('records the outcome and leaves the sweep it describes alone', () => {
    const path = reportAt(JSON.stringify(SWEPT));

    expect(recordPublish([path, 'published'])).toBe(0);

    const written = JSON.parse(readFileSync(path, 'utf8')) as RunReport;
    expect(written).toEqual({ ...SWEPT, publish: 'published' });
  });

  it('fails rather than inventing a run that never happened', () => {
    // No report on disk means the sweep never wrote one, or this checkout
    // predates its commit. Either way there is no run here to stamp.
    const missing = join(mkdtempSync(join(tmpdir(), 'grs-publish-')), 'absent.json');

    expect(recordPublish([missing, 'published'])).toBe(1);
  });

  it('fails on a report that is not JSON, without overwriting it', () => {
    const path = reportAt('<!doctype html>not a report');

    expect(recordPublish([path, 'published'])).toBe(1);
    expect(readFileSync(path, 'utf8')).toBe('<!doctype html>not a report');
  });

  it('refuses an outcome outside the closed set and leaves the file untouched', () => {
    // The report is committed to a public repository every run, so a captured
    // wrangler stderr line reaching this argument must not reach the file.
    const path = reportAt(JSON.stringify(SWEPT));
    const before = readFileSync(path, 'utf8');

    expect(recordPublish([path, 'Authentication error [code: 10000] for account 0123456789'])).toBe(1);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('refuses to run at all without both arguments', () => {
    expect(recordPublish([])).toBe(2);
    expect(recordPublish(['data/run-report.json'])).toBe(2);
  });
});
