import { z } from 'zod';
import { sourceItemSchema } from '../../corpus/schema.js';
import type { CommunityRef } from '../../communities/catalogue.js';
import type { RankingWindow, SourceItem } from '../../corpus/schema.js';

/**
 * How the on-demand pull for one community is going. Lives here rather than
 * beside the screen that renders it, so the settings components do not have to
 * import a type back out of the app shell that renders them.
 */
/**
 * `rate_limited` is separate from `unreachable` because it is the one failure
 * here that is the reader's own doing and passes on its own. Reporting it as
 * unreachable would blame the source and tell them to wait for tomorrow's run,
 * when waiting a minute is enough.
 */
export type AdhocFailure = 'not_found' | 'invalid' | 'rate_limited' | 'unreachable';

export type AdhocState =
  | { status: 'loading' }
  | { status: 'merged'; added: number }
  | { status: 'failed'; reason: AdhocFailure };

/**
 * Where the on-demand fetch function lives.
 *
 * A relative path and not a build-time setting. One Worker serves both the app
 * and this route — `run_worker_first = ["/adhoc"]` in `wrangler.toml` — so the
 * only legitimate caller is same-origin, and the handler deliberately sends no
 * cross-origin grant. A build-time override aimed at another origin could not
 * work: the browser would block the response before it reached this client.
 * Deployments that route `/adhoc` to the function therefore need no
 * configuration at all, which is the property the co-location buys.
 */
export const ADHOC_ENDPOINT: string = '/adhoc';

export class AdhocUnavailableError extends Error {
  readonly status: number | null;
  readonly reason: AdhocFailure;

  constructor(reason: AdhocFailure, status: number | null = null) {
    super(`Ad-hoc fetch failed: ${reason}`);
    this.name = 'AdhocUnavailableError';
    this.reason = reason;
    this.status = status;
  }
}

export interface AdhocClientOptions {
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

/**
 * Asks the edge function for a community the scheduled ingest has not swept.
 *
 * The identifier is sent as a parameter rather than a composed URL: the
 * function is the only party allowed to decide what host gets contacted, and
 * moving that decision to the browser would move it to the caller.
 */
export async function fetchAdhocCommunity(
  community: CommunityRef,
  window: RankingWindow,
  options: AdhocClientOptions = {},
): Promise<SourceItem[]> {
  const { fetchImpl = fetch, endpoint = ADHOC_ENDPOINT } = options;

  const url = new URL(endpoint, globalThis.location?.origin ?? 'http://localhost');
  url.searchParams.set('source', community.source);
  url.searchParams.set('community', community.id);
  url.searchParams.set('window', window);

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), { headers: { accept: 'application/json' } });
  } catch {
    throw new AdhocUnavailableError('unreachable');
  }

  if (response.status === 404) throw new AdhocUnavailableError('not_found', 404);
  if (response.status === 400) throw new AdhocUnavailableError('invalid', 400);
  // The handler's per-IP ceiling. Adding a community costs one request per
  // ranking window, so a reader with many of them can reach it on one load —
  // and unlike every other failure here, it clears by itself.
  if (response.status === 429) throw new AdhocUnavailableError('rate_limited', 429);
  if (!response.ok) throw new AdhocUnavailableError('unreachable', response.status);

  try {
    const body = (await response.json()) as { items?: unknown };
    // Parsed, not cast. These values become outbound links and are read by the
    // merge, and the schema is where the http(s)-only URL constraint lives — a
    // cast would route around the one control that enforces it.
    const parsed = z.array(sourceItemSchema).safeParse(body?.items ?? []);
    if (!parsed.success) throw new AdhocUnavailableError('unreachable', response.status);
    return parsed.data;
  } catch (error) {
    if (error instanceof AdhocUnavailableError) throw error;
    // A deployment with no function routed at this path answers with the app's
    // own index.html, which is a 200 that is not JSON. That is "no ad-hoc path
    // here", not a broken community.
    throw new AdhocUnavailableError('unreachable', response.status);
  }
}
