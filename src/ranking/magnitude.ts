import { RANKING_WINDOWS } from '../corpus/schema.js';
import type { EvidenceRecord } from '../corpus/schema.js';

/**
 * Infers how large each thread is from how many time windows it appears in
 * (KTD4, D8).
 *
 * A thread that shows up in the week, month *and* year top lists is large by
 * construction — it out-ranked a year of competition in each. Those windows are
 * already fetched for the timeframe feature, so this costs nothing extra.
 * Comment volume saturates near the feed cap and only discriminates in the
 * tail, so it is used as a tie-breaker rather than the primary signal.
 */
export function threadMagnitudes(evidence: EvidenceRecord[]): Map<string, number> {
  const windowsByThread = new Map<string, Set<string>>();
  const commentsByThread = new Map<string, number>();

  for (const record of evidence) {
    const key = record.thread.id;
    let windows = windowsByThread.get(key);
    if (!windows) {
      windows = new Set();
      windowsByThread.set(key, windows);
    }
    windows.add(record.window);

    const comments = record.engagement?.comments;
    if (typeof comments === 'number') {
      commentsByThread.set(key, Math.max(commentsByThread.get(key) ?? 0, comments));
    }
  }

  const magnitudes = new Map<string, number>();
  for (const [threadId, windows] of windowsByThread) {
    // Presence in n of the ranked windows is the primary signal.
    const crossWindow = windows.size;

    // Tail tie-breaker only: a small nudge that cannot outweigh a window step.
    const comments = commentsByThread.get(threadId) ?? 0;
    const tieBreaker = comments > 0 ? Math.min(0.9, Math.log10(1 + comments) / 4) : 0;

    magnitudes.set(threadId, crossWindow + tieBreaker);
  }

  return magnitudes;
}

/** The largest magnitude any thread can reach, used to normalize. */
export const MAX_MAGNITUDE = RANKING_WINDOWS.length + 0.9;
