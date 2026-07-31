import { z } from 'zod';
import { sourceItemSchema } from '../../corpus/schema.js';
import type { CommunityRef } from '../../communities/catalogue.js';
import type { RankingWindow, SourceItem } from '../../corpus/schema.js';

/**
 * How the on-demand pull for one community is going. Lives here rather than
 * beside the screen that renders it, so the settings components do not have to
 * import a type back out of the app shell that renders them.
 */
export type AdhocState =
  | { status: 'loading' }
  | { status: 'merged'; added: number }
  | { status: 'failed'; reason: 'not_found' | 'invalid' | 'unreachable' };

/**
 * Where the on-demand fetch function lives. Configured at build time because it
 * is a deployment detail, and defaulted to a same-origin path so a deployment
 * that routes `/adhoc` to the function needs no configuration at all.
 */
export const ADHOC_ENDPOINT: string =
  (import.meta.env?.VITE_ADHOC_URL as string | undefined) ?? '/adhoc';

export class AdhocUnavailableError extends Error {
  readonly status: number | null;
  readonly reason: 'not_found' | 'invalid' | 'unreachable';

  constructor(reason: 'not_found' | 'invalid' | 'unreachable', status: number | null = null) {
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
