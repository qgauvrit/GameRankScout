import { describe, it, expect } from 'vitest';
import { allWorkflows, readWorkflow } from './workflow-helpers.js';

/**
 * Invariants of the publish workflow.
 *
 * Same reasoning as `ingest-workflow.test.ts`: a workflow is only exercised by
 * running it, and this one runs at most once a day until the push path exists.
 * String assertions against YAML are blunt, and they are here because the
 * alternative is finding out after a deploy.
 */

const publishWorkflow = readWorkflow('publish.yml');
const pushWorkflow = readWorkflow('publish-on-push.yml');
const ingestWorkflow = readWorkflow('ingest.yml');

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

describe('the push path publishes without waiting for a sweep', () => {
  it('fires only on the default branch, never on tags', () => {
    // A bare `push:` also fires on tags, and a tag publish would deploy
    // whatever commit it points at with no relation to what is on main.
    expect(pushWorkflow).toMatch(/push:\n\s+branches: \[main\]/);
  });

  it('grants no write, because it commits nothing', () => {
    // The caller's grant is the ceiling for the job it calls, so this is the
    // control rather than a description of one.
    const perms = pushWorkflow.slice(pushWorkflow.indexOf('permissions:'));

    expect(perms).toMatch(/contents: read/);
    expect(perms).not.toMatch(/contents: write/);
  });

  it('asks the publish job to find its own corpus and record nothing', () => {
    expect(pushWorkflow).toMatch(/corpus_run_id: ''/);
    expect(pushWorkflow).toMatch(/record_outcome: false/);
  });

  it('shares the sweep\'s literal concurrency group', () => {
    // Not interpolated: inside a reusable workflow `github.workflow` resolves
    // to the caller's name, so an interpolation would produce two groups and
    // the two paths would race.
    // Sliced from the publish job in each file: `ingest.yml` also carries a
    // workflow-level `concurrency: ingest`, and matching that instead would
    // make this assertion pass for the wrong reason.
    const callers = [pushWorkflow, ingestWorkflow.slice(ingestWorkflow.indexOf('\n  publish:'))];

    for (const caller of callers) {
      const group = /concurrency:\n\s+group: (\S+)/.exec(caller)?.[1];
      expect(group).toBe('publish');
    }
  });

  it('records why the sweep must keep pushing with GITHUB_TOKEN', () => {
    // Load-bearing and invisible: commits pushed with GITHUB_TOKEN create no
    // workflow runs, which is the only reason the sweep's own report commits do
    // not each trigger a publish. Swapping in a PAT to satisfy a ruleset would
    // silently start firing one per sweep.
    // Scoped to the comment block above the push step. The previous form was
    // `pushStep.slice(0, 0) + ingestWorkflow` — the empty string plus the entire
    // file — so it asserted the text existed *somewhere*, and would have passed
    // with the rationale sitting in a completely unrelated step.
    const rationale = ingestWorkflow.slice(
      ingestWorkflow.indexOf('This push must keep using'),
      ingestWorkflow.indexOf('- name: Commit run report'),
    );

    expect(rationale).not.toBe('');
    expect(rationale).toMatch(/do not create workflow runs/);
    expect(rationale).toMatch(/bypass actor/);
  });
});

