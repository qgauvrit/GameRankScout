import { describe, it, expect } from 'vitest';
import { allWorkflows, job, publishCallers, readWorkflow } from './workflow-helpers.js';

/**
 * The invariants that hold *between* workflows.
 *
 * Two paths now deploy the same site through the same job, and everything that
 * can go wrong between them is invisible from inside any one file: the sweep's
 * caller cannot see the push caller's concurrency group, and neither can see
 * that the reusable workflow is the only place the environment is named.
 *
 * These are the ones a reader of a single file would never think to check.
 */

const publishWorkflow = readWorkflow('publish.yml');

describe('the two publish paths cannot collide', () => {
  it('resolves the callers it is about to iterate', () => {
    // The guard on the guard: every assertion below is a `for` over the callers,
    // and every one of them passes vacuously if the list is empty.
    //
    // Deliberately not "more than one". The recovery path for a misbehaving
    // trigger is to delete `publish-on-push.yml`, and demanding two callers
    // would turn that one-file rollback into a red suite at exactly the moment
    // someone is trying to stop a bad deploy. The sweep is the caller that must
    // always exist.
    const names = publishCallers().map(([name]) => name);

    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('ingest.yml');
  });

  it('makes every caller pass secrets to the reusable workflow', () => {
    // The deploy credential lives on the `production` environment and is read
    // inside `publish.yml`. A called workflow's `secrets` context is sealed:
    // an environment secret referenced there resolves to the empty string
    // unless the caller passes `secrets: inherit`, even though the deploy job
    // names the environment itself. Omit this line and every step upstream of
    // the deploy still passes — the credential simply arrives blank and the
    // deploy fails closed, which is the failure this guard exists to pre-empt.
    for (const [name, body] of publishCallers()) {
      expect(body, `${name} does not pass \`secrets: inherit\` to publish.yml`).toMatch(
        /secrets: inherit/,
      );
    }
  });

  it('puts every caller in the same literal concurrency group', () => {
    const groups = publishCallers().map(([name, body]) => {
      const group = /concurrency:\n\s+group: (\S+)/.exec(body)?.[1];
      return [name, group] as const;
    });

    for (const [name, group] of groups) {
      expect(group, `${name} does not name a concurrency group`).toBe('publish');
      expect(group, `${name} interpolates its group`).not.toMatch(/\$\{\{/);
    }
  });

  it('lets exactly one caller stamp the run report', () => {
    // Two recorders would mean two runs writing the same whole-file snapshot,
    // which is the collision the sweep's own push already learned the hard way.
    const recorders = publishCallers().filter(([, body]) => /record_outcome: true/.test(body));

    expect(recorders).toHaveLength(1);
    expect(recorders[0]![0]).toBe('ingest.yml');
  });

  it('grants write to the recorder and read to everyone else', () => {
    for (const [name, body] of publishCallers()) {
      const records = /record_outcome: true/.test(body);
      const perms = body.slice(body.indexOf('permissions:'));

      expect(perms, `${name} grants no permissions`).toMatch(/contents:/);
      expect(/contents: write/.test(perms), `${name} write grant should be ${records}`).toBe(records);
      // Both need it: the push path to look up a corpus, the sweep for symmetry
      // so the difference that matters is the only difference to read.
      expect(perms, `${name} cannot read actions`).toMatch(/actions: read/);
    }
  });
});

describe('the reusable workflow owns what no caller may redeclare', () => {
  it('names the environment exactly once, in the workflow that deploys', () => {
    expect(publishWorkflow).toMatch(/environment: production/);

    for (const [name, body] of publishCallers()) {
      expect(body, `${name} declares an environment`).not.toMatch(/environment:/);
    }
  });

  it('declares no job-level permissions of its own', () => {
    // A caller's grant is the ceiling for the job it calls, and a called job
    // asking for more is not narrowed — the run fails. A union here would break
    // every caller that granted less than the union.
    const publishJob = job(publishWorkflow, 'publish');

    expect(publishJob).not.toBeNull();
    expect(publishJob!.slice(0, publishJob!.indexOf('steps:'))).not.toMatch(/^\s+permissions:/m);
  });

  it('checks the calling event before any step can reach the credential', () => {
    const publishJob = job(publishWorkflow, 'publish')!;
    const guard = publishJob.indexOf('Refuse an event this workflow does not serve');
    const firstCredentialUse = publishJob.indexOf('DEPLOY_CLOUDFLARE_API_TOKEN');

    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstCredentialUse);
  });
});

describe('nothing fork-influenced can reach the publish job', () => {
  it('has no caller triggered by workflow_run or pull_request_target', () => {
    // The invariant the environment's branch policy cannot enforce: it admits
    // any event whose ref is the default branch, and both of these are. This is
    // the assertion, and the allowlist inside publish.yml is the enforcement —
    // neither alone is enough, because a caller could be added without either.
    for (const [name, source] of allWorkflows()) {
      if (!source.includes('uses: ./.github/workflows/publish.yml')) continue;

      const triggers = source.slice(0, source.indexOf('jobs:'));
      expect(triggers, `${name} is triggered by workflow_run`).not.toMatch(/workflow_run:/);
      expect(triggers, `${name} is triggered by pull_request_target`).not.toMatch(
        /pull_request_target:/,
      );
    }
  });

  it('lists those events nowhere in the allowlist, and lists the real ones', () => {
    // The whole case body, not just its first arm: matching to the first `)`
    // stopped at `schedule|workflow_dispatch|push)` and never saw the rest, so
    // an arm added below it was invisible to the negative assertions.
    const allowlist = /case "\$EVENT" in\n([\s\S]*?)\n\s+esac/.exec(publishWorkflow)?.[1] ?? '';

    expect(allowlist).not.toBe('');
    expect(allowlist).not.toMatch(/workflow_run/);
    expect(allowlist).not.toMatch(/pull_request_target/);

    // Positive too, and asserted against the matching *arm* rather than the
    // case body. Matching the body was itself the bug this pair exists to
    // catch: the `*)` branch's error message names all three events in prose,
    // so deleting `push` from the arm — which breaks the entire feature — left
    // a `\bpush\b` assertion green.
    const admitted = (/case "\$EVENT" in\n\s+([a-z_|]+)\)/.exec(publishWorkflow)?.[1] ?? '').split('|');

    for (const event of ['schedule', 'workflow_dispatch', 'push']) {
      expect(admitted, `${event} is not admitted`).toContain(event);
    }
  });
});

