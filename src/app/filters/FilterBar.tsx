import { Button, HoverCard, Icon, IconButton, Stack, Text } from '@astryxdesign/core';
import { MODE_DESCRIPTIONS, MODE_LABELS } from '../labels.js';
import { FiltersSheet } from './FiltersSheet.js';
import type { Filters } from './apply.js';
import type { RankingMode } from '../../ranking/modes.js';

const MODES = Object.keys(MODE_LABELS) as RankingMode[];

export interface FilterBarProps {
  filters: Filters;
  onChange: (next: Filters) => void;
  /** Community tags present in the loaded corpus, most common first. */
  tags: string[];
}

/**
 * The reader's controls (R20–R23, R8).
 *
 * Mode stays on the main surface as pressable chips because it is the lens the
 * whole ranking is read through and is changed most often; the active mode is
 * the primary emphasis, so it carries the orange accent (R3). The narrowing
 * filters move behind a single control into a sheet ({@link FiltersSheet}), so
 * they no longer take a full row above the ranking (R7, R8). Everything here is
 * local state over an already-loaded corpus, so a change is a re-render and
 * never a fetch (R12).
 */
export function FilterBar({ filters, onChange, tags }: FilterBarProps) {
  return (
    <Stack direction="horizontal" gap={2} vAlign="center" wrap="wrap">
      <Stack direction="horizontal" gap={1} wrap="wrap" vAlign="center" role="group" aria-label="Ranking mode">
        {MODES.map((mode) => (
          <Button
            key={mode}
            variant={mode === filters.mode ? 'primary' : 'ghost'}
            aria-pressed={mode === filters.mode}
            label={MODE_LABELS[mode]}
            onClick={() => onChange({ ...filters, mode })}
          />
        ))}
        {/*
          What the active lens means, one hover/focus away — replaces the intro
          notice that used to sit across the top and linger when the mode changed.
        */}
        <HoverCard
          placement="below"
          content={<Text type="body">{MODE_DESCRIPTIONS[filters.mode]}</Text>}
        >
          <IconButton
            variant="ghost"
            size="sm"
            label={`What ${MODE_LABELS[filters.mode]} means`}
            icon={<Icon icon="info" />}
          />
        </HoverCard>
      </Stack>

      <FiltersSheet filters={filters} onChange={onChange} tags={tags} />
    </Stack>
  );
}
