import { useCallback, useEffect, useState } from 'react';
import { loadCorpus, localStorageStore, CorpusUnavailableError } from './corpus.js';
import type { LoadedCorpus } from './corpus.js';

const CORPUS_URL = '/corpus.json';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; loaded: LoadedCorpus }
  | { status: 'unavailable'; error: unknown };

function formatFreshness(generatedAt: string): string {
  const at = Date.parse(generatedAt);
  if (Number.isNaN(at)) return 'unknown';
  const hours = Math.floor((Date.now() - at) / 3_600_000);
  if (hours < 1) return 'updated just now';
  if (hours < 24) return `updated ${hours}h ago`;
  return `updated ${Math.floor(hours / 24)}d ago`;
}

export function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const load = useCallback(() => {
    setState({ status: 'loading' });
    loadCorpus({ url: CORPUS_URL, store: localStorageStore() })
      .then((loaded) => setState({ status: 'ready', loaded }))
      .catch((error: unknown) => setState({ status: 'unavailable', error }));
  }, []);

  useEffect(load, [load]);

  if (state.status === 'loading') {
    return (
      <div className="app">
        <div className="state">
          <div className="glyph spinning" />
          <h2>Reading the room</h2>
          <p>Pulling in what communities have been discussing.</p>
        </div>
      </div>
    );
  }

  if (state.status === 'unavailable') {
    const offline = state.error instanceof CorpusUnavailableError;
    return (
      <div className="app">
        <div className="state">
          <div className="glyph" />
          <h2>{offline ? 'Nothing cached yet' : 'Could not load the rankings'}</h2>
          <p>
            {offline
              ? 'GameRankScout works offline once it has loaded a ranking, but it needs a connection the first time.'
              : 'The ranking data could not be read. This is usually temporary.'}
          </p>
          <button type="button" className="button" onClick={load}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const { corpus, origin } = state.loaded;
  const failedSources = corpus.sources.filter((source) => !source.ok);

  return (
    <div className="app">
      <header className="masthead">
        <h1>GameRankScout</h1>
        <span className="freshness">{formatFreshness(corpus.generatedAt)}</span>
      </header>

      {origin === 'cache' && (
        <p className="notice">
          <span aria-hidden="true">◍</span>
          <span>
            <strong>Showing the last ranking you loaded.</strong> You are offline, so this may be
            behind what communities are discussing now.
          </span>
        </p>
      )}

      {failedSources.length > 0 && (
        <p className="notice">
          <span aria-hidden="true">◍</span>
          <span>
            <strong>
              {failedSources.map((source) => source.source).join(', ')} did not respond during the
              last update.
            </strong>{' '}
            The ranking is built from the sources that did.
          </span>
        </p>
      )}

      {corpus.games.length === 0 ? (
        <div className="state">
          <div className="glyph" />
          <h2>No games ranked yet</h2>
          <p>
            The last update finished without finding enough discussion to rank. The next scheduled
            run will try again.
          </p>
        </div>
      ) : (
        <p className="notice">
          <span aria-hidden="true">◍</span>
          <span>
            <strong>
              {corpus.games.length} {corpus.games.length === 1 ? 'game' : 'games'} ranked.
            </strong>{' '}
            The ranking view lands in U10.
          </span>
        </p>
      )}
    </div>
  );
}
