import { useState } from 'react';
import { CURATED_COMMUNITIES, RECOMMENDED_COMMUNITIES } from '../../communities/catalogue.js';
import { parseCommunityInput } from '../state/local.js';
import { sourceLabel } from '../labels.js';
import type { CommunityRef } from '../../communities/catalogue.js';
import type { ReaderState } from '../state/local.js';
import type { AdhocState } from '../adhoc/client.js';

export interface CommunitiesProps {
  state: ReaderState;
  onChange: (next: ReaderState) => void;
  /** Whether the loaded corpus carries evidence from the community with this id. */
  covered: (id: string) => boolean;
  /** How the on-demand pull is going, per community the reader added. */
  adhoc: Record<string, AdhocState>;
  onPull: (community: CommunityRef) => void;
}

const NOT_YET_SWEPT = ' · not in the current corpus yet';

/**
 * What the reader is told about a community the scheduled ingest has not swept.
 *
 * The on-demand outcome outranks corpus coverage, because a successful pull is
 * *why* the community now appears in the corpus — falling back to "covered"
 * there would replace the answer with silence at the moment it arrived.
 */
function adhocNote(state: AdhocState | undefined, covered: boolean): string {
  switch (state?.status) {
    case 'loading':
      return ' · fetching it now';
    case 'merged':
      return state.added > 0
        ? ` · ${state.added} ${state.added === 1 ? 'mention' : 'mentions'} added`
        : ' · fetched, but nothing it discussed is in this corpus yet';
    case 'failed':
      switch (state.reason) {
        case 'not_found':
          return ' · no such community';
        // Says a minute rather than tomorrow, because that is the truth: the
        // ceiling is per minute, and the pull is retried on the next load.
        case 'rate_limited':
          return ' · too many requests just now — try again in a minute';
        default:
          return ' · could not reach it — the next scheduled run will try';
      }
    default:
      return covered ? '' : NOT_YET_SWEPT;
  }
}

function Row({
  community,
  checked,
  note,
  onToggle,
  onRemove,
}: {
  community: CommunityRef;
  checked: boolean;
  /** Appended after the source name; empty when there is nothing to say. */
  note: string;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  return (
    <li>
      <label className="switch">
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <span className="switch-text">
          <span className="switch-name">{community.id}</span>
          <span className="switch-note">
            {sourceLabel(community.source)}
            {note}
          </span>
        </span>
      </label>
      {onRemove && (
        <button type="button" className="link-button" onClick={onRemove}>
          Remove
        </button>
      )}
    </li>
  );
}

/**
 * Which communities count (R1, R2, R3).
 *
 * The curated defaults are on from the start so a cold open needs no setup; the
 * recommended list is opt-in per community; and anything else can be typed in.
 * A community the reader adds cannot appear in the corpus until an ingest has
 * swept it, so the list says so rather than looking broken.
 */
export function Communities({ state, onChange, covered, adhoc, onPull }: CommunitiesProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const toggleDisabled = (id: string) =>
    onChange({
      ...state,
      disabledCommunities: state.disabledCommunities.includes(id)
        ? state.disabledCommunities.filter((entry) => entry !== id)
        : [...state.disabledCommunities, id],
    });

  const toggleRecommended = (id: string) =>
    onChange({
      ...state,
      enabledRecommended: state.enabledRecommended.includes(id)
        ? state.enabledRecommended.filter((entry) => entry !== id)
        : [...state.enabledRecommended, id],
      // Opting in should not be undone by a stale exception from earlier.
      disabledCommunities: state.disabledCommunities.filter((entry) => entry !== id),
    });

  const add = () => {
    const parsed = parseCommunityInput(draft);
    if (!parsed) {
      setError('That does not look like a community. Try r/cozygames, or a Lemmy community name.');
      return;
    }
    const known =
      state.addedCommunities.some((entry) => entry.id === parsed.id) ||
      CURATED_COMMUNITIES.some((entry) => entry.id === parsed.id) ||
      RECOMMENDED_COMMUNITIES.some((entry) => entry.id === parsed.id);
    if (known) {
      setError(`${parsed.id} is already in the list.`);
      return;
    }
    setError(null);
    setDraft('');
    onChange({ ...state, addedCommunities: [...state.addedCommunities, parsed] });
    // Pull it straight away, so an added community changes the ranking now
    // rather than at the next scheduled run (R8).
    onPull(parsed);
  };

  return (
    <section className="settings-section" aria-label="Communities">
      <h3>Communities</h3>

      <h4 className="settings-subheading">On by default</h4>
      <ul className="switch-list">
        {CURATED_COMMUNITIES.map((community) => (
          <Row
            key={community.id}
            community={community}
            checked={!state.disabledCommunities.includes(community.id)}
            note={covered(community.id) ? '' : NOT_YET_SWEPT}
            onToggle={() => toggleDisabled(community.id)}
          />
        ))}
      </ul>

      <h4 className="settings-subheading">Also recommended</h4>
      <ul className="switch-list">
        {RECOMMENDED_COMMUNITIES.map((community) => (
          <Row
            key={community.id}
            community={community}
            checked={
              state.enabledRecommended.includes(community.id) &&
              !state.disabledCommunities.includes(community.id)
            }
            note={covered(community.id) ? '' : NOT_YET_SWEPT}
            onToggle={() => toggleRecommended(community.id)}
          />
        ))}
      </ul>

      <h4 className="settings-subheading">Yours</h4>
      {state.addedCommunities.length > 0 && (
        <ul className="switch-list">
          {state.addedCommunities.map((community) => (
            <Row
              key={community.id}
              community={community}
              checked={!state.disabledCommunities.includes(community.id)}
              note={adhocNote(adhoc[community.id], covered(community.id))}
              onToggle={() => toggleDisabled(community.id)}
              onRemove={() =>
                onChange({
                  ...state,
                  addedCommunities: state.addedCommunities.filter(
                    (entry) => entry.id !== community.id,
                  ),
                })
              }
            />
          ))}
        </ul>
      )}

      <div className="add-community">
        <label className="field">
          <span className="field-label">Add a community</span>
          <input
            type="text"
            value={draft}
            placeholder="r/cozygames"
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
          />
        </label>
        <button type="button" className="button" onClick={add}>
          Add
        </button>
      </div>
      {error && (
        <p className="muted" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
