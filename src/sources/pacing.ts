/**
 * Request pacing and rejection backoff, shared by every source adapter.
 *
 * R7 requires each source to stay inside its rate limits and back off when it
 * is told to. Reddit implemented that and the other two did not — they threw on
 * any non-ok response, so a single 429 during an hour-long sweep failed the
 * whole source rather than waiting the moment out. Extracting it means a new
 * adapter inherits the behaviour rather than having to remember it.
 *
 * Pacing is serialized through a promise chain rather than a shared timestamp.
 * A read-await-write on a timestamp is not a mutex: concurrent callers all read
 * the same value, wait the same interval, and then fire together — which is the
 * opposite of what pacing is for.
 */

/** Statuses that mean "slow down", as distinct from "this request was wrong". */
export const REJECTION_STATUSES = new Set([429, 503]);

export class SourceRejectedError extends Error {
  readonly status: number;
  readonly attempts: number;

  constructor(source: string, status: number, attempts: number) {
    super(`${source} rejected the request with ${status} after ${attempts} attempt(s)`);
    this.name = 'SourceRejectedError';
    this.status = status;
    this.attempts = attempts;
  }
}

export interface PacedFetchOptions {
  /** Name used in error messages, e.g. `Reddit`. */
  source: string;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  nowImpl?: () => number;
  minIntervalMs: number;
  baseBackoffMs?: number;
  maxRetries?: number;
  headers: Record<string, string>;
  /** Thrown instead of SourceRejectedError when the adapter has its own type. */
  onRejected?: (status: number, attempts: number) => Error;
}

export interface PacedFetch {
  (url: string): Promise<string>;
  /** How many times a request was rejected and retried across this client's life. */
  rejections(): number;
}

export function createPacedFetch(options: PacedFetchOptions): PacedFetch {
  const {
    source,
    fetchImpl = fetch,
    sleepImpl = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    nowImpl = () => Date.now(),
    minIntervalMs,
    baseBackoffMs = 2_000,
    maxRetries = 4,
    headers,
    onRejected,
  } = options;

  let lastRequestAt: number | null = null;
  let rejections = 0;
  // Every request queues behind the previous one's slot, so N concurrent
  // callers are spaced from each other rather than merely from the past.
  let queue: Promise<void> = Promise.resolve();

  function reserveSlot(): Promise<void> {
    const slot = queue.then(async () => {
      if (lastRequestAt !== null) {
        const elapsed = nowImpl() - lastRequestAt;
        if (elapsed < minIntervalMs) await sleepImpl(minIntervalMs - elapsed);
      }
      lastRequestAt = nowImpl();
    });
    queue = slot.catch(() => undefined);
    return slot;
  }

  const paced = async (url: string): Promise<string> => {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      await reserveSlot();

      const response = await fetchImpl(url, { headers });
      if (response.ok) return await response.text();

      if (REJECTION_STATUSES.has(response.status)) {
        rejections += 1;
        if (attempt > maxRetries) {
          throw onRejected
            ? onRejected(response.status, attempt)
            : new SourceRejectedError(source, response.status, attempt);
        }
        // Rejection is expected traffic shaping, not an exceptional condition,
        // so it never propagates as a corpus failure.
        await sleepImpl(baseBackoffMs * 2 ** (attempt - 1));
        continue;
      }

      throw new Error(`${source} request failed with HTTP ${response.status}: ${url}`);
    }
  };

  return Object.assign(paced, { rejections: () => rejections });
}
