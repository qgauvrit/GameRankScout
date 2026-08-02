/**
 * Constants shared by the Worker and its tests.
 *
 * These live outside `adhoc.ts` because that file is the Worker's entrypoint,
 * and the Workers runtime treats every named export of an entrypoint module as
 * an entrypoint binding — each must be a function or an ExportedHandler. A
 * plain value exported there fails the whole Worker at startup with
 * "Incorrect type for map entry", so nothing here can move back.
 *
 * `wrangler deploy --dry-run` does not catch it: it validates configuration and
 * bundles the module without ever starting the runtime. `wrangler dev` does.
 */

/** The one path the Worker answers itself. Everything else is a static asset. */
export const ADHOC_PATH = '/adhoc';

/** How long a fetched community stays warm. Long enough to absorb a retry. */
export const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Entries parsed per request. A full Reddit page is 100; the ceiling exists so
 * an unusually large feed degrades into fewer entries rather than exhausting
 * the invocation's CPU budget and failing outright.
 */
export const MAX_ENTRIES = 100;
