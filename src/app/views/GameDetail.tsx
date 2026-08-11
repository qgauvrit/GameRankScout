import { useState } from 'react';
import { Badge, Button, Heading, Stack, Text } from '@astryxdesign/core';
import * as stylex from '@stylexjs/stylex';
import { DECK_LABELS, ownerBandLabel, platformLabel, sourceLabel, storeLabel } from '../labels.js';
import { ExternalLink } from './ExternalLink.js';
import { steamHeaderImage } from './steamImage.js';
import type { EvidenceRecord, GameEntry } from '../../corpus/schema.js';

/** How many community tags a detail panel shows before it stops being scannable. */
const MAX_TAGS = 8;

const styles = stylex.create({
  /** Reserves the hero's box so nothing shifts as it loads or fails. */
  heroFrame: {
    width: '100%',
    aspectRatio: '460 / 215',
    borderRadius: 8,
    overflow: 'hidden',
  },
  heroImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  /** Shown in the same reserved frame when the image 404s or is blocked. */
  heroPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
});

/**
 * The Steam store header, in a fixed frame that never collapses. Steam is the
 * only store in the corpus and every hero rides on one CDN URL, so the real risk
 * is a blocked or 404 image (or a CDN-host migration) — `onError` swaps to a
 * quiet placeholder in the same reserved box rather than leaving a broken image
 * or a layout jump. Decorative (`alt=""`): the section is already labelled with
 * the game's name. Referrer withheld so the CDN learns nothing about the reader.
 */
function Hero({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div {...stylex.props(styles.heroFrame)} aria-label={`${name} store image`}>
      {failed ? (
        <div {...stylex.props(styles.heroPlaceholder)} aria-hidden="true" />
      ) : (
        <img
          {...stylex.props(styles.heroImage)}
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          fetchPriority="high"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

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
  const heroSrc = steamHeaderImage(game.storeLinks);
  // The availability block carries anything about where and how to play it.
  const hasAvailability =
    game.platforms.length > 0 ||
    Boolean(owners) ||
    Boolean(deck) ||
    alsoOn.length > 0 ||
    game.storeLinks.length === 0;

  return (
    <section aria-label={game.name}>
      <Stack direction="vertical" gap={3}>
        <Heading level={2}>{game.name}</Heading>

        {/* Key on the src so the failed-load state can never outlive its image. */}
        {heroSrc && <Hero key={heroSrc} src={heroSrc} name={game.name} />}

        {hasAvailability && (
          <Stack direction="vertical" gap={1}>
            <Heading level={3}>Availability</Heading>
            <Stack direction="horizontal" gap={1} wrap="wrap" vAlign="center">
              {game.platforms.map((platform) => (
                <Badge key={platform} label={platformLabel(platform)} />
              ))}
              {owners && <Badge variant="neutral" label={owners} />}
              {deck && <Badge variant="neutral" label={deck} />}
            </Stack>

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
          </Stack>
        )}

        {tags.length > 0 && (
          <Stack direction="vertical" gap={1}>
            <Heading level={3}>Community tags</Heading>
            <Stack direction="horizontal" gap={1} wrap="wrap">
              {tags.map((tag) => (
                <Badge key={tag} variant="neutral" label={tag} />
              ))}
            </Stack>
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
