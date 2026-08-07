// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.js';
import { serializeCorpus } from '../corpus/schema.js';
import { corpus, evidence, game, sourceStatus } from '../../test/factory.js';
import type { Corpus } from '../corpus/schema.js';

/**
 * R35: every state a reader can reach has designed copy of its own, rather than
 * a blank screen or a fallback that happens to render. Each case here asserts
 * the specific words, because the failure this guards against is a state that
 * renders *something* and says nothing.
 */

function serve(value: Corpus) {
  const body = serializeCorpus(value);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
}

function offline() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('offline');
    }),
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('every reachable state is a designed one', () => {
  it('first run: says what the default lens is, and stops saying it once acknowledged', async () => {
    const user = userEvent.setup();
    serve(corpus({ games: [game({ id: 'steam:1', name: 'Signal Drift' })] }));

    const { unmount } = render(<App />);
    expect(await screen.findByText(/this is hidden gems/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /got it/i }));
    expect(screen.queryByText(/this is hidden gems/i)).toBeNull();

    // And it does not come back on the next visit.
    unmount();
    render(<App />);
    await screen.findByRole('button', { name: /Signal Drift/i });
    expect(screen.queryByText(/this is hidden gems/i)).toBeNull();
  });

  it('cold open: renders a usable ranking with no configuration (R31)', async () => {
    serve(
      corpus({
        games: Array.from({ length: 8 }, (_, index) =>
          game({ id: `steam:${index}`, name: `Game ${index}` }),
        ),
      }),
    );

    render(<App />);

    // Ranked, ordered and actionable before the reader touches anything.
    expect(await screen.findByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    expect(screen.getAllByRole('link', { name: /steam/i }).length).toBeGreaterThan(0);
  });

  it('empty: says the last update found nothing, not just an empty page', async () => {
    serve(corpus({ games: [] }));

    render(<App />);

    expect(await screen.findByRole('heading', { name: /no games ranked yet/i })).toBeInTheDocument();
    expect(screen.getByText(/the next scheduled run will try again/i)).toBeInTheDocument();
  });

  it('offline with nothing cached: explains why, and offers a retry', async () => {
    offline();

    render(<App />);

    expect(await screen.findByRole('heading', { name: /nothing cached yet/i })).toBeInTheDocument();
    expect(screen.getByText(/needs a connection the first time/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('offline with a cache: says the ranking may be stale rather than pretending', async () => {
    localStorage.setItem(
      'grs:corpus:v1',
      serializeCorpus(corpus({ games: [game({ id: 'steam:1', name: 'Signal Drift' })] })),
    );
    offline();

    render(<App />);

    expect(await screen.findByText(/showing the last ranking you loaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Signal Drift/i })).toBeInTheDocument();
  });

  it('offline behind a warm service worker: still says the ranking has stopped refreshing', async () => {
    // The service worker answers /corpus.json from its own cache, so the fetch
    // succeeds and the load path sees nothing wrong. The device knowing it has
    // no network is the only signal left.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    serve(corpus({ games: [game({ id: 'steam:1', name: 'Signal Drift' })] }));

    render(<App />);

    expect(await screen.findByText(/showing the last ranking you loaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Signal Drift/i })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('degraded source: names the source that failed and what it costs', async () => {
    serve(
      corpus({
        games: [game({ id: 'steam:1', name: 'Signal Drift' })],
        sources: [sourceStatus({ source: 'lemmy', ok: false, error: 'HTTP 503' })],
      }),
    );

    render(<App />);

    expect(await screen.findByText(/did not respond during the last update/i)).toHaveTextContent(
      /Lemmy/,
    );
    expect(screen.getByText(/thinner than usual/i)).toBeInTheDocument();
  });

  it('momentum unavailable: says the mode has nothing recent to compare against', async () => {
    const user = userEvent.setup();
    serve(
      corpus({
        games: [
          game({
            id: 'steam:1',
            name: 'Signal Drift',
            // A run scoped to the year window leaves Breakout nothing to divide.
            windowWeights: { week: 0, month: 0, sixMonths: 0, year: 1 },
            evidence: [evidence({ community: 'r/patientgamers', window: 'year' })],
          }),
        ],
      }),
    );

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Breakout' }));

    expect(screen.getByText(/breakout has nothing recent to compare against/i)).toBeInTheDocument();
    expect(screen.getByText(/without any sense of momentum/i)).toBeInTheDocument();
  });

  it('momentum available: stays quiet when the mode can actually say something', async () => {
    const user = userEvent.setup();
    serve(
      corpus({
        games: [
          game({
            id: 'steam:1',
            name: 'Signal Drift',
            windowWeights: { week: 1, month: 1, sixMonths: 1, year: 1 },
          }),
        ],
      }),
    );

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Breakout' }));

    expect(screen.queryByText(/nothing recent to compare against/i)).toBeNull();
  });

  it('sparse: says it widened the timeframe and which filter gave way', async () => {
    serve(
      corpus({
        games: [
          game({
            id: 'steam:1',
            name: 'Signal Drift',
            evidence: [evidence({ community: 'r/patientgamers', window: 'year' })],
          }),
        ],
      }),
    );

    render(<App />);

    // By text, not role="status": Astryx buttons add their own status
    // announcers, so the role is no longer unique to this notice (U4 collapses
    // the notices into one status line).
    expect(await screen.findByText(/widened the timeframe/i)).toBeInTheDocument();
  });
});

describe('one-handed operation on a phone (R33)', () => {
  it('offers every filter and mode control at a full tap-target size', async () => {
    serve(corpus({ games: [game({ id: 'steam:1', name: 'Signal Drift' })] }));

    render(<App />);
    await screen.findByRole('button', { name: /Signal Drift/i });

    // The stylesheet is not applied in jsdom, so this asserts the structural
    // property behind reachability: nothing is hover-only, drag-only, or nested
    // out of reach. Actual sizes are measured in the browser check.
    for (const label of [/timeframe/i, /platform/i, /genre/i]) {
      expect(screen.getByLabelText(label).tagName).toBe('SELECT');
    }
    for (const mode of ['Hidden gems', 'Top', 'Most discussed', 'Breakout', 'Rising']) {
      expect(screen.getByRole('button', { name: mode })).toBeEnabled();
    }
    expect(screen.getByRole('button', { name: /settings/i })).toBeEnabled();
  });

  it('reaches a thread and the settings surface without a pointer-only gesture', async () => {
    const user = userEvent.setup();
    serve(corpus({ games: [game({ id: 'steam:1', name: 'Signal Drift' })] }));

    render(<App />);
    // Keyboard reachability is the portable proxy for "no gesture required":
    // anything a tab and an enter can drive, a thumb can drive.
    await user.tab();
    expect(document.activeElement).not.toBe(document.body);

    await user.click(await screen.findByRole('button', { name: /Signal Drift/i }));
    expect(screen.getByRole('link', { name: /Thread/i })).toBeInTheDocument();
  });
});
