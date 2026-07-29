import { DECK_LABELS, ownerBandLabel, platformLabel, sourceLabel, storeLabel } from '../labels.js';
import { ExternalLink } from './ExternalLink.js';
import type { EvidenceRecord, GameEntry } from '../../corpus/schema.js';

/** How many community tags a detail panel shows before it stops being scannable. */
const MAX_TAGS = 8;

export interface GameDetailProps {
  /** Matches the `aria-controls` on the entry's toggle. */
  id: string;
  game: GameEntry;
  /** The records that produced this game's rank, from `RankedGame.contributing`. */
  contributing: EvidenceRecord[];
}

interface ThreadCitation {
  key: string;
  community: string;
  source: EvidenceRecord['source'];
  title: string;
  permalink: string;
  rankPosition: number;
  postedAt: string;
}

/**
 * One entry per thread, not per evidence record. A single large thread appears
 * in several windows by design — that cross-window presence is how magnitude is
 * inferred (KTD4) — but the reader should be offered one link to it, not three.
 */
export function citedThreads(contributing: EvidenceRecord[]): ThreadCitation[] {
  const byThread = new Map<string, ThreadCitation>();

  for (const record of contributing) {
    const key = `${record.source}:${record.thread.id}`;
    const existing = byThread.get(key);
    if (existing && existing.rankPosition <= record.rankPosition) continue;
    byThread.set(key, {
      key,
      community: record.community,
      source: record.source,
      title: record.thread.title,
      permalink: record.thread.permalink,
      rankPosition: record.rankPosition,
      postedAt: record.postedAt,
    });
  }

  // Best-placed thread first: position in a community's ranked listing is the
  // portable signal this product has (D6), so it is also the honest order here.
  return [...byThread.values()].sort(
    (a, b) => a.rankPosition - b.rankPosition || a.title.localeCompare(b.title),
  );
}

/**
 * The evidence behind one ranked game: where to buy it, what it is, and the
 * discussions that ranked it (R12, R14, R34).
 *
 * Every field here can be absent — enrichment degrades rather than fails (U5) —
 * so each block is either rendered with real content or stated as unresolved.
 * Nothing renders as a blank.
 */
export function GameDetail({ id, game, contributing }: GameDetailProps) {
  const threads = citedThreads(contributing);
  const owners = ownerBandLabel(game.ownerBand);
  const deck = game.handheld ? DECK_LABELS[game.handheld.deck] : null;
  const tags = game.tags.slice(0, MAX_TAGS);
  // The primary store link is already on the entry itself, one tap away from
  // the list; repeating it here would only pad the panel.
  const alsoOn = game.storeLinks.slice(1);

  return (
    <section className="detail" id={id} aria-label={game.name}>
      <div className="detail-facts">
        {game.platforms.map((platform) => (
          <span className="chip" key={platform}>
            {platformLabel(platform)}
          </span>
        ))}
        {owners && <span className="chip chip-quiet">{owners}</span>}
        {deck && <span className="chip chip-quiet">{deck}</span>}
      </div>

      {tags.length > 0 && (
        <ul className="tags" aria-label={`Community tags for ${game.name}`}>
          {tags.map((tag) => (
            <li className="tag" key={tag}>
              {tag}
            </li>
          ))}
        </ul>
      )}

      {game.storeLinks.length === 0 && (
        <p className="muted">
          No store link resolved for this one — the discussions below are still the way in.
        </p>
      )}

      {alsoOn.length > 0 && (
        <div className="detail-stores">
          <span className="muted">Also on</span>
          {alsoOn.map((link) => (
            <ExternalLink className="button button-small" href={link.url} key={link.url}>
              {storeLabel(link.store)} ↗
            </ExternalLink>
          ))}
        </div>
      )}

      <h3 className="detail-heading">Why it ranked</h3>
      {threads.length > 0 ? (
        <ul className="threads">
          {threads.map((thread) => (
            <li className="thread" key={thread.key}>
              <ExternalLink className="thread-link" href={thread.permalink}>
                {thread.title}
              </ExternalLink>
              <span className="thread-origin">
                {thread.community} · {sourceLabel(thread.source)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          The threads behind this entry came from a source that is switched off.
        </p>
      )}
    </section>
  );
}
