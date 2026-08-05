import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Invariants of the publish workflow.
 *
 * Same reasoning as `ingest-workflow.test.ts`: a workflow is only exercised by
 * running it, and this one runs at most once a day until the push path exists.
 * String assertions against YAML are blunt, and they are here because the
 * alternative is finding out after a deploy.
 */

const publishWorkflow = readFileSync('.github/workflows/publish.yml', 'utf8');

describe('the publish outcome is replayed onto the tip, never rebased onto it', () => {
  const commitStep = publishWorkflow.slice(publishWorkflow.indexOf('Commit the publish outcome'));

  it('does not rebase the outcome commit', () => {
    // The same fault the sweep's own report push had, in the same file, for the
    // same reason: `data/run-report.json` is a whole-file snapshot of one run,
    // so two writers conflict on every line and no merge of them means
    // anything. It survived here because the sweep's copy was the one that
    // failed in production first.
    expect(commitStep).not.toMatch(/--rebase/);
  });

  it('resets to the fetched remote tip before re-applying', () => {
    expect(commitStep).toMatch(/git fetch "\$remote"/);
    expect(commitStep).toMatch(/git reset --hard FETCH_HEAD/);
  });

  it("carries this run's outcome across the reset", () => {
    // Without the copy the reset discards the very thing being pushed, and the
    // retry commits the remote's report back to itself.
    expect(commitStep).toMatch(/cp data\/run-report\.json/);
    expect(commitStep).toMatch(/cp "\$\{RUNNER_TEMP\}\/run-report\.json" data\/run-report\.json/);
  });

  it('keeps the token out of every git transcript it retries through', () => {
    // Each git call in this step is piped through the same redaction. The pipe
    // is why the step sets `shell: bash` — without pipefail the step would take
    // sed's exit status and every push would look successful.
    const gitCalls = commitStep.match(/git (?:push|fetch) [^\n]*/g) ?? [];

    expect(gitCalls.length).toBeGreaterThan(0);
    for (const call of gitCalls) expect(call).toMatch(/sed "s\/\$\{GH_TOKEN\}\/\*\*\*\/g"/);
  });
});
