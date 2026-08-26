import { useEffect, useRef, useState } from 'react';
import { ClickableCard, EmptyState, HoverCard, ProgressBar, Stack, Text } from '@astryxdesign/core';
import * as stylex from '@stylexjs/stylex';
import { EvidenceSheet } from './EvidenceSheet.js';
import { ExternalLink } from './ExternalLink.js';
import { storeLabel } from '../labels.js';
import { MAX_MAGNITUDE } from '../../ranking/magnitude.js';
import type { RankedGame } from '../../ranking/score.js';

/**
 * Layout styling lives in StyleX rather than inline `style` attributes so the
 * app authors no inline styles of its own — keeping the `public/_headers` CSP
 * comment ("no inline style attributes") honest and the styling consistent with
 * the rest of the app (see the plan's KTD6). Note the Astryx `ProgressBar` still
 * emits its own inline `style` for the dynamic fill width; that is the design
 * system's, not ours.
 */
/** The entrance rows use when auto-loaded on scroll: a subtle rise into place. */
const fadeInUp = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(6px)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

const styles = stylex.create({
  /** The fixed-width column the evidence-strength meter and its readout sit in. */
  strengthMeter: {
    width: 72,
    flexShrink: 0,
  },
  /**
   * Reveal for a row auto-loaded on scroll — snappy and subtle. Applied only to
   * the newly appended rows (not the initial batch or a post-filter batch), so
   * a fresh batch rises in rather than snapping. Honors reduced-motion: the
   * animation is dropped entirely for readers who ask for less.
   */
  enter: {
    animationName: {
      default: fadeInUp,
      // Explicit `none` (not `null`, which StyleX drops) so reduced-motion
      // readers get the rows with no reveal at all.
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    animationDuration: '220ms',
    animationTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
    animationFillMode: 'both',
  },
  /** The ranked list: a plain flex column with no list chrome. */
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  /** Keeps a hover explanation to a readable measure rather than a full-width line. */
  hint: {
    maxWidth: '18rem',
  },
  // Let the name column give way when the row is tight (390px) rather than
  // pushing the meter and Steam action off-screen: `minWidth: 0` lets the flex
  // child shrink below its content's intrinsic width so its own text wraps.
  nameColumn: {
    minWidth: 0,
  },
});

/** How many entries the ranking reveals at a time (KTD1). */
const PAGE_SIZE = 25;

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

/**
 * How strong this row's evidence is, as a percentage of the strongest a row can
 * be (R10). Read from the cross-window magnitude the ranking already computes
 * ([`magnitude.ts`](../../ranking/magnitude.ts)); this view derives nothing new.
 */
function strengthPercent(entry: RankedGame): number {
  const ratio = entry.components.magnitude / MAX_MAGNITUDE;
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

function Entry({
  entry,
  position,
  onOpen,
  animate,
}: {
  entry: RankedGame;
  position: number;
  onOpen: (gameId: string) => void;
  /** True only for rows just auto-loaded on scroll, so they alone reveal. */
  animate: boolean;
}) {
  const { game } = entry;
  const primaryStore = game.storeLinks[0];
  const strength = strengthPercent(entry);

  return (
    <li {...stylex.props(animate && styles.enter)}>
      <ClickableCard label={game.name} onClick={() => onOpen(game.id)} padding={3}>
        <Stack direction="horizontal" gap={2} vAlign="center" hAlign="between">
          <Stack direction="horizontal" gap={3} vAlign="center" xstyle={styles.nameColumn}>
            <Text type="large">{position}</Text>
            <Stack direction="vertical" gap={0.5} xstyle={styles.nameColumn}>
              <Text type="body">{game.name}</Text>
              <Text type="supporting">{evidenceSummary(entry)}</Text>
            </Stack>
          </Stack>

          <Stack direction="horizontal" gap={3} vAlign="center">
            <HoverCard
              placement="above"
              content={
                <div {...stylex.props(styles.hint)}>
                  <Text type="supporting">
                    Evidence strength {strength}% — how much this game is being discussed across
                    communities and time windows, relative to the strongest entry.
                  </Text>
                </div>
              }
            >
              <Stack direction="vertical" gap={0.5} xstyle={styles.strengthMeter}>
                {/*
                  The percentage in text, so the meter is legible at a glance on
                  touch — not only on hover (R5). The progressbar keeps its own
                  accessible name; this readout is supplementary visible text.
                */}
                <Text type="supporting">{strength}% evidence</Text>
                <ProgressBar
                  value={strength}
                  max={100}
                  label={`Evidence strength for ${game.name}`}
                  isLabelHidden
                />
              </Stack>
            </HoverCard>
            {primaryStore && (
              <ExternalLink href={primaryStore.url}>{storeLabel(primaryStore.store)}</ExternalLink>
            )}
          </Stack>
        </Stack>
      </ClickableCard>
    </li>
  );
}

/**
 * The ranking itself: one row per game, its evidence one tap away in a sheet
 * that leaves the list undisturbed (R9), and a visual reading of each row's
 * strength (R10). The thread links are the product's actual output, so nothing
 * sits between the ranking and them (R13).
 *
 * The list renders in pages of {@link PAGE_SIZE} (KTD1) and auto-extends as the
 * reader nears the bottom — an IntersectionObserver on a sentinel below the
 * list appends the next page, so there is no button to press. Everything is
 * already in memory (ranking is a pure function over the loaded corpus), so
 * extending is a render, never a fetch (R12).
 */
export function Ranking({ ranked, onDismiss }: RankingProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  // How many of the (already computed) ranked entries are revealed. The default
  // view is bounded to the first page so a phone does not render hundreds of
  // rows at once (KTD1); scrolling reveals the rest.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // How many rows were shown at the previous commit. Rows at or past this index
  // are the ones this render just revealed on scroll, so only they animate in —
  // the first page and a fresh post-filter page (where the count resets down)
  // hold still. Seeded at PAGE_SIZE so the initial page never animates.
  const shownBeforeRef = useRef(PAGE_SIZE);
  const animateFrom = shownBeforeRef.current;
  useEffect(() => {
    shownBeforeRef.current = visibleCount;
  });

  // A new ranked result — a mode, filter, source, community or dismissal change —
  // starts the reveal over. Opening or closing a detail sheet does not change
  // `ranked`, so this never collapses a list the reader has expanded.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [ranked]);

  const hasMore = visibleCount < ranked.length;

  // Append the next page when the sentinel below the list scrolls into view.
  // Re-created as the window grows (visibleCount dep) so that if the sentinel is
  // still on screen after a page, re-observing fires again and fills until it is
  // pushed past the margin. `rootMargin` starts the next page a little early.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => Math.min(count + PAGE_SIZE, ranked.length));
        }
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, ranked.length, visibleCount]);

  if (ranked.length === 0) {
    return (
      <EmptyState
        headingLevel={2}
        title="Nothing ranked here"
        description="No game in the current corpus has evidence for this view. The next scheduled run may change that."
      />
    );
  }

  const openEntry = ranked.find((entry) => entry.game.id === openId) ?? null;
  // `visible` is a prefix of `ranked`, so `index + 1` stays the true rank.
  const visible = ranked.slice(0, visibleCount);

  return (
    <>
      {/*
        Slicing from the front preserves each entry's original ranking position:
        the map index is the entry's rank, so `position={index + 1}` stays correct
        as the list grows.
      */}
      <ol {...stylex.props(styles.list)}>
        {visible.map((entry, index) => (
          <Entry
            entry={entry}
            key={entry.game.id}
            position={index + 1}
            onOpen={setOpenId}
            animate={index >= animateFrom}
          />
        ))}
      </ol>
      {hasMore && <div ref={sentinelRef} aria-hidden="true" />}

      <EvidenceSheet entry={openEntry} onClose={() => setOpenId(null)} onDismiss={onDismiss} />
    </>
  );
}
