import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  InvalidOutcomeError,
  PUBLISH_OUTCOMES,
  summarizeRunReport,
  withPublishOutcome,
  writeRunReport,
} from './report.js';
import type { RunReport } from './report.js';
import {
  CorpusVersionMismatchError,
  SCHEMA_VERSION,
  assertCorpusVersion,
} from '../corpus/schema.js';

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

describe('pairing a corpus with code that can read it', () => {
  it('accepts a corpus at the version this tree reads', () => {
    expect(assertCorpusVersion(JSON.stringify({ schemaVersion: SCHEMA_VERSION }))).toBe(
      SCHEMA_VERSION,
    );
  });

  it('refuses a corpus from before a schema bump', () => {
    // The publish job builds current code against a corpus the sweep produced
    // hours earlier; a SCHEMA_VERSION bump landing in between is the skew.
    expect(() => assertCorpusVersion(JSON.stringify({ schemaVersion: SCHEMA_VERSION - 1 }))).toThrow(
      CorpusVersionMismatchError,
    );
  });

  it('refuses a corpus with no version at all', () => {
    expect(() => assertCorpusVersion('{}')).toThrow(CorpusVersionMismatchError);
  });
});

describe('the workflow and the enum agree on the outcome names', () => {
  it('records only outcomes the report schema accepts', () => {
    // The recording step moved to `publish.yml` when the publish job became a
    // reusable workflow. The cross-check follows it: `indexOf`/`slice` returns
    // the whole file rather than throwing when the marker is absent, so the
    // length guard below is the only thing standing between a moved step and a
    // test that silently checks nothing.
    const workflow = readFileSync('.github/workflows/publish.yml', 'utf8');
    const block = workflow.slice(workflow.indexOf('Record the publish outcome'));
    const assigned = [...block.matchAll(/outcome=([a-z_]+)/g)].map((match) => match[1]!);

    // Four literals in a bash case statement have to match a TypeScript union.
    // Nothing else connects them, and drift would only surface at deploy time.
    expect(assigned.length).toBeGreaterThan(0);
    for (const outcome of assigned) expect(PUBLISH_OUTCOMES).toContain(outcome);
  });
});
