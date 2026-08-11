import { useState, type ReactNode } from 'react';
import { Banner, Button, Stack } from '@astryxdesign/core';

/** The tones a notice can carry, mapped to the Astryx Banner status. */
export type StatusTone = 'info' | 'warning';

export interface StatusItem {
  /** Stable key for the list. */
  key: string;
  /** Severity tone — warnings sort ahead of info and are never collapsed. */
  tone: StatusTone;
  /** The lead line of the notice (Banner title). */
  title: ReactNode;
  /** The rest of the notice, including any action (Banner description). */
  description?: ReactNode;
  /** When true, the status announces itself to assistive tech (role="status"). */
  live?: boolean;
}

/** How many notices stay on the surface before the rest collapse (R2). */
const VISIBLE_LIMIT = 3;

/** Warnings first, then info; order within a tone is preserved (stable). */
const TONE_RANK: Record<StatusTone, number> = { warning: 0, info: 1 };

function bySeverity(items: StatusItem[]): StatusItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => TONE_RANK[a.item.tone] - TONE_RANK[b.item.tone] || a.index - b.index)
    .map(({ item }) => item);
}

function NoticeBanner({ status }: { status: StatusItem }) {
  const banner = (
    <Banner status={status.tone} title={status.title} description={status.description} />
  );
  // Preserve the live-region announcement the momentum/relaxed notices rely on.
  return status.live ? <div role="status">{banner}</div> : banner;
}

/**
 * Every active ranking notice, visible on the surface (R2).
 *
 * Notices used to hide behind a grey collapsible trigger — densest on a cold
 * open, exactly when the reader most needs to see them. Here each is an Astryx
 * `Banner` tinted by its tone, stacked and visible by default. When more than
 * {@link VISIBLE_LIMIT} are active, only the lowest-priority overflow collapses
 * behind one control: a warning or a `live` notice is never hidden — a warning
 * is always worth seeing, and a live notice must stay in the DOM to announce
 * (`role="status"`). Nothing renders when nothing is active.
 */
export function StatusLine({ statuses }: { statuses: StatusItem[] }) {
  const [expanded, setExpanded] = useState(false);
  if (statuses.length === 0) return null;

  const ordered = bySeverity(statuses);
  // Only quiet, non-live info notices are ever collapsible.
  const collapsibleKeys = ordered.filter((s) => s.tone !== 'warning' && !s.live).map((s) => s.key);
  const overflow = Math.min(Math.max(0, ordered.length - VISIBLE_LIMIT), collapsibleKeys.length);
  // Hide the lowest-priority collapsible notices (they sort last), if overflowing.
  const hiddenKeys = new Set(
    expanded || overflow === 0 ? [] : collapsibleKeys.slice(collapsibleKeys.length - overflow),
  );
  const shown = ordered.filter((s) => !hiddenKeys.has(s.key));
  const hiddenCount = hiddenKeys.size;

  return (
    <Stack direction="vertical" gap={2}>
      {shown.map((status) => (
        <NoticeBanner key={status.key} status={status} />
      ))}
      {hiddenCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          label={`Show ${hiddenCount} more`}
          onClick={() => setExpanded(true)}
        />
      )}
    </Stack>
  );
}
