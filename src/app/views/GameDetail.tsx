import { Badge, Button, Heading, Stack, Text } from '@astryxdesign/core';
import { DECK_LABELS, ownerBandLabel, platformLabel, sourceLabel, storeLabel } from '../labels.js';
import { ExternalLink } from './ExternalLink.js';
import type { EvidenceRecord, GameEntry } from '../../corpus/schema.js';

/** How many community tags a detail panel shows before it stops being scannable. */
const MAX_TAGS = 8;

export interface GameDetailProps {
  game: GameEntry;
  /** The records that produced this game's rank, from `RankedGame.contributing`. */
  contributing: EvidenceRecord[];
  onDismiss: (gameId: string) => void;
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
 * discussions that ranked it (R12, R13). Rendered inside the evidence sheet (R9).
 *
 * Every field here can be absent — enrichment degrades rather than fails — so
 * each block is either rendered with real content or stated as unresolved.
 * Nothing renders as a blank.
 */
export function GameDetail({ game, contributing, onDismiss }: GameDetailProps) {
  const threads = citedThreads(contributing);
  const owners = ownerBandLabel(game.ownerBand);
  const deck = game.handheld ? DECK_LABELS[game.handheld.deck] : null;
  const tags = game.tags.slice(0, MAX_TAGS);
  // The primary store link is already on the entry itself, one tap away from
  // the list; repeating it here would only pad the panel.
  const alsoOn = game.storeLinks.slice(1);

  return (
    <section aria-label={game.name}>
      <Stack direction="vertical" gap={3}>
        <Stack direction="horizontal" gap={1} wrap="wrap" vAlign="center">
          {game.platforms.map((platform) => (
            <Badge key={platform} label={platformLabel(platform)} />
          ))}
          {owners && <Badge variant="neutral" label={owners} />}
          {deck && <Badge variant="neutral" label={deck} />}
        </Stack>

        {tags.length > 0 && (
          <Stack
            direction="horizontal"
            gap={1}
            wrap="wrap"
            aria-label={`Community tags for ${game.name}`}
          >
            {tags.map((tag) => (
              <Badge key={tag} variant="neutral" label={tag} />
            ))}
          </Stack>
        )}

        {game.storeLinks.length === 0 && (
          <Text type="supporting">
            No store link resolved for this one — the discussions below are still the way in.
          </Text>
        )}

        {alsoOn.length > 0 && (
          <Stack direction="horizontal" gap={2} wrap="wrap" vAlign="center">
            <Text type="supporting">Also on</Text>
            {alsoOn.map((link) => (
              <ExternalLink href={link.url} key={link.url}>
                {storeLabel(link.store)}
              </ExternalLink>
            ))}
          </Stack>
        )}

        <Heading level={3}>Why it ranked</Heading>
        {threads.length > 0 ? (
          <Stack direction="vertical" gap={2}>
            {threads.map((thread) => (
              <Stack key={thread.key} direction="vertical" gap={0.5}>
                <ExternalLink href={thread.permalink} isStandalone>
                  {thread.title}
                </ExternalLink>
                <Text type="supporting">
                  {thread.community} · {sourceLabel(thread.source)}
                </Text>
              </Stack>
            ))}
          </Stack>
        ) : (
          <Text type="supporting">
            The threads behind this entry came from a source that is switched off.
          </Text>
        )}

        {/*
          Deliberately not naming the game: the button sits inside a region
          already labelled with it, and repeating the name here would collide
          with the entry's own control for anything selecting by accessible name.
        */}
        <Button
          variant="ghost"
          label="Not for me — hide this game"
          onClick={() => onDismiss(game.id)}
        />
      </Stack>
    </section>
  );
}
