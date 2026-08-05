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

describe('the corpus is chosen by what exists, not by how its run ended', () => {
  const resolveStep = publishWorkflow.slice(
    publishWorkflow.indexOf("Resolve which run's corpus to deploy"),
    publishWorkflow.indexOf('Take the corpus and nothing else'),
  );

  it('does not filter on the producing run\'s conclusion', () => {
    // The proxy this repository already rejected once. `ingest.yml` exposes the
    // sweep *step's* outcome rather than the job's because a run can produce a
    // good corpus and then fail a later step — and publishing is now part of
    // that run, so any publish failure makes the run unsuccessful too. Run
    // 30742723037 is the live proof: it concluded `failure`, and its corpus is
    // the one currently serving production.
    expect(resolveStep).not.toMatch(/conclusion/);
    expect(resolveStep).not.toMatch(/status=completed/);
  });

  it('selects the newest by timestamp rather than by list position', () => {
    // The REST listing is not documented as sorted, so `first` would be
    // trusting an accident that holds until it does not.
    expect(resolveStep).toMatch(/sort_by\(\.created_at\)/);
    expect(resolveStep).toMatch(/\|\s*last\s*\|/);
    expect(resolveStep).not.toMatch(/\|\s*first\s*\|/);
  });

  it('excludes expired artifacts and other branches', () => {
    expect(resolveStep).toMatch(/select\(\.expired == false\)/);
    expect(resolveStep).toMatch(/head_branch ==/);
  });

  it('names retention as the cause when nothing is found, and stops', () => {
    expect(resolveStep).toMatch(/::error::/);
    expect(resolveStep).toMatch(/7 days/);
    expect(resolveStep).toMatch(/exit 1/);
  });

  it('lets a caller-supplied run id bypass the lookup', () => {
    expect(resolveStep).toMatch(/if \[ -n "\$SUPPLIED" \]/);
  });
});

describe('only the corpus leaves the artifact', () => {
  const takeStep = publishWorkflow.slice(
    publishWorkflow.indexOf('Take the corpus and nothing else'),
    publishWorkflow.indexOf('Fetch this run'),
  );

  it('extracts beside the workspace, not into the published asset set', () => {
    // An artifact is a zip whose member paths its producer chooses. Unpacking
    // one into `public/` would put whatever it carries into what
    // `wrangler deploy` publishes.
    expect(publishWorkflow).toMatch(/path: \$\{\{ runner\.temp \}\}\/corpus-artifact/);
  });

  it('refuses an artifact carrying anything but corpus.json', () => {
    expect(takeStep).toMatch(/! -name corpus\.json/);
    expect(takeStep).toMatch(/exit 1/);
  });

  it('does not swallow a find failure into an empty result', () => {
    // `|| true` here would report "nothing unexpected" for a find that errored,
    // waving through the artifact this step exists to inspect.
    const findCall = /unexpected="\$\(find[^\n]*\)"/.exec(takeStep)?.[0] ?? '';

    expect(findCall).not.toBe('');
    expect(findCall).not.toMatch(/\|\| true/);
  });

  it('copies rather than moving the directory into place', () => {
    expect(takeStep).toMatch(/cp "\$src\/corpus\.json" public\/corpus\.json/);
  });
});

describe('a corpus this tree should not publish stops the publish', () => {
  it('bounds how old the deployed ranking may be', () => {
    // The push path deploys whatever the last sweep left, so without this a run
    // of failed sweeps publishes an ever-older ranking and nothing says so.
    const ageStep = publishWorkflow.slice(
      publishWorkflow.indexOf('Refuse a corpus too old'),
      publishWorkflow.indexOf('Refuse a corpus this tree cannot read'),
    );

    expect(ageStep).toMatch(/MAX_AGE_HOURS/);
    expect(ageStep).toMatch(/::error::/);
    expect(ageStep).toMatch(/exit 1/);
  });

  it('tells the reader a schema mismatch is expected and self-resolving', () => {
    // A commit that bumps SCHEMA_VERSION cannot publish until a sweep produces
    // a corpus at the new version. The run is red because there is no neutral
    // conclusion to report, so the message carries the meaning instead.
    const versionStep = publishWorkflow.slice(
      publishWorkflow.indexOf('Refuse a corpus this tree cannot read'),
    );

    expect(versionStep).toMatch(/assert-corpus-version\.ts/);
    expect(versionStep).toMatch(/SCHEMA_VERSION/);
    expect(versionStep).toMatch(/next sweep|next scheduled/i);
  });
});

describe('only the sweep stamps the run report', () => {
  it('declares the recording input as a boolean', () => {
    // A string input makes 'false' truthy in a step `if:`, so the push path
    // would run all three recording steps and then fail the commit under
    // `contents: read` — a confusing way to learn the input was mistyped.
    const inputs = publishWorkflow.slice(
      publishWorkflow.indexOf('record_outcome:'),
      publishWorkflow.indexOf('jobs:'),
    );

    expect(inputs).toMatch(/type: boolean/);
    expect(inputs).toMatch(/default: false/);
  });

  it('gates all three recording steps on it', () => {
    for (const step of ["Fetch this run's report", 'Record the publish outcome', 'Commit the publish outcome']) {
      const at = publishWorkflow.indexOf(step);
      expect(at, `no step named ${step}`).toBeGreaterThan(-1);
      expect(publishWorkflow.slice(at, at + 200)).toMatch(/inputs\.record_outcome/);
    }
  });

  it('keeps always() inside the gate rather than replacing it', () => {
    // always() is there because a failed publish is exactly when the outcome
    // must still be written. Narrowing it would reopen a closed bug.
    for (const step of ['Record the publish outcome', 'Commit the publish outcome']) {
      const at = publishWorkflow.indexOf(step);
      expect(publishWorkflow.slice(at, at + 200)).toMatch(/always\(\) && inputs\.record_outcome/);
    }
  });
});

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
