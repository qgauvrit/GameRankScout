import { describe, it, expect } from 'vitest';
import {
  SmokeFailure,
  checkAdhoc,
  checkBundle,
  checkCorpus,
  checkShell,
  checkVersion,
  runSmoke,
  withRetry,
} from './smoke.js';

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
const COMMIT = '1f3c9a27b4e6d5081c2a7f93be04d615a8c7e2b9';
/**
 * What this run published: its data, its code, and the commit both came from.
 * The third exists because the first two only discriminate when that thing
 * changed, and a code-triggered publish can change neither.
 */
const EXPECTED = { generatedAt: GENERATED_AT, bundle: BUNDLE, commit: COMMIT };

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
    '/version.json': {
      body: JSON.stringify({ commit: COMMIT, runId: '42', builtAt: GENERATED_AT }),
      headers: { 'content-type': 'application/json' },
    },
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

describe('the identity check that works when nothing about the payload changed', () => {
  it('accepts the commit this run deployed', async () => {
    await expect(
      checkVersion(ORIGIN, COMMIT, { fetchImpl: deployment({}) }),
    ).resolves.toBeUndefined();
  });

  it('catches a deploy that never took effect, where every other check is green', async () => {
    // The case the whole unit exists for. This is a code-triggered publish: the
    // corpus is redeployed unchanged and the push touched only the Worker, so
    // Vite emitted the same bundle name. Corpus and bundle both pass. Only the
    // commit stamp says the deploy did not land.
    const previous = deployment({
      '/version.json': { body: JSON.stringify({ commit: 'aaaaaaaabbbbbbbbccccccccdddddddd00000000' }) },
    });

    await expect(checkCorpus(ORIGIN, GENERATED_AT, { fetchImpl: previous })).resolves.toBeUndefined();
    await expect(checkBundle(ORIGIN, BUNDLE, { fetchImpl: previous })).resolves.toBeUndefined();

    await expect(checkVersion(ORIGIN, COMMIT, { fetchImpl: previous })).rejects.toThrow(
      /serving commit aaaaaaaa.*not the 1f3c9a27.*did not take effect/s,
    );
  });

  it('refuses a missing version stamp rather than treating it as a match', async () => {
    // Under the SPA fallback an absent version.json is a 200 with the shell.
    const missing = deployment({ '/version.json': { body: SHELL } });

    await expect(checkVersion(ORIGIN, COMMIT, { fetchImpl: missing })).rejects.toThrow(
      /not in the deployed asset set/,
    );
  });

  it('refuses a stamp with no commit field', async () => {
    const empty = deployment({ '/version.json': { body: JSON.stringify({ runId: '42' }) } });

    await expect(checkVersion(ORIGIN, COMMIT, { fetchImpl: empty })).rejects.toThrow(
      /no commit field/,
    );
  });

  it('asks in a form no edge cache can answer from', async () => {
    const asked: string[] = [];
    const recording = (async (input: URL | string) => {
      asked.push(String(input));
      return new Response(JSON.stringify({ commit: COMMIT }), { status: 200 });
    }) as typeof fetch;

    await checkVersion(ORIGIN, COMMIT, { fetchImpl: recording });

    expect(asked[0]).toMatch(/\/version\.json\?smoke=\d+/);
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

    await expect(checkBundle(ORIGIN, BUNDLE, { fetchImpl: missing })).rejects.toThrow(
      /the bundle is not in the deployed asset set/,
    );
  });

  it('catches a shell with no module script to load at all', async () => {
    const empty = deployment({ '/': { body: '<!doctype html><div id="root"></div>', headers: SECURITY_HEADERS } });

    await expect(checkBundle(ORIGIN, BUNDLE, { fetchImpl: empty })).rejects.toThrow(/no module script/);
  });

  it('catches a shell left over from the previous build', async () => {
    // The code half of the identity check. This deployment is entirely
    // healthy — the shell loads, the bundle it names loads, the corpus is
    // current — it is just serving the build before this one. Vite hashes the
    // filename from the code, so the name is the only thing that says so.
    const stale = '/assets/index-OLDHASH0.js';
    const previous = deployment({
      '/': {
        body: `<!doctype html><div id="root"></div><script type="module" src="${stale}"></script>`,
        headers: SECURITY_HEADERS,
      },
      [stale]: { body: 'import{a}from"./chunk.js";' },
    });

    await expect(checkBundle(ORIGIN, BUNDLE, { fetchImpl: previous })).rejects.toThrow(
      /loads \/assets\/index-OLDHASH0\.js, not the .* this run built/,
    );
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

  it('names the rate gate rather than blaming the deploy', async () => {
    // The two refusals the Worker's ceiling can produce before validation runs.
    // Both used to read as an unexplained wrong status.
    const refused = deployment({ '/adhoc': { body: '{"error":"rate_limited"}', status: 429 } });
    const unbound = deployment({ '/adhoc': { body: '{"error":"unavailable"}', status: 503 } });

    await expect(checkAdhoc(ORIGIN, { fetchImpl: refused })).rejects.toThrow(
      /over the per-IP rate limit/,
    );
    await expect(checkAdhoc(ORIGIN, { fetchImpl: unbound })).rejects.toThrow(
      /rate-limit binding was not delivered/,
    );
  });

  it('catches a policy that permits what it was tightened to forbid', async () => {
    // The header is present and every other check is green. Only its contents
    // say the app is one rendering mistake from executing corpus-derived text.
    const permissive = deployment({
      '/': {
        body: SHELL,
        headers: {
          ...SECURITY_HEADERS,
          'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'",
        },
      },
    });

    await expect(checkShell(ORIGIN, { fetchImpl: permissive })).rejects.toThrow(
      /permitting 'unsafe-inline'/,
    );
  });

  it('asks for the corpus in a form no edge cache can answer from', async () => {
    // Without this the retry budget can read a cached copy of the previous
    // corpus and record a false failure against a deploy that did take effect.
    const asked: string[] = [];
    const recording = (async (input: URL | string) => {
      asked.push(String(input));
      return new Response(corpus(), { status: 200 });
    }) as typeof fetch;

    await checkCorpus(ORIGIN, GENERATED_AT, { fetchImpl: recording });

    expect(asked[0]).toMatch(/\/corpus\.json\?smoke=\d+/);
  });
});

describe('the retry budget that absorbs deploy propagation', () => {
  it('returns as soon as an attempt succeeds', async () => {
    // The case the budget exists for: the deployment is correct, it just was
    // not live yet on the first look.
    let attempts = 0;
    const slow = async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('not propagated yet');
      return 'live';
    };

    expect(await withRetry('corpus', slow, 5, 0)).toBe('live');
    expect(attempts).toBe(3);
  });

  it('gives up after the budget and reports the last failure', async () => {
    const never = async () => {
      throw new Error('still serving the previous corpus');
    };

    await expect(withRetry('corpus', never, 3, 0)).rejects.toThrow(SmokeFailure);
    await expect(withRetry('corpus', never, 3, 0)).rejects.toThrow(
      /corpus: still serving the previous corpus/,
    );
  });

  it('spends exactly the attempts it was given', async () => {
    // A budget that quietly stopped retrying would turn propagation lag back
    // into a false publish failure, and nothing else here would notice.
    let attempts = 0;
    const never = async () => {
      attempts += 1;
      throw new Error('nope');
    };

    await expect(withRetry('corpus', never, 4, 0)).rejects.toThrow(SmokeFailure);
    expect(attempts).toBe(4);
  });

  it('backs off further on each attempt', async () => {
    const waits: number[] = [];
    let last = Date.now();
    const never = async () => {
      const now = Date.now();
      waits.push(now - last);
      last = now;
      throw new Error('nope');
    };

    await expect(withRetry('corpus', never, 4, 10)).rejects.toThrow(SmokeFailure);

    // First call is immediate; the three that follow wait 10ms, 20ms, 30ms.
    expect(waits[1]).toBeGreaterThanOrEqual(8);
    expect(waits[3]).toBeGreaterThan(waits[1]!);
  });
});

describe('the run as a whole', () => {
  // Retries are what make a slow deploy pass rather than record a false
  // failure, so they are real in the job and skipped here — the backoff is
  // seconds per attempt and none of these failures are transient.
  const once = <T,>(_what: string, run: () => Promise<T>) => run();

  it('passes against a deployment serving exactly what this run built', async () => {
    expect(await runSmoke(ORIGIN, EXPECTED, { fetchImpl: deployment({}) }, once)).toEqual([]);
  });

  it('runs the version check, not merely define it', async () => {
    // Dropping `version` from the check list left every other test green: the
    // unit tests call checkVersion directly, so none of them notices that
    // runSmoke stopped calling it. A guard that covers nothing passes.
    const stale = deployment({
      '/version.json': { body: JSON.stringify({ commit: 'aaaaaaaabbbbbbbbccccccccdddddddd00000000' }) },
    });

    expect(await runSmoke(ORIGIN, EXPECTED, { fetchImpl: stale }, once)).toEqual([
      expect.stringMatching(/did not take effect/),
    ]);
  });

  it('reports every broken surface, not only the first', async () => {
    const wrecked = deployment({
      '/corpus.json': { body: SHELL },
      '/adhoc': { body: SHELL },
    });

    const failures = await runSmoke(ORIGIN, EXPECTED, { fetchImpl: wrecked }, once);

    expect(failures).toHaveLength(2);
    expect(failures.join('\n')).toMatch(/corpus/);
    expect(failures.join('\n')).toMatch(/adhoc/);
  });

  it('reports an empty corpus as a failure rather than a quiet week', async () => {
    const empty = deployment({ '/corpus.json': { body: corpus({ games: [] }) } });

    expect(await runSmoke(ORIGIN, EXPECTED, { fetchImpl: empty }, once)).toEqual([
      expect.stringMatching(/corpus with no games/),
    ]);
  });
});
