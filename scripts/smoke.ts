/**
 * Checks a deployment actually works, from outside it.
 *
 *   tsx scripts/smoke.ts https://grs.example.workers.dev "$generated_at" /assets/index-abc123.js
 *
 * Four things a deploy can break without failing: the shell stops loading, its
 * JavaScript bundle is missing, the corpus is missing from the uploaded asset
 * set, or `/adhoc` stops being routed to the Worker. Each is invisible to
 * `wrangler deploy`, which reports success as long as the upload completed.
 *
 * The second and third arguments are what make this a check of *this* deploy.
 * Everything below passes just as well against the deployment that was already
 * live, so a deploy that never took effect — or one still propagating when the
 * check ran — would be confirmed by the version it was supposed to replace.
 * Between them the two arguments name both halves of what was published: the
 * corpus this job uploaded carries a `generatedAt` no earlier deployment can
 * have, and Vite hashes the bundle filename from the built code, so a shell
 * still naming the previous bundle is the previous build. They are required
 * rather than optional for the same reason the checks below parse bodies
 * instead of reading statuses: a check that can be silently skipped is a check
 * that eventually is.
 *
 * This is a script and not a test because it needs a live deployment and the
 * suite may not reach the network (KTD8). It runs in the publish job, after the
 * deploy, and its result is recorded in the run report. The functions are
 * exported so `smoke.test.ts` can drive them against a stub instead.
 *
 * Assertions are on parsed content, never on status alone. `not_found_handling`
 * is `single-page-application`, so a missing `corpus.json` comes back as 200
 * with the HTML shell — a status check would pass on exactly the failure this
 * exists to catch.
 */
import { resolve } from 'node:path';

/** Deploy propagation is not instantaneous; a check that runs immediately can
 * read the previous version. Failing a good deploy would record a false publish
 * failure, so each check gets a few attempts before it counts. */
const ATTEMPTS = 8;
const BACKOFF_MS = 4_000;
/** A hung origin would otherwise stall the publish job until its 20-minute cap. */
const TIMEOUT_MS = 10_000;

export interface SmokeDeps {
  fetchImpl?: typeof fetch;
}

const getter =
  (deps: SmokeDeps) =>
  (url: URL | string): Promise<Response> =>
    (deps.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

export class SmokeFailure extends Error {}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export async function withRetry<T>(
  what: string,
  run: () => Promise<T>,
  attempts = ATTEMPTS,
  backoffMs = BACKOFF_MS,
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (attempt < attempts) {
        console.log(`  ${what}: attempt ${attempt} failed, retrying…`);
        await sleep(backoffMs * attempt);
      }
    }
  }
  throw new SmokeFailure(`${what}: ${(last as Error).message}`);
}

/** The headers `public/_headers` is supposed to add. Silently absent if the
 * asset handler ignores the file, which is a failure no other check would see. */
const REQUIRED_HEADERS = [
  'content-security-policy',
  'x-content-type-options',
  'referrer-policy',
  'strict-transport-security',
];

/**
 * Directives whose presence would undo the policy while leaving the header
 * there. Checking only that a CSP exists would pass on a policy that permits
 * exactly what it is deployed to forbid — the same shape as checking a status
 * instead of a body.
 */
const FORBIDDEN_CSP_SOURCES = ["'unsafe-inline'", "'unsafe-eval'"];

export async function checkShell(origin: string, deps: SmokeDeps = {}): Promise<void> {
  const get = getter(deps);
  const response = await get(new URL('/', origin));
  const body = await response.text();

  if (!response.ok) throw new Error(`GET / returned ${response.status}`);
  if (!body.includes('<div id="root">')) {
    throw new Error('GET / did not return the app shell');
  }

  const missing = REQUIRED_HEADERS.filter((name) => !response.headers.get(name));
  if (missing.length > 0) {
    throw new Error(`GET / is missing ${missing.join(', ')} — _headers was not applied`);
  }

  const policy = response.headers.get('content-security-policy') ?? '';
  const permitted = FORBIDDEN_CSP_SOURCES.filter((source) => policy.includes(source));
  if (permitted.length > 0) {
    throw new Error(`GET / serves a Content-Security-Policy permitting ${permitted.join(', ')}`);
  }
}

