import { readFileSync, readdirSync } from 'node:fs';

/**
 * Shared reading for the workflow suites.
 *
 * A workflow is only exercised by running it, and these run on a schedule or on
 * a merge — so the suites that guard them assert against YAML text. That is
 * blunt, and it is the price of catching an invariant before the run rather
 * than after the deploy.
 *
 * The slicing lived inside `ingest-workflow.test.ts` while there was one
 * workflow worth guarding. There are now three, and the invariants that matter
 * most are the ones no single file can see.
 */

const DIR = '.github/workflows';

export const workflowNames = (): string[] =>
  readdirSync(DIR)
    .filter((name) => name.endsWith('.yml'))
    .sort();

export const readWorkflow = (name: string): string => readFileSync(`${DIR}/${name}`, 'utf8');

/** Every workflow, as `[filename, source]`. */
export const allWorkflows = (): [string, string][] =>
  workflowNames().map((name) => [name, readWorkflow(name)]);

/**
 * One named job's text, up to the start of the next job.
 *
 * Returns null rather than the whole file when the job is absent. An earlier
 * version returned a slice from -1, which reads as the entire document and
 * makes every assertion against it pass for the wrong reason — that is how a
 * moved step turns a guard green instead of red.
 */
export function job(source: string, name: string): string | null {
  const start = source.indexOf(`\n  ${name}:\n`);
  if (start === -1) return null;
  const rest = source.slice(start + 1);
  const next = rest.search(/\n {2}[a-z][a-z-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

/** One named step's text, up to the start of the next step. */
export function step(source: string, name: string): string | null {
  const start = source.indexOf(`- name: ${name}`);
  if (start === -1) return null;
  const rest = source.slice(start + 1);
  const next = rest.search(/\n {6}- (?:name|uses):/);
  return next === -1 ? rest : rest.slice(0, next);
}

/** The job names declared under `jobs:` in one workflow. */
export function jobNames(source: string): string[] {
  const jobsAt = source.indexOf('\njobs:\n');
  if (jobsAt === -1) return [];
  return [...source.slice(jobsAt).matchAll(/\n {2}([a-z][a-z-]*):\n/g)].map((m) => m[1]!);
}

/**
 * The workflows that call the publish job, as `[filename, callingJob]`.
 *
 * Resolved by walking the declared jobs rather than by one regex spanning from
 * a job header to the `uses:` line. That regex has to express "without crossing
 * into the next job", and the obvious way to write it — a lookahead for two
 * spaces then non-space — also matches every four-space-indented key *inside*
 * the job, so it stopped at the first nested line and found no callers at all.
 */
export function publishCallers(): [string, string][] {
  const callers: [string, string][] = [];
  for (const [name, source] of allWorkflows()) {
    for (const jobName of jobNames(source)) {
      const body = job(source, jobName);
      if (body?.includes('uses: ./.github/workflows/publish.yml')) callers.push([name, body]);
    }
  }
  return callers;
}
