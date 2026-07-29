// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.js';
import { MIN_USEFUL_RESULTS } from './filters/apply.js';
import { serializeCorpus } from '../corpus/schema.js';
import { corpus, evidence, game, sourceStatus } from '../../test/factory.js';
import type { Corpus } from '../corpus/schema.js';

/**
 * These go through the real load path — fetch, validate, cache, rank, render —
 * rather than mocking the corpus in. The failure the app has to survive is a
 * partly-broken run reaching the browser, and that only shows end to end.
 */
function serveCorpus(value: Corpus) {
  const body = serializeCorpus(value);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status: 200 })),
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('app shell', () => {
  it('renders the ranking once the corpus loads', async () => {
    serveCorpus(
      corpus({
        games: [game({ id: 'steam:1', name: 'Signal Drift' })],
      }),
    );

    render(<App />);

    expect(await screen.findByRole('button', { name: /Signal Drift/i })).toBeInTheDocument();
  });

  it('surfaces a failed source so a thinned ranking is visible, not silent', async () => {
    serveCorpus(
      corpus({
        games: [game({ id: 'steam:1', name: 'Signal Drift' })],
        sources: [
          sourceStatus({ source: 'reddit', ok: true }),
          sourceStatus({
            source: 'lemmy',
            ok: false,
            evidenceCount: 0,
            communitiesCovered: 0,
            error: 'HTTP 503',
          }),
        ],
      }),
    );

    render(<App />);

    const notice = await screen.findByText(/did not respond during the last update/i);
    expect(notice).toHaveTextContent('Lemmy');
    // Degraded, not broken: the ranking still renders alongside the warning.
    expect(screen.getByRole('button', { name: /Signal Drift/i })).toBeInTheDocument();
  });

  it('does not warn about sources when every one succeeded', async () => {
    serveCorpus({
      ...corpus({ games: [game({ id: 'steam:1', name: 'Signal Drift' })] }),
      sources: [sourceStatus({ source: 'reddit' }), sourceStatus({ source: 'lemmy' })],
    });

    render(<App />);
    await screen.findByRole('button', { name: /Signal Drift/i });

    expect(screen.queryByText(/did not respond/i)).toBeNull();
  });

  it('reaches a discussion thread from the ranking in one interaction', async () => {
    const user = userEvent.setup();
    serveCorpus(
      corpus({
        games: [
          game({
            id: 'steam:1',
            name: 'Signal Drift',
            evidence: [
              evidence({
                community: 'r/patientgamers',
                window: 'week',
                thread: {
                  id: 't3_aaa',
                  title: 'Anyone else playing this?',
                  permalink: 'https://reddit.test/comments/aaa/',
                },
              }),
            ],
          }),
        ],
      }),
    );

    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Signal Drift/i }));

    expect(screen.getByRole('link', { name: /Anyone else playing this/i })).toHaveAttribute(
      'href',
      'https://reddit.test/comments/aaa/',
    );
  });

  it('states the corpus is empty rather than rendering a blank ranking', async () => {
    serveCorpus(corpus({ games: [] }));

    render(<App />);

    expect(await screen.findByRole('heading', { name: /no games ranked yet/i })).toBeInTheDocument();
  });

  it('covers AE1: widens the timeframe and says so when a filter combination is sparse', async () => {
    serveCorpus(
      corpus({
        games: [
          game({
            id: 'steam:0',
            name: 'Lonely Week',
            evidence: [evidence({ community: 'r/patientgamers', window: 'week' })],
          }),
          ...Array.from({ length: MIN_USEFUL_RESULTS }, (_, index) =>
            game({
              id: `steam:m${index}`,
              name: `Month Game ${index}`,
              evidence: [evidence({ community: 'r/patientgamers', window: 'month' })],
            }),
          ),
        ],
      }),
    );

    render(<App />);

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent(/not much matched in the past week/i);
    expect(notice).toHaveTextContent(/widened the timeframe to the past month/i);
    expect(notice).toHaveTextContent(/every other filter is untouched/i);
    expect(screen.getByRole('button', { name: /Month Game 0/i })).toBeInTheDocument();
  });

  it('re-ranks on a filter change without going back to the network', async () => {
    const user = userEvent.setup();
    serveCorpus(
      corpus({
        games: [
          game({ id: 'steam:1', name: 'Console Pick', platforms: ['ps5'] }),
          game({ id: 'steam:2', name: 'Desktop Pick', platforms: ['pc'] }),
        ],
      }),
    );

    render(<App />);
    await screen.findByRole('button', { name: /Console Pick/i });

    await user.selectOptions(screen.getByLabelText(/platform/i), 'ps5');

    // The new ranking is simply there — no loading state in between (R32) and
    // no second fetch, because ranking is a pure function over what is loaded.
    expect(screen.queryByRole('heading', { name: /reading the room/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Console Pick/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Desktop Pick/i })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('states honestly when a filter combination matches nothing at any timeframe', async () => {
    const user = userEvent.setup();
    serveCorpus(
      corpus({ games: [game({ id: 'steam:1', name: 'Desktop Pick', platforms: ['pc'] })] }),
    );

    render(<App />);
    await screen.findByRole('button', { name: /Desktop Pick/i });

    await user.selectOptions(screen.getByLabelText(/platform/i), 'ios');

    expect(screen.getByRole('heading', { name: /nothing matches those filters/i })).toBeInTheDocument();
    // Nothing was widened, because widening could not have helped.
    expect(screen.queryByRole('status')).toBeNull();

    await user.click(screen.getByRole('button', { name: /reset filters/i }));
    expect(screen.getByRole('button', { name: /Desktop Pick/i })).toBeInTheDocument();
  });

  it('says it is showing a cached ranking when the network is unreachable', async () => {
    const cached = corpus({ games: [game({ id: 'steam:1', name: 'Signal Drift' })] });
    localStorage.setItem('grs:corpus:v1', serializeCorpus(cached));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );

    render(<App />);

    expect(await screen.findByText(/showing the last ranking you loaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Signal Drift/i })).toBeInTheDocument();
  });
});
