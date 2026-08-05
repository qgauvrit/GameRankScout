import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Invariants of the ingest workflow that nothing else can catch.
 *
 * A workflow is only exercised by running it, and this one runs once a day and
 * takes two and a quarter hours to reach the steps that matter. Everything
 * checked here has already cost a real run: the stale checkout that made a
 * sweep push against a base it was never on, and the rebase that could not
 * succeed and left the tree looking like a corpus leak.
 *
 * These are string assertions against YAML, which is a blunt instrument. They
 * are here because the alternative is finding out tomorrow morning.
 */

const workflow = readFileSync('.github/workflows/ingest.yml', 'utf8');
const publishWorkflow = readFileSync('.github/workflows/publish.yml', 'utf8');

/** The steps of one named job, up to the start of the next job. */
function job(name: string, source = workflow): string {
  const start = source.indexOf(`\n  ${name}:\n`);
  expect(start, `no ${name} job in the workflow`).toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const next = rest.search(/\n {2}[a-z][a-z-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('both jobs check out the branch tip, not the commit the run was queued on', () => {
  // `github.sha` is the tip as it was when the run was *queued*. The sweep can
  // sit behind another run in the concurrency group and then run for five
  // hours, so by the time either job acts, that commit can be long superseded.
  // For the publish job that would deploy stale code; for the sweep it made the
  // report push fail against a base that was already behind at checkout.
  //
  // The publish job moved to its own workflow so both deploy paths share one
  // definition; the invariant followed it there rather than lapsing.
  for (const [name, source] of [
    ['ingest', workflow],
    ['publish', publishWorkflow],
  ] as const) {
    it(`${name} pins ref to the branch name`, () => {
      const steps = job(name, source);
      const checkout = steps.slice(steps.indexOf('actions/checkout@v4'));

      expect(checkout).toMatch(/ref:\s*\$\{\{\s*github\.ref_name\s*\}\}/);
    });
  }
});

describe('the run report is replayed onto the tip, never rebased onto it', () => {
  const commitStep = (() => {
    const steps = job('ingest');
    return steps.slice(steps.indexOf('Commit run report'), steps.indexOf('Assert no corpus'));
  })();

  it('does not rebase the report commit', () => {
    // The report is a whole-file snapshot of one run, so two runs' reports
    // conflict on every line and no merge of them means anything. A rebase here
    // cannot succeed on merit — it can only fail, and it failed leaving the
    // rebase in progress.
    expect(commitStep).not.toMatch(/--rebase/);
  });

  it('resets to the fetched remote tip before re-applying', () => {
    expect(commitStep).toMatch(/git fetch origin/);
    expect(commitStep).toMatch(/git reset --hard "origin\/\$\{GITHUB_REF_NAME\}"/);
  });

  it('carries this run\'s report across the reset', () => {
    // Without the copy the reset would discard the very thing being pushed and
    // the retry would commit the remote's report back to itself.
    expect(commitStep).toMatch(/cp data\/run-report\.json/);
    expect(commitStep).toMatch(/cp "\$\{RUNNER_TEMP\}\/run-report\.json" data\/run-report\.json/);
  });

  it('still retries more than once', () => {
    // The heartbeat is the point (KTD6); one attempt against a busy branch is
    // not a heartbeat.
    expect(commitStep).toMatch(/for attempt in 1 2 3/);
  });
});

describe('the corpus alarm says what it means', () => {
  const assertStep = (() => {
    const steps = job('ingest');
    return steps.slice(steps.indexOf('Assert no corpus was committed'));
  })();

  it('checks for an interrupted rebase before calling the tree dirty', () => {
    // Conflict markers are "dirty" by every measure this step uses, so without
    // this the corpus-leak alarm fires for a stranded rebase — which is what
    // happened, and the wrong diagnosis cost more than the failure did.
    const rebaseGuard = assertStep.indexOf('.git/rebase-merge');
    const dirtyCheck = assertStep.indexOf('Working tree is dirty');

    expect(rebaseGuard).toBeGreaterThan(-1);
    expect(rebaseGuard).toBeLessThan(dirtyCheck);
  });

  it('still refuses a tracked corpus', () => {
    expect(assertStep).toMatch(/git ls-files --error-unmatch public\/corpus\.json/);
  });
});
