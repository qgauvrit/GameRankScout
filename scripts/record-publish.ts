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
 * It exists as a script rather than inline `jq` so the report's shape stays
 * owned by `src/ingest/report.ts` and can be tested.
 *
 * The outcome must be one of the closed set. A `wrangler` failure string is
 * rejected rather than stored: this file is committed to a public repository on
 * every run, and a captured stderr line would put account identifiers and
 * internal URLs into permanent history that cannot be retracted.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PUBLISH_OUTCOMES, isPublishOutcome, writeRunReport } from '../src/ingest/report.js';
import type { RunReport } from '../src/ingest/report.js';

export class InvalidOutcomeError extends Error {}

/**
 * Returns the updated report rather than writing it, so the decision and the
 * side effect can be tested apart.
 */
export function withPublishOutcome(report: RunReport, outcome: string): RunReport {
  if (!isPublishOutcome(outcome)) {
    throw new InvalidOutcomeError(
      `Refusing to record "${outcome.slice(0, 40)}": the publish outcome must be one of ` +
        `${PUBLISH_OUTCOMES.join(', ')}. Arbitrary text is not stored — this report is public.`,
    );
  }

  return { ...report, publish: outcome };
}

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
