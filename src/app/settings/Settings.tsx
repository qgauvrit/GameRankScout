import { Sources } from './Sources.js';
import { Communities } from './Communities.js';
import { communityMatches } from '../../communities/catalogue.js';
import type { Corpus } from '../../corpus/schema.js';
import type { ReaderState } from '../state/local.js';
import type { CommunityRef } from '../../communities/catalogue.js';
import type { AdhocState } from '../adhoc/client.js';

export interface SettingsProps {
  state: ReaderState;
  onChange: (next: ReaderState) => void;
  corpus: Corpus;
  /** How the on-demand pull is going, per community the reader added. */
  adhoc: Record<string, AdhocState>;
  onPull: (community: CommunityRef) => void;
  onClose: () => void;
}

/**
 * Everything the reader has told GRS, in one place — and everything here is
 * reversible. A dismissal that could not be undone would be a trap, since the
 * reader cannot search for the game they hid.
 */
export function Settings({ state, onChange, corpus, adhoc, onPull, onClose }: SettingsProps) {
  const coveredCommunities = new Set(
    corpus.games.flatMap((game) => game.evidence.map((record) => record.community)),
  );
  // Evidence and catalogue speak different id spaces for Lemmy, so this is a
  // match rather than a lookup (see communityMatches).
  const covered = (id: string) =>
    [...coveredCommunities].some((community) => communityMatches(community, id));
  const dismissed = corpus.games.filter((game) => state.dismissedGameIds.includes(game.id));
  // A dismissal for a game this corpus no longer carries is still real state,
  // just unnameable; counting it keeps the tally honest.
  const unnamed = state.dismissedGameIds.length - dismissed.length;

  return (
    <div className="settings">
      <div className="settings-head">
        <h2>Settings</h2>
        <button type="button" className="button" onClick={onClose}>
          Done
        </button>
      </div>

      <Sources
        enabled={state.enabledSources}
        status={corpus.sources}
        onToggle={(source) =>
          onChange({
            ...state,
            enabledSources: state.enabledSources.includes(source)
              ? state.enabledSources.filter((entry) => entry !== source)
              : [...state.enabledSources, source],
          })
        }
      />

      <Communities
        state={state}
        onChange={onChange}
        covered={covered}
        adhoc={adhoc}
        onPull={onPull}
      />

      <section className="settings-section" aria-label="Dismissed games">
        <h3>Dismissed games</h3>
        {state.dismissedGameIds.length === 0 ? (
          <p className="muted">
            Nothing dismissed. Games you dismiss stay out of every ranking until you bring them
            back here.
          </p>
        ) : (
          <>
            <ul className="switch-list">
              {dismissed.map((game) => (
                <li key={game.id}>
                  <span className="switch-text">
                    <span className="switch-name">{game.name}</span>
                  </span>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() =>
                      onChange({
                        ...state,
                        dismissedGameIds: state.dismissedGameIds.filter(
                          (id) => id !== game.id,
                        ),
                      })
                    }
                  >
                    Bring back
                  </button>
                </li>
              ))}
            </ul>
            {unnamed > 0 && (
              <p className="muted">
                {unnamed} more {unnamed === 1 ? 'game is' : 'games are'} dismissed but not in the
                current corpus.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
