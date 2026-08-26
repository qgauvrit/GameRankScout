import { useState } from 'react';
import { Button, CheckboxInput, Dialog, Heading, Stack, Text } from '@astryxdesign/core';
import * as stylex from '@stylexjs/stylex';
import { PLATFORMS, RANKING_WINDOWS } from '../../corpus/schema.js';
import { WINDOW_LABELS, platformLabel } from '../labels.js';
import { ANY, TOP_LEVEL_GENRES } from './genres.js';
import { DEFAULT_FILTERS } from './apply.js';
import type { Filters } from './apply.js';
import type { Platform, RankingWindow } from '../../corpus/schema.js';

const styles = stylex.create({
  // A 44px touch target for the native selects (KTD2): the OS picker still opens
  // on tap, but the control the reader aims at is now full-width and tall enough
  // to hit on a phone. `block` so the select sits under its label.
  select: {
    display: 'block',
    inlineSize: '100%',
    minBlockSize: 44,
  },
  /** 44px minimum block for the touch-first controls (Filters trigger, Done, handheld). */
  touchTarget: {
    minBlockSize: 44,
  },
});

export interface FiltersSheetProps {
  filters: Filters;
  onChange: (next: Filters) => void;
  /** Community tags present in the loaded corpus, most common first. */
  tags: string[];
}

/**
 * How many narrowing filters differ from their defaults. Mode is excluded —
 * it lives on the main surface, not in the sheet (R8).
 */
export function activeFilterCount(filters: Filters): number {
  let count = 0;
  if (filters.window !== DEFAULT_FILTERS.window) count += 1;
  if (filters.platform !== DEFAULT_FILTERS.platform) count += 1;
  if (filters.genre !== DEFAULT_FILTERS.genre) count += 1;
  if (filters.tag !== DEFAULT_FILTERS.tag) count += 1;
  if (filters.handheldOnly) count += 1;
  return count;
}

/**
 * The narrowing filters (R8): timeframe, platform, genre, tag and handheld open
 * in a bottom-anchored sheet from a control that shows how many are active, so
 * they no longer take a full row above the ranking (R7). The controls stay
 * native selects — on a phone those open the platform's own picker, the largest
 * tap target available and the one that reaches the thumb (R14). Every change is
 * local state over an already-loaded corpus, so it re-renders and never fetches
 * (R12).
 *
 * The sheet is an Astryx Dialog positioned against the bottom edge; the design
 * system has no dedicated sheet primitive, so the position is what makes it one.
 */
export function FiltersSheet({ filters, onChange, tags }: FiltersSheetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const count = activeFilterCount(filters);

  return (
    <>
      <Button
        variant="secondary"
        label={count > 0 ? `Filters (${count})` : 'Filters'}
        xstyle={styles.touchTarget}
        onClick={() => setIsOpen(true)}
      />

      <Dialog
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        position={{ bottom: 0, start: 0, end: 0 }}
        width="100%"
        maxHeight="80vh"
        padding={4}
      >
        <Stack direction="vertical" gap={3}>
          <Heading level={2}>Filters</Heading>

          <label>
            <Text type="label">Timeframe</Text>
            <select
              {...stylex.props(styles.select)}
              value={filters.window}
              onChange={(event) => set({ window: event.target.value as RankingWindow })}
            >
              {RANKING_WINDOWS.map((window) => (
                <option value={window} key={window}>
                  {WINDOW_LABELS[window]}
                </option>
              ))}
            </select>
          </label>

          <label>
            <Text type="label">Platform</Text>
            <select
              {...stylex.props(styles.select)}
              value={filters.platform}
              onChange={(event) => {
                const platform = event.target.value as Platform | typeof ANY;
                // A handheld restriction the reader can no longer see is a filter
                // acting behind their back, so it is dropped with its control.
                set({ platform, ...(platform === 'pc' ? {} : { handheldOnly: false }) });
              }}
            >
              <option value={ANY}>Any platform</option>
              {PLATFORMS.map((platform) => (
                <option value={platform} key={platform}>
                  {platformLabel(platform)}
                </option>
              ))}
            </select>
          </label>

          <label>
            <Text type="label">Genre</Text>
            <select
              {...stylex.props(styles.select)}
              value={filters.genre}
              onChange={(event) => set({ genre: event.target.value })}
            >
              <option value={ANY}>Any genre</option>
              {TOP_LEVEL_GENRES.map((genre) => (
                <option value={genre.id} key={genre.id}>
                  {genre.label}
                </option>
              ))}
            </select>
          </label>

          {tags.length > 0 && (
            <label>
              <Text type="label">Tag</Text>
              <select
                {...stylex.props(styles.select)}
                value={filters.tag}
                onChange={(event) => set({ tag: event.target.value })}
              >
                <option value={ANY}>Any tag</option>
                {tags.map((tag) => (
                  <option value={tag} key={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </label>
          )}

          {filters.platform === 'pc' && (
            // The design-system checkbox (consistent with Sources/Communities),
            // kept at a 44px touch target so it stays as reachable as the raw
            // control it replaced (KTD2).
            <CheckboxInput
              label="Handheld-ready only"
              value={filters.handheldOnly}
              onChange={(checked) => set({ handheldOnly: checked })}
              xstyle={styles.touchTarget}
            />
          )}

          <Button
            variant="primary"
            label="Done"
            xstyle={styles.touchTarget}
            onClick={() => setIsOpen(false)}
          />
        </Stack>
      </Dialog>
    </>
  );
}
