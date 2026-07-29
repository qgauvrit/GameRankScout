import { useState } from 'react';
import { GameDetail } from './GameDetail.js';
import { ExternalLink } from './ExternalLink.js';
import { storeLabel } from '../labels.js';
import type { RankedGame } from '../../ranking/score.js';

export interface RankingProps {
  ranked: RankedGame[];
  onDismiss: (gameId: string) => void;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * What the entry says about its own evidence before it is opened. Enough to
 * judge whether the ranking is worth trusting; not so much that the row stops
 * being scannable.
 */
function evidenceSummary(entry: RankedGame): string {
  const threads = new Set(entry.contributing.map((record) => record.thread.id)).size;
  const communities = new Set(entry.contributing.map((record) => record.community)).size;
  return `${plural(threads, 'thread', 'threads')} across ${plural(
    communities,
    'community',
    'communities',
  )}`;
}

function Entry({
  entry,
  position,
  onDismiss,
}: {
  entry: RankedGame;
  position: number;
  onDismiss: (gameId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { game } = entry;
  const detailId = `evidence-${game.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const primaryStore = game.storeLinks[0];

  return (
    <li className="entry">
      <div className="entry-head">
        <button
          type="button"
          className="entry-toggle"
          aria-expanded={expanded}
          aria-controls={detailId}
          onClick={() => setExpanded((open) => !open)}
        >
          <span className="entry-rank" aria-hidden="true">
            {position}
          </span>
          <span className="entry-text">
            <span className="entry-name">{game.name}</span>
            <span className="entry-meta">{evidenceSummary(entry)}</span>
          </span>
          <span className={`entry-chevron${expanded ? ' open' : ''}`} aria-hidden="true" />
        </button>

        {primaryStore && (
          <ExternalLink className="entry-store" href={primaryStore.url}>
            {storeLabel(primaryStore.store)}
            <span aria-hidden="true"> ↗</span>
          </ExternalLink>
        )}
      </div>

      {expanded && (
        <GameDetail
          id={detailId}
          game={game}
          contributing={entry.contributing}
          onDismiss={onDismiss}
        />
      )}
    </li>
  );
}

/**
 * The ranking itself (R34): one row per game, and the discussions that produced
 * that row are one tap away — the thread links are the product's actual output,
 * so nothing may sit between the ranking and them.
 */
export function Ranking({ ranked, onDismiss }: RankingProps) {
  if (ranked.length === 0) {
    return (
      <div className="state">
        <div className="glyph" />
        <h2>Nothing ranked here</h2>
        <p>
          No game in the current corpus has evidence for this view. The next scheduled run may
          change that.
        </p>
      </div>
    );
  }

  return (
    <ol className="ranking">
      {ranked.map((entry, index) => (
        <Entry entry={entry} key={entry.game.id} position={index + 1} onDismiss={onDismiss} />
      ))}
    </ol>
  );
}
