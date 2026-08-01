---
title: Real usernames survived in committed fixtures because the sanitisation check covered one file
date: 2026-08-01
category: security-issues
module: test-fixtures
problem_type: security_issue
component: testing_framework
symptoms:
  - Three real Reddit usernames sat in a committed XML fixture, found by a pre-publication scan rather than by the test suite
  - The suite was green the whole time the leak was present
  - "A fixture carrying `/user/name` in the profile URI passed a check that only looked at `/u/name`"
root_cause: missing_validation
resolution_type: test_fix
severity: high
related_components:
  - tooling
tags: [fixtures, sanitisation, pii, public-repository, vitest, reddit]
---

# Real usernames survived in committed fixtures because the sanitisation check covered one file

## Problem

Fixtures in this repository are recordings of real source payloads. The plan's fixture constraint requires stripping author names "since that repository may become public" ([the plan, line 380](../../../docs/plans/2026-07-28-001-feat-gamerankscout-plan.md#L380)). A check enforcing that existed — but it read exactly one JSON file, so the committed XML recordings were never covered. Three real Reddit usernames were caught by a scan run minutes before the repository went public, not by the suite that was supposed to be guarding this.

## Symptoms

- A pre-publication scan reported three real Reddit usernames in a committed XML fixture.
- `npm test` was green throughout — nothing in the suite read that file.
- After the check was broadened, a second gap appeared: Reddit names an author twice per entry, and the first version of the check matched only the display-name form.

## What Didn't Work

- **A sanitisation assertion living inside a feature suite.** The only prior enforcement was the comment in [`src/extract/precision.test.ts:11`](../../../src/extract/precision.test.ts#L11) describing its fixture as "author-stripped" — a property of the one path that suite resolves (`test/fixtures/extract/labelled-comments.json`). It never had a reason to look at `test/fixtures/reddit/*.xml`, `test/fixtures/itch/newest.xml`, or anything else. A guarantee scoped to the file a test happens to load is not a repository-wide guarantee, and reads like one.

- **Matching one of the two shapes an author name takes.** The first broadened version scanned for `/u/[A-Za-z0-9_-]+`. Reddit's Atom feed names the author twice per entry — `/u/name` in `<name>` and `/user/name` in `<uri>` (visible in [`test/fixtures/reddit/top-year.xml`](../../../test/fixtures/reddit/top-year.xml)) — so a fixture with the display name redacted and the profile URI left intact would have passed. Fixed in a follow-up (`696219a`) by matching `/u(?:ser)?/`.

- **Redacting in a follow-up commit.** Not viable for data already committed: a new commit removes the name from the tip and leaves it in history, which is exactly what a public repository exposes. The names do not appear as a diff in the fixing commit (`0b7a6ee` touched no fixture file), and scanning every reachable commit for author names under `test/fixtures` now returns only `/u/redacted` and `/user/redacted` — the redaction was applied by rewriting the commit that introduced the fixture, before the repository was published.

## Solution

Three changes, none of which work alone.

**1. A suite that walks every committed fixture**, rather than asserting about the one file a feature test loads — [`test/fixtures.test.ts`](../../../test/fixtures.test.ts):

```ts
function everyFixture(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? everyFixture(path) : [path];
  });
}
```

**2. Both id spaces, plus the sources that don't use a prefix at all** ([`test/fixtures.test.ts:43`](../../../test/fixtures.test.ts#L43)):

```ts
// Reddit names an author twice per entry and in two shapes: `/u/name` in
// the display name and `/user/name` in the profile URI.
for (const match of raw.matchAll(/\/u(?:ser)?\/[A-Za-z0-9_-]+/g)) {
  if (!/\/u(?:ser)?\/redacted$/.test(match[0])) leaks.push(`${file}: ${match[0]}`);
}
// Lemmy and itch name authors without the /u/ prefix.
for (const match of raw.matchAll(/"(?:creator|author|username)"\s*:\s*"([^"]+)"/g)) {
  if (match[1] !== 'redacted') leaks.push(`${file}: ${match[0]}`);
}
```

A companion check for credential-shaped material (`api_key`, `bearer …`, `ghp_…`) runs over the same file list ([`test/fixtures.test.ts:55`](../../../test/fixtures.test.ts#L55)).

**3. Widening the vitest `include`.** The new suite lives at `test/`, outside every pattern the config carried, so without this it would have been a file that ran nowhere ([`vite.config.ts:38`](../../../vite.config.ts#L38)):

```ts
include: [
  'src/**/*.test.ts',
  'src/**/*.test.tsx',
  'worker/**/*.test.ts',
  // The fixtures themselves are checked for anything that should not be in
  // a public repository, so this pattern has to reach outside src/.
  'test/**/*.test.ts',
],
```

The suite also asserts it found something to check ([`test/fixtures.test.ts:31`](../../../test/fixtures.test.ts#L31)):

```ts
it('finds the fixtures it is meant to be checking', () => {
  // A glob that silently matched nothing would make everything below vacuous.
  expect(files.length).toBeGreaterThan(8);
});
```

Verified by planting a leak and watching the suite fail, then removing it.

## Why This Works

The original check's scope was implicit — it was a property the precision suite needed for its own fixture, and it enforced exactly that. Nothing connected it to the repository-wide constraint it appeared to satisfy, so every fixture added afterwards silently fell outside it. Making the file list the *subject* of the test rather than an input to it inverts that: a new fixture is covered the moment it is committed, without anyone remembering to extend anything.

The `files.length` assertion matters for the same reason. Every other assertion in the suite is of the form "no bad thing found across this list" — vacuously true if the list is empty, which is exactly what a moved directory or a wrong `resolve` produces. A gate that passes when it is looking at nothing is the failure mode that let the original leak run for days.

## Prevention

- **Enforce repository-wide constraints with a suite whose subject is the whole surface.** When a rule is "no committed file may contain X", the test must enumerate files, not assert about one. `everyFixture` walking `test/fixtures/` is that shape.
- **Assert the enumeration is non-empty.** Any test built on "nothing bad in this list" needs a companion assertion that the list is populated, or a path change turns the gate off silently.
- **Enumerate every shape an identifier takes in the payload, not the first one you see.** Reddit's Atom feed carries the author twice; Lemmy and itch use bare `creator`/`author`/`username` JSON keys. One regex per source shape, not one regex.
- **Treat a leak in committed data as a history problem, not a tip problem.** Redacting forward leaves the value reachable. Rewrite the introducing commit before the repository is published — and note that this option disappears the moment it is.
- **A new test directory needs a matching `include` pattern.** Confirm the file actually runs (`npx vitest run <path>` reports the test count) rather than assuming the runner picked it up.

## Related Issues

- [The plan's fixture constraint](../../../docs/plans/2026-07-28-001-feat-gamerankscout-plan.md#L380) — sanitise on capture, keep structural shape, strip author names.
- KTD11 in [the plan](../../../docs/plans/2026-07-28-001-feat-gamerankscout-plan.md#L284) — the corpus stores references, not reproductions. The fixture rule is the same principle applied to committed test data.
- `801355f` — made CI run the suite on every push, which is what gives this check its teeth.
