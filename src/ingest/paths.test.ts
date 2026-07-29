import { describe, it, expect } from 'vitest';
import { runPaths } from './paths.js';

describe('where a run writes', () => {
  it('publishes and reports to the real locations on a live run', () => {
    expect(runPaths(false)).toEqual({
      outDir: 'public',
      reportPath: 'data/run-report.json',
    });
  });

  it('honours the operator overrides the workflow sets', () => {
    expect(
      runPaths(false, { GRS_OUT_DIR: 'dist', GRS_REPORT_PATH: 'tmp/report.json' }),
    ).toEqual({ outDir: 'dist', reportPath: 'tmp/report.json' });
  });

  it('keeps a dry run away from the published corpus and the committed report', () => {
    const paths = runPaths(true);

    expect(paths.outDir).not.toBe('public');
    expect(paths.reportPath).not.toBe('data/run-report.json');
  });

  it('cannot be pointed at a real location even when the environment says so', () => {
    // A dry run collects nothing by construction, so anything it writes is
    // empty; letting an override aim that at `public` would delete the corpus.
    const paths = runPaths(true, { GRS_OUT_DIR: 'public', GRS_REPORT_PATH: 'data/run-report.json' });

    expect(paths.outDir).not.toBe('public');
    expect(paths.reportPath).not.toBe('data/run-report.json');
  });
});