describe('a compromised action tag cannot reach the deploy credential', () => {
  // Tag pinning is not a control: the 2025 tj-actions/changed-files compromise
  // moved every tag from v1 through v45 onto one malicious commit. This branch
  // makes a job holding the deploy credential reachable by merging a pull
  // request rather than only by cron, which raises what that would reach.
  const workflows = allWorkflows();

  /** Exact paths, not a prefix — a loose carve-out is how a real action gets in. */
  const LOCAL = ['./.github/workflows/publish.yml'];

  it('pins every third-party action to a full commit SHA', () => {
    for (const [name, source] of workflows) {
      for (const match of source.matchAll(/uses: (\S+)/g)) {
        const ref = match[1]!;
        const pinned = /^[^@]+@[0-9a-f]{40}$/.test(ref);
        expect(pinned || LOCAL.includes(ref), `${name}: unpinned \`uses: ${ref}\``).toBe(true);
      }
    }
  });

  it('actually covers some third-party action', () => {
    // Without this, a future loosening could reduce the rule above to covering
    // nothing while staying green — the shape of the one-file fixture check
    // recorded in docs/solutions/security-issues/.
    const shaPinned = workflows.flatMap(([, source]) =>
      [...source.matchAll(/uses: (\S+@[0-9a-f]{40})/g)].map((m) => m[1]!),
    );

    expect(shaPinned.length).toBeGreaterThan(0);
  });

  it('keeps the readable version beside each pin', () => {
    // A bare SHA is unreviewable and never gets updated. The trailing comment
    // is what makes the pin legible enough to maintain.
    for (const [name, source] of workflows) {
      for (const match of source.matchAll(/uses: \S+@[0-9a-f]{40}[^\n]*/g)) {
        expect(match[0], `${name}: pin without a version comment`).toMatch(/# v\d+\.\d+\.\d+/);
      }
    }
  });

  it('pins download-artifact to a release that carries run-id', () => {
    // The cross-run corpus lookup depends on that input, which arrived partway
    // through v4. An earlier SHA would silently remove the mechanism.
    const pin = /actions\/download-artifact@[0-9a-f]{40} # v(\d+)\.(\d+)\.(\d+)/.exec(publishWorkflow);

    expect(pin).not.toBeNull();
    const [major, minor] = [Number(pin![1]), Number(pin![2])];
    expect(major > 4 || (major === 4 && minor >= 1)).toBe(true);
  });
});

describe('the deploy identity reaches the check that uses it', () => {
  it('stamps between the build and the deploy', () => {
    // Written into `dist/`, so before the build it would be overwritten and
    // after the deploy it would never be uploaded. Either way the identity
    // check would compare against something the deployment does not serve.
    const build = publishWorkflow.indexOf('- name: Build');
    const stamp = publishWorkflow.indexOf('- name: Stamp the build');
    const deploy = publishWorkflow.indexOf('- name: Deploy');

    expect(build).toBeGreaterThan(-1);
    expect(stamp).toBeGreaterThan(build);
    expect(deploy).toBeGreaterThan(stamp);
  });

  it('passes all four identities to the smoke check', () => {
    // Dropping an argument leaves the suite green and surfaces only as smoke.ts
    // exiting 2 at deploy time — the same shape as a check wired to nothing,
    // which runSmoke's own coverage guards against internally but not here.
    const invocation = /npx tsx scripts\/smoke\.ts[^\n]*/.exec(publishWorkflow)?.[0] ?? '';

    expect(invocation).not.toBe('');
    for (const arg of ['"$DEPLOY_ORIGIN"', '"$generated_at"', '"$bundle"', '"$EXPECTED_COMMIT"']) {
      expect(invocation, `smoke.ts is not passed ${arg}`).toContain(arg);
    }
  });

  it('stamps from the checked-out commit, not the queued one', () => {
    const stampStep = publishWorkflow.slice(
      publishWorkflow.indexOf('- name: Stamp the build'),
      publishWorkflow.indexOf('- name: Upload the built site'),
    );

    expect(stampStep).not.toBe('');
    expect(stampStep).toMatch(/git rev-parse HEAD/);
    expect(stampStep).not.toMatch(/GITHUB_SHA/);
  });
});

describe('the corpus resolver trusts provenance, not a branch name', () => {
  it('requires the artifact to come from this repository', () => {
    // A fork's default branch is also called `main`, so `head_branch` alone is
    // a filter the fork controls — and these bytes are deployed to the public
    // site. Nothing produces a corpus artifact from a fork today; this makes
    // that an enforced rule rather than an accident of which workflows exist.
    const resolveStep = publishWorkflow.slice(
      publishWorkflow.indexOf("Resolve which run's corpus to deploy"),
      publishWorkflow.indexOf('Fetch the corpus to deploy'),
    );

    expect(resolveStep).toMatch(/head_repository_id == \.workflow_run\.repository_id/);
  });
});

describe('the age gate cannot pass by failing to parse', () => {
  const ageStep = publishWorkflow.slice(
    publishWorkflow.indexOf('Refuse a corpus too old'),
    publishWorkflow.indexOf('Refuse a corpus this tree cannot read'),
  );

  it('parses the timestamp in its own assignment', () => {
    // Inline in the arithmetic, an unparseable timestamp makes `date` print
    // nothing, `$(( ))` errors *without* aborting under `set -e`, age_hours
    // ends up empty, and `[ "" -gt 72 ]` is false — so the gate passed having
    // refused nothing. Reproduced before this was changed.
    expect(ageStep).toMatch(/if ! generated_epoch="\$\(date -u -d "\$generated_at" \+%s\)"/);
    expect(ageStep).not.toMatch(/\$\(\( \( \$\(date -u \+%s\) - \$\(date/);
  });

  it('names the unparseable case rather than falling through', () => {
    const guard = ageStep.slice(ageStep.indexOf('if ! generated_epoch'));

    expect(guard).toMatch(/::error::/);
    expect(guard.slice(0, guard.indexOf('age_hours='))).toMatch(/exit 1/);
  });
});
