import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  InvalidOutcomeError,
  summarizeRunReport,
  withPublishOutcome,
  writeRunReport,
} from './report.js';
import type { RunReport } from './report.js';

/**
 * The run report is committed to a public repository on every run (KTD6), so
 * these cover two things at once: that the publish outcome round-trips, and
 * that nothing outside the closed set can reach the file.
 */

function report(overrides: Partial<RunReport> = {}): RunReport {
  return {
    startedAt: '2026-08-01T05:17:00.000Z',
    finishedAt: '2026-08-01T07:44:00.000Z',
    ok: true,
    sources: [],
    games: 120,
    evidence: 4300,
    corpusBytes: 3_598_958,
    publish: 'not_attempted',
    ...overrides,
  };
}

describe('recording the publish outcome', () => {
  it('round-trips a successful publish through the file', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'grs-report-')), 'run-report.json');
    writeRunReport(path, withPublishOutcome(report(), 'published'));

    const written = JSON.parse(readFileSync(path, 'utf8')) as RunReport;
    expect(written.publish).toBe('published');
  });

  it('distinguishes a failed deploy from one that never ran', () => {
    expect(withPublishOutcome(report(), 'deploy_failed').publish).toBe('deploy_failed');
    expect(withPublishOutcome(report(), 'smoke_failed').publish).toBe('smoke_failed');
    // The default the ingest writes: the sweep failed, so no deploy was reached.
    expect(report().publish).toBe('not_attempted');
  });

  it('refuses a raw wrangler error instead of storing it', () => {
    const stderr =
      'Authentication error [code: 10000] for account 0123456789abcdef at https://api.cloudflare.com/...';

    expect(() => withPublishOutcome(report(), stderr)).toThrow(InvalidOutcomeError);
  });

  it('leaves the file untouched when the outcome is rejected', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'grs-report-')), 'run-report.json');
    writeRunReport(path, report());
    const before = readFileSync(path, 'utf8');

    expect(() => writeRunReport(path, withPublishOutcome(report(), 'ghp_leaked'))).toThrow();

    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('changes nothing but the publish field', () => {
    const original = report({ games: 7 });
    const updated = withPublishOutcome(original, 'published');

    expect({ ...updated, publish: original.publish }).toEqual(original);
  });

  it('renders each outcome distinguishably in the log summary', () => {
    expect(summarizeRunReport(report({ publish: 'published' }))).toContain('publish: published');
    expect(summarizeRunReport(report({ publish: 'deploy_failed' }))).toContain(
      'publish: deploy_failed',
    );
    expect(summarizeRunReport(report())).toContain('publish: not_attempted');
  });
});