/**
 * The shell alone proves nothing. Under the SPA fallback a missing bundle is
 * served as 200 with index.html, so a site whose JavaScript never loads returns
 * a perfectly good-looking shell — the exact shape of silent pass this check
 * exists to refuse.
 */
export async function checkBundle(
  origin: string,
  expectedBundle: string,
  deps: SmokeDeps = {},
): Promise<void> {
  const get = getter(deps);
  const shell = await (await get(new URL('/', origin))).text();
  const src = /<script[^>]+src="([^"]+)"/.exec(shell)?.[1];
  if (!src) throw new Error('GET / returned a shell with no module script to load');

  // The code half of the identity check. The corpus proves the asset set is
  // this run's; this proves the shell points at the code this run built. Vite
  // hashes the filename from the bundle's contents, so a shell still naming the
  // previous build's bundle is a shell from the previous build.
  if (src !== expectedBundle) {
    throw new Error(
      `GET / loads ${src}, not the ${expectedBundle} this run built — the deployed shell is not this build`,
    );
  }

  const response = await get(new URL(src, origin));
  const body = await response.text();

  if (!response.ok) throw new Error(`GET ${src} returned ${response.status}`);
  if (body.trimStart().startsWith('<')) {
    throw new Error(`GET ${src} returned the SPA shell — the bundle is not in the deployed asset set`);
  }
}

export async function checkCorpus(
  origin: string,
  expectedGeneratedAt: string,
  deps: SmokeDeps = {},
): Promise<void> {
  const get = getter(deps);
  // Cache-busted. The assertion below is that this deployment replaced the
  // previous corpus, and an edge copy of the previous one would fail it — a
  // false publish failure against a deploy that did take effect, which is the
  // exact mistake this check exists to avoid making in the other direction.
  const url = new URL('/corpus.json', origin);
  url.searchParams.set('smoke', String(Date.now()));

  const response = await get(url);
  const body = await response.text();

  // Deliberately not a status check. Under the SPA fallback an absent
  // corpus.json is served as 200 with index.html, so the parse is the assertion.
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    const hint = body.trimStart().startsWith('<')
      ? 'the SPA shell was served instead — corpus.json is not in the deployed asset set'
      : 'the body is not JSON';
    throw new Error(`GET /corpus.json did not return a corpus: ${hint}`);
  }

  // Shape only. The sweep already validated this corpus against the schema
  // before it was uploaded; re-running that here would check the same bytes
  // twice and couple the check to a schema version the live corpus may predate.
  const corpus = parsed as { schemaVersion?: unknown; games?: unknown; generatedAt?: unknown };
  if (typeof corpus.schemaVersion !== 'number' || !Array.isArray(corpus.games)) {
    throw new Error('GET /corpus.json returned JSON that is not shaped like a corpus');
  }
  if (corpus.games.length === 0) {
    throw new Error('GET /corpus.json returned a corpus with no games');
  }

  // The identity check. A stale corpus here means the deploy did not take
  // effect, or has not propagated yet — and the retry budget above is what
  // covers the second case, so reaching this failure means it never arrived.
  if (corpus.generatedAt !== expectedGeneratedAt) {
    throw new Error(
      `GET /corpus.json is serving the corpus generated at ${String(corpus.generatedAt)}, ` +
        `not the ${expectedGeneratedAt} one this run deployed — the deployment did not take effect`,
    );
  }
}

export async function checkAdhoc(origin: string, deps: SmokeDeps = {}): Promise<void> {
  const get = getter(deps);
  const url = new URL('/adhoc', origin);
  url.searchParams.set('community', 'https://evil.test/steal');

  const response = await get(url);

  // A 400 proves two things at once: the path reached the Worker rather than
  // the asset store, and the identifier rules survived the deploy.
  if (response.status !== 400) {
    // The Worker's rate gate can answer before validation ever runs, and both of
    // its refusals look like a broken deploy without this. They are not the same
    // problem: 503 means the rate-limit binding was not delivered, 429 means
    // this runner is over the ceiling.
    const hint =
      { 200: ' — the path may be served as a static asset',
        429: ' — this checker is over the per-IP rate limit',
        503: ' — the rate-limit binding was not delivered to the Worker' }[response.status] ?? '';

    throw new Error(
      `GET /adhoc with a hostile identifier returned ${response.status}, expected 400${hint}`,
    );
  }
  const body = (await response.json()) as { error?: string };
  if (body.error !== 'invalid_community') {
    throw new Error(`GET /adhoc rejected the identifier as "${body.error}", expected invalid_community`);
  }
}