describe('every workflow that deploys or commits pins its checkout', () => {
  // `github.sha` is the tip as it was when the run was *queued*, and both of
  // this repository's incidents came from acting on it hours later.
  //
  // `ci.yml` is exempt by name rather than by pattern: on `pull_request` its
  // ref is a merge ref, which is the correct thing to check out and is not a
  // resolvable branch name. Naming it means adding a fourth workflow does not
  // silently inherit the exemption.
  const EXEMPT = new Set(['ci.yml']);

  it('pins ref on every checkout, not merely the first in each file', () => {
    // Bounded to each step's own `with:` block. Slicing from the first checkout
    // to end of file let one pinned checkout satisfy the assertion for every
    // later unpinned one in the same workflow.
    for (const [name, source] of allWorkflows()) {
      if (EXEMPT.has(name)) continue;

      const checkouts = [
        ...source.matchAll(/uses: actions\/checkout@[^\n]*\n((?:[ ]{8,}[^\n]*\n)*)/g),
      ];

      if (checkouts.length === 0) continue;
      for (const match of checkouts) {
        expect(match[1] ?? '', `${name} has a checkout that does not pin ref`).toMatch(
          /ref:\s*\$\{\{\s*github\.ref_name\s*\}\}/,
        );
      }
    }
  });

  it('exempts only files that exist', () => {
    // An exemption for a renamed file is an exemption that quietly covers
    // nothing, leaving the reader believing a check runs where it does not.
    const present = new Set(allWorkflows().map(([name]) => name));

    for (const name of EXEMPT) expect(present.has(name), `${name} no longer exists`).toBe(true);
  });
});
