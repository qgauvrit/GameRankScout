import { PLATFORMS, RANKING_WINDOWS } from '../../corpus/schema.js';
import { MODE_LABELS, WINDOW_LABELS, platformLabel } from '../labels.js';
import { ANY, TOP_LEVEL_GENRES } from './genres.js';
import type { Filters } from './apply.js';
import type { Platform, RankingWindow } from '../../corpus/schema.js';
import type { RankingMode } from '../../ranking/modes.js';

const MODES = Object.keys(MODE_LABELS) as RankingMode[];

export interface FilterBarProps {
  filters: Filters;
  onChange: (next: Filters) => void;
  /** Community tags present in the loaded corpus, most common first. */
  tags: string[];
}

/**
 * The reader's controls (R20–R23).
 *
 * Mode sits on its own row as pressable chips because it is the lens the whole
 * ranking is read through and is changed most often. The narrowing filters are
 * native selects: on a phone those open the platform's own picker, which is
 * both the largest tap target available and the one that reaches the thumb
 * (R33). Everything here is local state over an already-loaded corpus, so a
 * change is a re-render and never a fetch (R32).
 */
export function FilterBar({ filters, onChange, tags }: FilterBarProps) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  return (
    <div className="filters">
      <div className="modes" role="group" aria-label="Ranking mode">
        {MODES.map((mode) => (
          <button
            type="button"
            key={mode}
            className={`mode${mode === filters.mode ? ' active' : ''}`}
            aria-pressed={mode === filters.mode}
            onClick={() => set({ mode })}
          >
            {MODE_LABELS[mode]}
          </button>
        ))}
      </div>

      <div className="filter-row">
        <label className="field">
          <span className="field-label">Timeframe</span>
          <select
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

        <label className="field">
          <span className="field-label">Platform</span>
          <select
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

        <label className="field">
          <span className="field-label">Genre</span>
          <select value={filters.genre} onChange={(event) => set({ genre: event.target.value })}>
            <option value={ANY}>Any genre</option>
            {TOP_LEVEL_GENRES.map((genre) => (
              <option value={genre.id} key={genre.id}>
                {genre.label}
              </option>
            ))}
          </select>
        </label>

        {tags.length > 0 && (
          <label className="field">
            <span className="field-label">Tag</span>
            <select value={filters.tag} onChange={(event) => set({ tag: event.target.value })}>
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
          <label className="field field-check">
            <input
              type="checkbox"
              checked={filters.handheldOnly}
              onChange={(event) => set({ handheldOnly: event.target.checked })}
            />
            <span>Handheld-ready only</span>
          </label>
        )}
      </div>
    </div>
  );
}
