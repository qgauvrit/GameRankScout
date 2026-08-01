import { describe, it, expect } from 'vitest';
import { checkAdhoc, checkBundle, checkCorpus, checkShell, runSmoke } from './smoke.js';

/**
 * The smoke check is the last thing standing between a broken deploy and a run
 * report that says `published`, and every failure it exists to catch arrives
 * looking like a success — `not_found_handling` is `single-page-application`,
 * so a missing asset is served as 200 with the app shell.
 *
 * So the stub below is not a bag of canned responses: it is that fallback. Any
 * path it was not given comes back as the shell, exactly as the deployment
 * would serve it. A check that only reads statuses passes against this stub for
 * every case here, which is the point.
 */

const GENERATED_AT = '2026-08-01T07:44:00.000Z';
const BUNDLE = '/assets/index-B3KZF911.js';

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

const SHELL = `<!doctype html><html><body><div id="root"></div><script type="module" crossorigin src="${BUNDLE}"></script></body></html>`;

function corpus(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ schemaVersion: 3, generatedAt: GENERATED_AT, games: [{ id: 'x' }], ...overrides });
}

interface Route {
  body: string;
  status?: number;
  headers?: Record<string, string>;
}

/** A deployment that serves what it was given and the shell for everything else. */
function deployment(routes: Record<string, Route>): typeof fetch {
  const withFallback: Record<string, Route> = {
    '/': { body: SHELL, headers: SECURITY_HEADERS },
    [BUNDLE]: { body: 'import{a}from"./chunk.js";', headers: { 'content-type': 'text/javascript' } },
    '/corpus.json': { body: corpus(), headers: { 'content-type': 'application/json' } },
    '/adhoc': {
      body: JSON.stringify({ error: 'invalid_community', detail: 'nope' }),
      status: 400,
      headers: { 'content-type': 'application/json' },
    },
    ...routes,
  };

  return (async (input: URL | string) => {
    const route = withFallback[new URL(String(input)).pathname];
    // The SPA fallback: an asset that is not in the deployed set is not a 404.
    const served: Route = route ?? { body: SHELL, headers: SECURITY_HEADERS };
    return new Response(served.body, { status: served.status ?? 200, headers: served.headers });
  }) as typeof fetch;
}

const ORIGIN = 'https://gamerankscout.example.workers.dev';

describe('checking that the deploy under test is the one that answered', () => {
  it('accepts the corpus this run built', async () => {
    await expect(
      checkCorpus(ORIGIN, GENERATED_AT, { fetchImpl: deployment({}) }),
    ).resolves.toBeUndefined();
  });

  it('refuses a deployment still serving the previous corpus', async () => {
    // A deploy that uploaded but never took effect leaves every other check
    // green: the shell loads, the bundle loads, /adhoc answers, and the corpus
    // is a perfectly valid corpus. Only its age gives it away.
    const previous = deployment({
      '/corpus.json': { body: corpus({ generatedAt: '2026-07-31T05:20:00.000Z' }) },
    });

    await expect(checkCorpus(ORIGIN, GENERATED_AT, { fetchImpl: previous })).rejects.toThrow(
      /2026-07-31T05:20:00.000Z.*did not take effect/s,
    );
  });

  it('refuses a corpus that carries no timestamp at all', async () => {
    const untimestamped = deployment({ '/corpus.json': { body: corpus({ generatedAt: undefined }) } });

    await expect(checkCorpus(ORIGIN, GENERATED_AT, { fetchImpl: untimestamped })).rejects.toThrow(
      /did not take effect/,
    );
  });
});

describe('refusing the shell served in place of an asset', () => {
  it('catches a corpus missing from the deployed asset set', async () => {
    // 200, with HTML. The status says nothing; the parse is the assertion.
    const missing = deployment({ '/corpus.json': { body: SHELL } });

    await expect(checkCorpus(ORIGIN, GENERATED_AT, { fetchImpl: missing })).rejects.toThrow(
      /not in the deployed asset set/,
    );
  });

  it('catches a site whose JavaScript never loads', async () => {
    const missing = deployment({ [BUNDLE]: { body: SHELL } });

    await expect(checkBundle(ORIGIN, { fetchImpl: missing })).rejects.toThrow(
      /the bundle is not in the deployed asset set/,
    );
  });

  it('catches a shell with no module script to load at all', async () => {
    const empty = deployment({ '/': { body: '<!doctype html><div id="root"></div>', headers: SECURITY_HEADERS } });

    await expect(checkBundle(ORIGIN, { fetchImpl: empty })).rejects.toThrow(/no module script/);
  });
});

describe('checking the surface the deploy is supposed to expose', () => {
  it('catches _headers being ignored by the asset handler', async () => {
    const bare = deployment({ '/': { body: SHELL, headers: { 'x-content-type-options': 'nosniff' } } });

    await expect(checkShell(ORIGIN, { fetchImpl: bare })).rejects.toThrow(
      /content-security-policy.*_headers was not applied/s,
    );
  });

  it('catches /adhoc being served as a static asset instead of routed to the Worker', async () => {
    // run_worker_first no longer matching is total: every path falls through to
    // the asset store, so /adhoc comes back as the shell with a 200.
    const unrouted = deployment({ '/adhoc': { body: SHELL } });

    await expect(checkAdhoc(ORIGIN, { fetchImpl: unrouted })).rejects.toThrow(
      /returned 200, expected 400 — the path may be served as a static asset/,
    );
  });

  it('catches the identifier rules not surviving the deploy', async () => {
    const permissive = deployment({
      '/adhoc': { body: JSON.stringify({ error: 'upstream_failed' }), status: 400 },
    });

    await expect(checkAdhoc(ORIGIN, { fetchImpl: permissive })).rejects.toThrow(
      /rejected the identifier as "upstream_failed"/,
    );
  });
});

describe('the run as a whole', () => {
  // Retries are what make a slow deploy pass rather than record a false
  // failure, so they are real in the job and skipped here — the backoff is
  // seconds per attempt and none of these failures are transient.
  const once = <T,>(_what: string, run: () => Promise<T>) => run();

  it('passes against a deployment serving exactly what this run built', async () => {
    expect(await runSmoke(ORIGIN, GENERATED_AT, { fetchImpl: deployment({}) }, once)).toEqual([]);
  });

  it('reports every broken surface, not only the first', async () => {
    const wrecked = deployment({
      '/corpus.json': { body: SHELL },
      '/adhoc': { body: SHELL },
    });

    const failures = await runSmoke(ORIGIN, GENERATED_AT, { fetchImpl: wrecked }, once);

    expect(failures).toHaveLength(2);
    expect(failures.join('\n')).toMatch(/corpus/);
    expect(failures.join('\n')).toMatch(/adhoc/);
  });

  it('reports an empty corpus as a failure rather than a quiet week', async () => {
    const empty = deployment({ '/corpus.json': { body: corpus({ games: [] }) } });

    expect(await runSmoke(ORIGIN, GENERATED_AT, { fetchImpl: empty }, once)).toEqual([
      expect.stringMatching(/corpus with no games/),
    ]);
  });
});
