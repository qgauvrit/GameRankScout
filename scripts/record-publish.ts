/**
 * Records what became of the deploy in the run report the sweep already wrote.
 *
 * The ingest cannot record this itself: it writes and commits its report at the
 * end of the sweep, and publishing happens afterwards in a separate job, from a
 * fresh checkout (see the publish job in `.github/workflows/ingest.yml`). So the
 * outcome arrives here instead.
 *
 *   tsx scripts/record-publish.ts data/run-report.json published
 *
 * It is a thin CLI over `withPublishOutcome`: the report's shape and the
 * closed set of outcomes are owned by `src/ingest/report.ts`, alongside the
 * field they describe.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withPublishOutcome, writeRunReport } from '../src/ingest/report.js';
import type { RunReport } from '../src/ingest/report.js';

function main(argv: string[]): void {
  const [path, outcome] = argv;

  if (!path || !outcome) {
    console.error('usage: record-publish <report-path> <outcome>');
    process.exit(2);
  }

  const absolute = resolve(path);
  let report: RunReport;
  try {
    report = JSON.parse(readFileSync(absolute, 'utf8')) as RunReport;
  } catch (error) {
    // A missing report means the sweep never wrote one or the checkout predates
    // its commit. Writing a fresh one here would invent a run that did not
    // happen, so this fails instead.
    console.error(`::error::Cannot read the run report at ${path}: ${(error as Error).message}`);
    process.exit(1);
  }

  try {
    writeRunReport(absolute, withPublishOutcome(report, outcome));
  } catch (error) {
    console.error(`::error::${(error as Error).message}`);
    process.exit(1);
  }

  console.log(`Recorded publish outcome: ${outcome}`);
}

// Only run when invoked directly, so the suite can import the pure function.
if (process.argv[1] && resolve(process.argv[1]).endsWith('record-publish.ts')) {
  main(process.argv.slice(2));
}
