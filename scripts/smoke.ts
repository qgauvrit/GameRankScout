/**
 * Checks a deployment actually works, from outside it.
 *
 *   tsx scripts/smoke.ts https://gamerankscout.example.workers.dev
 *
 * Four things a deploy can break without failing: the shell stops loading, its
 * JavaScript bundle is missing, the corpus is missing from the uploaded asset
 * set, or `/adhoc` stops being routed to the Worker. Each is invisible to
 * `wrangler deploy`, which reports success as long as the upload completed.
 *
 * This is a script and not a test because it needs a live deployment and the
 * suite may not reach the network (KTD8). It runs in the publish job, after the
 * deploy, and its result is recorded in the run report.
 *
 * Assertions are on parsed content, never on status alone. `not_found_handling`
 * is `single-page-application`, so a missing `corpus.json` comes back as 200
 * with the HTML shell — a status check would pass on exactly the failure this
 * exists to catch.
 */

/** Deploy propagation is not instantaneous; a check that runs immediately can
 * read the previous version. Failing a good deploy would record a false publish
 * failure, so each check gets a few attempts before it counts. */
const ATTEMPTS = 5;
const BACKOFF_MS = 3_000;
/** A hung origin would otherwise stall the publish job until its 20-minute cap. */
const TIMEOUT_MS = 10_000;

const get = (url: URL | string) => fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

class SmokeFailure extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(what: string, run: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (attempt < ATTEMPTS) {
        console.log(`  ${what}: attempt ${attempt} failed, retrying…`);
        await sleep(BACKOFF_MS * attempt);
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

async function checkShell(origin: string): Promise<void> {
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
}

/**
 * The shell alone proves nothing. Under the SPA fallback a missing bundle is
 * served as 200 with index.html, so a site whose JavaScript never loads returns
 * a perfectly good-looking shell — the exact shape of silent pass this check
 * exists to refuse.
 */
async function checkBundle(origin: string): Promise<void> {
  const shell = await (await get(new URL('/', origin))).text();
  const src = /<script[^>]+src="([^"]+)"/.exec(shell)?.[1];
  if (!src) throw new Error('GET / returned a shell with no module script to load');

  const response = await get(new URL(src, origin));
  const body = await response.text();

  if (!response.ok) throw new Error(`GET ${src} returned ${response.status}`);
  if (body.trimStart().startsWith('<')) {
    throw new Error(`GET ${src} returned the SPA shell — the bundle is not in the deployed asset set`);
  }
}

async function checkCorpus(origin: string): Promise<void> {
  const response = await get(new URL('/corpus.json', origin));
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
  const corpus = parsed as { schemaVersion?: unknown; games?: unknown };
  if (typeof corpus.schemaVersion !== 'number' || !Array.isArray(corpus.games)) {
    throw new Error('GET /corpus.json returned JSON that is not shaped like a corpus');
  }
  if (corpus.games.length === 0) {
    throw new Error('GET /corpus.json returned a corpus with no games');
  }
}

async function checkAdhoc(origin: string): Promise<void> {
  const url = new URL('/adhoc', origin);
  url.searchParams.set('community', 'https://evil.test/steal');

  const response = await get(url);

  // A 400 proves two things at once: the path reached the Worker rather than
  // the asset store, and the identifier rules survived the deploy.
  if (response.status !== 400) {
    throw new Error(
      `GET /adhoc with a hostile identifier returned ${response.status}, expected 400` +
        (response.status === 200 ? ' — the path may be served as a static asset' : ''),
    );
  }
  const body = (await response.json()) as { error?: string };
  if (body.error !== 'invalid_community') {
    throw new Error(`GET /adhoc rejected the identifier as "${body.error}", expected invalid_community`);
  }
}

async function main(): Promise<void> {
  const origin = process.argv[2];
  if (!origin) {
    console.error('usage: smoke <origin>');
    process.exit(2);
  }

  const checks: [string, () => Promise<void>][] = [
    ['shell', () => checkShell(origin)],
    ['bundle', () => checkBundle(origin)],
    ['corpus', () => checkCorpus(origin)],
    ['adhoc', () => checkAdhoc(origin)],
  ];

  // Concurrently: nothing depends on another's result. Run in turn, a
  // deployment that has not propagated yet pays each check's retry budget end
  // to end rather than once.
  const settled = await Promise.allSettled(checks.map(([name, run]) => withRetry(name, run)));

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

  if (failures.length > 0) {
    console.error(`::error::Smoke check failed against ${origin}`);
    process.exit(1);
  }

  console.log(`Smoke check passed against ${origin}`);
}

void main();
