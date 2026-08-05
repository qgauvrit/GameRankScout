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
  it('has more than one caller, so these assertions mean something', () => {
    // The guard on the guard: every assertion below is a `for` over the callers,
    // and every one of them passes vacuously if the list is empty.
    expect(publishCallers().length).toBeGreaterThan(1);
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

  it('lists those events nowhere in the allowlist', () => {
    const allowlist = /case "\$EVENT" in\n\s+([^)]+)\)/.exec(publishWorkflow)?.[1] ?? '';

    expect(allowlist).not.toBe('');
    expect(allowlist).not.toMatch(/workflow_run/);
    expect(allowlist).not.toMatch(/pull_request_target/);
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

  it('pins ref wherever a checkout is followed by a deploy or a push', () => {
    for (const [name, source] of allWorkflows()) {
      if (EXEMPT.has(name)) continue;
      if (!/uses: actions\/checkout@/.test(source)) continue;

      const at = source.search(/uses: actions\/checkout@/);
      expect(source.slice(at), `${name} does not pin its checkout ref`).toMatch(
        /ref:\s*\$\{\{\s*github\.ref_name\s*\}\}/,
      );
    }
  });

  it('exempts only files that exist', () => {
    // An exemption for a renamed file is an exemption that quietly covers
    // nothing, leaving the reader believing a check runs where it does not.
    const present = new Set(allWorkflows().map(([name]) => name));

    for (const name of EXEMPT) expect(present.has(name), `${name} no longer exists`).toBe(true);
  });
});
