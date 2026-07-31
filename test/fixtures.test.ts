import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

/**
 * Fixtures are recordings of real source payloads, committed to a repository
 * that is public. The plan's fixture constraint is that they carry the
 * structural shape the parsers need and nothing that identifies a person.
 *
 * This existed only inside the extraction precision suite, checking one JSON
 * file. Three real Reddit usernames were sitting in a committed XML fixture the
 * whole time — caught by a scan run minutes before the repository went public,
 * not by the suite. Checking every fixture is the version that would have
 * caught it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, 'fixtures');

function everyFixture(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? everyFixture(path) : [path];
  });
}

const files = everyFixture(fixturesDir);

describe('committed fixtures', () => {
  it('finds the fixtures it is meant to be checking', () => {
    // A glob that silently matched nothing would make everything below vacuous.
    expect(files.length).toBeGreaterThan(8);
  });

  it('carries no author identity', () => {
    const leaks: string[] = [];
    for (const file of files) {
      const raw = readFileSync(file, 'utf8');
      for (const match of raw.matchAll(/\/u\/[A-Za-z0-9_-]+/g)) {
        if (match[0] !== '/u/redacted') leaks.push(`${file}: ${match[0]}`);
      }
      // Lemmy and itch name authors without the /u/ prefix.
      for (const match of raw.matchAll(/"(?:creator|author|username)"\s*:\s*"([^"]+)"/g)) {
        if (match[1] !== 'redacted') leaks.push(`${file}: ${match[0]}`);
      }
    }

    expect(leaks).toEqual([]);
  });

  it('carries no credential-shaped material', () => {
    const suspicious: string[] = [];
    for (const file of files) {
      const raw = readFileSync(file, 'utf8');
      for (const pattern of [/api[_-]?key/i, /bearer\s+[A-Za-z0-9._-]{10,}/i, /ghp_[A-Za-z0-9]{20,}/]) {
        if (pattern.test(raw)) suspicious.push(`${file}: ${pattern}`);
      }
    }

    expect(suspicious).toEqual([]);
  });
});