/**
 * The one check that discriminates on every publish path.
 *
 * The corpus timestamp and the bundle name each prove a deploy took effect only
 * when that thing changed. On the code-triggered path the corpus is redeployed
 * unchanged, so its assertion can never fail; and a push that changes only the
 * Worker, the manifest, the headers, or a workflow leaves Vite's content hash
 * identical, so the bundle assertion cannot fail either. Both would be green
 * against the deployment that was already live, which is precisely the silent
 * pass they were added to refuse.
 *
 * `version.json` is written from the commit actually checked out, after the
 * build, so it differs on every publish regardless of what the payload did.
 */
export async function checkVersion(
  origin: string,
  expectedCommit: string,
  deps: SmokeDeps = {},
): Promise<void> {
  const get = getter(deps);
  // Cache-busted for the same reason the corpus fetch is: an edge copy of the
  // previous version would fail a deploy that did take effect.
  const url = new URL('/version.json', origin);
  url.searchParams.set('smoke', String(Date.now()));

  const response = await get(url);
  const body = await response.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    const hint = body.trimStart().startsWith('<')
      ? 'the SPA shell was served instead — version.json is not in the deployed asset set'
      : 'the body is not JSON';
    throw new Error(`GET /version.json did not return a version stamp: ${hint}`);
  }

  const served = (parsed as { commit?: unknown }).commit;
  if (typeof served !== 'string' || served.length === 0) {
    throw new Error('GET /version.json returned JSON with no commit field');
  }
  if (served !== expectedCommit) {
    throw new Error(
      `GET /version.json is serving commit ${served}, not the ${expectedCommit} this run deployed — the deployment did not take effect`,
    );
  }
}

/**
 * Runs every check and returns the failures rather than exiting, so the caller
 * owns the process and the suite can assert on the result.
 */
export async function runSmoke(
  origin: string,
  expected: { generatedAt: string; bundle: string; commit: string },
  deps: SmokeDeps = {},
  retry = withRetry,
): Promise<string[]> {
  const checks: [string, () => Promise<void>][] = [
    ['shell', () => checkShell(origin, deps)],
    ['bundle', () => checkBundle(origin, expected.bundle, deps)],
    ['corpus', () => checkCorpus(origin, expected.generatedAt, deps)],
    ['version', () => checkVersion(origin, expected.commit, deps)],
    ['adhoc', () => checkAdhoc(origin, deps)],
  ];

  // Concurrently: nothing depends on another's result. Run in turn, a
  // deployment that has not propagated yet pays each check's retry budget end
  // to end rather than once.
  const settled = await Promise.allSettled(checks.map(([name, run]) => retry(name, run)));

  // Reported in the fixed order above, so the output does not depend on which
  // check happened to finish first.
  const failures: string[] = [];
  settled.forEach((result, index) => {
    const name = checks[index]![0];
    if (result.status === 'fulfilled') {
      console.log(`  ✓ ${name}`);
      return;
    }
    const message = (result.reason as Error).message;
    failures.push(message);
    console.error(`  ✗ ${message}`);
  });

  return failures;
}

async function main(argv: string[]): Promise<void> {
  const [origin, generatedAt, bundle, commit] = argv;
  if (!origin || !generatedAt || !bundle || !commit) {
    console.error(
      'usage: smoke <origin> <expected-corpus-generated-at> <expected-bundle-path> <expected-commit>',
    );
    process.exit(2);
  }

  const failures = await runSmoke(origin, { generatedAt, bundle, commit });

  if (failures.length > 0) {
    console.error(`::error::Smoke check failed against ${origin}`);
    process.exit(1);
  }

  console.log(`Smoke check passed against ${origin}`);
}

// Only run when invoked directly, so the suite can import the checks above.
if (process.argv[1] && resolve(process.argv[1]).endsWith('smoke.ts')) {
  void main(process.argv.slice(2));
}
