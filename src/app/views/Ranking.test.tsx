// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ranking } from './Ranking.js';
import { rankGames } from '../../ranking/score.js';
import { evidence, game } from '../../../test/factory.js';
import type { RankedGame } from '../../ranking/score.js';
import type { GameEntry } from '../../corpus/schema.js';

function rank(games: GameEntry[]) {
  return rankGames(games, {
    mode: 'hiddenGems',
    window: 'week',
    now: Date.parse('2026-07-28T00:00:00.000Z'),
  });
}

function renderRanking(ranked: RankedGame[], onDismiss = vi.fn()) {
  const result = render(<Ranking ranked={ranked} onDismiss={onDismiss} />);
  return { ...result, onDismiss };
}

function entryFor(name: string) {
  return screen.getByRole('button', { name: new RegExp(name, 'i') });
}

/** A ranked list of `count` distinct games, for exercising the reveal control. */
function manyRanked(count: number) {
  return rank(
    Array.from({ length: count }, (_, index) =>
      game({ id: `steam:${index + 1}`, name: `Game ${index + 1}` }),
    ),
  );
}

describe('ranking view', () => {
  it('renders every ranked game in order, with its position', () => {
    const ranked = rank([
      game({
        id: 'steam:1',
        name: 'Signal Drift',
        ownerBand: { min: 20_000, max: 50_000 },
      }),
      game({
        id: 'steam:2',
        name: 'Broadcast Storm',
        ownerBand: { min: 5_000_000, max: 10_000_000 },
      }),
    ]);

    renderRanking(ranked);

    const entries = screen.getAllByRole('listitem');
    expect(entries).toHaveLength(2);
    // Obscurity is the default lens, so the less-owned game leads (D4).
    expect(entries[0]!).toHaveTextContent('Signal Drift');
    expect(entries[0]!).toHaveTextContent('1');
    expect(entries[1]!).toHaveTextContent('Broadcast Storm');
  });

  it('exposes a game’s contributing threads in one interaction', async () => {
    const user = userEvent.setup();
    const ranked = rank([
      game({
        id: 'steam:1',
        name: 'Signal Drift',
        evidence: [
          evidence({
            community: 'r/patientgamers',
            window: 'week',
            thread: {
              id: 't3_aaa',
              title: 'What did you play this week?',
              permalink: 'https://reddit.test/comments/aaa/',
            },
          }),
        ],
      }),
    ]);

    renderRanking(ranked);

    // Nothing before the interaction...
    expect(screen.queryByRole('link', { name: /What did you play this week/i })).toBeNull();

    await user.click(entryFor('Signal Drift'));

    // ...and the discussion is reachable after exactly one.
    const thread = screen.getByRole('link', { name: /What did you play this week/i });
    expect(thread).toHaveAttribute('href', 'https://reddit.test/comments/aaa/');
  });

  it('opens thread links in a new context without leaking the referrer', async () => {
    const user = userEvent.setup();
    const ranked = rank([game({ id: 'steam:1', name: 'Signal Drift' })]);

    renderRanking(ranked);
    await user.click(entryFor('Signal Drift'));

    const thread = screen.getByRole('link', { name: /Thread/i });
    expect(thread).toHaveAttribute('target', '_blank');
    expect(thread.getAttribute('rel')).toContain('noreferrer');
  });

  it('names the community each thread came from', async () => {
    const user = userEvent.setup();
    const ranked = rank([
      game({
        id: 'steam:1',
        name: 'Signal Drift',
        evidence: [
          evidence({ community: 'r/patientgamers', window: 'week' }),
          evidence({ community: 'lemmy.world/c/games', window: 'week', source: 'lemmy' }),
        ],
      }),
    ]);

    renderRanking(ranked);
    await user.click(entryFor('Signal Drift'));

    const detail = screen.getByRole('region', { name: /Signal Drift/i });
    expect(detail).toHaveTextContent('r/patientgamers');
    expect(detail).toHaveTextContent('lemmy.world/c/games');
  });

  it('lists a thread once even when it appears in several windows', async () => {
    const user = userEvent.setup();
    const thread = {
      id: 't3_big',
      title: 'The one everyone read',
      permalink: 'https://reddit.test/comments/big/',
    };
    const ranked = rank([
      game({
        id: 'steam:1',
        name: 'Signal Drift',
        evidence: [
          evidence({ community: 'r/patientgamers', window: 'week', thread }),
          evidence({ community: 'r/patientgamers', window: 'year', thread }),
        ],
      }),
    ]);

    renderRanking(ranked);
    await user.click(entryFor('Signal Drift'));

    expect(screen.getAllByRole('link', { name: /The one everyone read/i })).toHaveLength(1);
  });

  it('links out to the store page (R12)', () => {
    const ranked = rank([
      game({
        id: 'steam:1',
        name: 'Signal Drift',
        storeLinks: [{ store: 'steam', url: 'https://store.steampowered.com/app/9/' }],
      }),
    ]);

    renderRanking(ranked);

    expect(screen.getByRole('link', { name: /Steam/i })).toHaveAttribute(
      'href',
      'https://store.steampowered.com/app/9/',
    );
  });

  it('renders a game whose metadata lookup failed with the fields that resolved', async () => {
    const user = userEvent.setup();
    const ranked = rank([
      game({
        id: 'steam:1',
        name: 'Signal Drift',
        storeLinks: [],
        tags: [],
        genres: [],
        ownerBand: null,
        reviewCount: null,
        handheld: null,
      }),
    ]);

    renderRanking(ranked);
    await user.click(entryFor('Signal Drift'));

    // The name and the evidence are what actually resolved, and both still show.
    const detail = within(screen.getByRole('region', { name: /Signal Drift/i }));
    expect(detail.getByRole('heading', { name: 'Signal Drift' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Thread/i })).toBeTruthy();
    // A missing store link is stated rather than silently absent.
    expect(screen.getByRole('region', { name: /Signal Drift/i })).toHaveTextContent(
      /no store link/i,
    );
  });

  it('opens the evidence in a sheet and closes it again (R9)', async () => {
    const user = userEvent.setup();
    const ranked = rank([game({ id: 'steam:1', name: 'Signal Drift' })]);

    renderRanking(ranked);

    expect(screen.queryByRole('region', { name: /Signal Drift/i })).toBeNull();
    await user.click(entryFor('Signal Drift'));
    expect(screen.getByRole('region', { name: /Signal Drift/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('region', { name: /Signal Drift/i })).toBeNull();
  });

  it('summarises the evidence behind an entry before it is opened', () => {
    const ranked = rank([
      game({
        id: 'steam:1',
        name: 'Signal Drift',
        evidence: [
          evidence({ community: 'r/patientgamers', window: 'week' }),
          evidence({ community: 'r/gamingsuggestions', window: 'week' }),
        ],
      }),
    ]);

    renderRanking(ranked);

    // The summary is on the row, visible before the sheet is opened.
    expect(screen.getByText(/2 threads across 2 communities/i)).toBeInTheDocument();
  });

  it('reads out a stronger row for more cross-window evidence (R10)', () => {
    const strongThread = {
      id: 't_strong',
      title: 'Discussed everywhere',
      permalink: 'https://reddit.test/comments/strong/',
    };
    const weakThread = {
      id: 't_weak',
      title: 'Discussed once',
      permalink: 'https://reddit.test/comments/weak/',
    };
    const ranked = rank([
      game({
        id: 'steam:1',
        name: 'Strong Signal',
        evidence: [
          evidence({ community: 'r/a', window: 'week', thread: strongThread }),
          evidence({ community: 'r/a', window: 'month', thread: strongThread }),
          evidence({ community: 'r/a', window: 'year', thread: strongThread }),
        ],
      }),
      game({
        id: 'steam:2',
        name: 'Weak Signal',
        evidence: [evidence({ community: 'r/a', window: 'week', thread: weakThread })],
      }),
    ]);

    renderRanking(ranked);

    const strong = screen.getByRole('progressbar', { name: /Strong Signal/i });
    const weak = screen.getByRole('progressbar', { name: /Weak Signal/i });
    expect(Number(strong.getAttribute('aria-valuenow'))).toBeGreaterThan(
      Number(weak.getAttribute('aria-valuenow')),
    );
  });

  it('shows each row’s evidence strength as a visible percentage (R5)', () => {
    const ranked = rank([game({ id: 'steam:1', name: 'Signal Drift' })]);
    renderRanking(ranked);

    // The number the reader sees matches the meter, without needing hover.
    const bar = screen.getByRole('progressbar', { name: /Signal Drift/i });
    const percent = Number(bar.getAttribute('aria-valuenow'));
    expect(screen.getByText(`${percent}% evidence`)).toBeInTheDocument();
  });

  it('offers to dismiss a game from its own evidence panel', async () => {
    const user = userEvent.setup();
    const ranked = rank([game({ id: 'steam:1', name: 'Signal Drift' })]);

    const { onDismiss } = renderRanking(ranked);
    await user.click(entryFor('Signal Drift'));
    await user.click(screen.getByRole('button', { name: /hide this game/i }));

    expect(onDismiss).toHaveBeenCalledWith('steam:1');
  });

  it('renders a designed empty state rather than an empty list', () => {
    renderRanking([]);

    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('heading', { name: /nothing ranked/i })).toBeTruthy();
  });

  it('keeps entries independent, so opening one does not open another', async () => {
    const user = userEvent.setup();
    const ranked = rank([
      game({ id: 'steam:1', name: 'Signal Drift', ownerBand: { min: 20_000, max: 50_000 } }),
      game({ id: 'steam:2', name: 'Broadcast Storm' }),
    ]);

    renderRanking(ranked);
    await user.click(entryFor('Signal Drift'));

    expect(screen.getByRole('region', { name: /Signal Drift/i })).toBeTruthy();
    expect(screen.queryByRole('region', { name: /Broadcast Storm/i })).toBeNull();
  });

  it('bounds the initial list to one page and reveals the rest on demand (U2)', async () => {
    const user = userEvent.setup();
    renderRanking(manyRanked(26));

    // First page only, with a control that reveals exactly what remains.
    expect(screen.getAllByRole('listitem')).toHaveLength(25);
    expect(screen.getByText('25 of 26 games shown')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));

    // The whole list, in unbroken ordinal order, with the control gone.
    const entries = screen.getAllByRole('listitem');
    expect(entries).toHaveLength(26);
    expect(entries[25]!).toHaveTextContent('26');
    expect(screen.queryByRole('button', { name: /show \d+ more/i })).toBeNull();
  });

  it('reveals in equal pages when the list divides evenly (U2)', async () => {
    const user = userEvent.setup();
    renderRanking(manyRanked(50));

    expect(screen.getAllByRole('listitem')).toHaveLength(25);
    await user.click(screen.getByRole('button', { name: 'Show 25 more' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    expect(screen.queryByRole('button', { name: /show \d+ more/i })).toBeNull();
  });

  it('shows no reveal control when a single page holds everything (U2)', () => {
    renderRanking(manyRanked(25));

    expect(screen.getAllByRole('listitem')).toHaveLength(25);
    expect(screen.queryByRole('button', { name: /show \d+ more/i })).toBeNull();
    expect(screen.queryByText(/games shown/i)).toBeNull();
  });

  it('resets to the first page when the ranked input changes (U2)', async () => {
    const user = userEvent.setup();
    const { rerender } = renderRanking(manyRanked(30));

    await user.click(screen.getByRole('button', { name: 'Show 5 more' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(30);

    // A new ranked result (a filter or mode change) starts the reveal over.
    rerender(<Ranking ranked={manyRanked(40)} onDismiss={vi.fn()} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(25);
    expect(screen.getByText('25 of 40 games shown')).toBeInTheDocument();
  });

  it('keeps the revealed list intact when a detail sheet opens (U2)', async () => {
    const user = userEvent.setup();
    renderRanking(manyRanked(26));

    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(26);

    // Opening an entry must not collapse the list back to the first page.
    // "Game 26" is unambiguous where "Game 1" would also match Game 10–19.
    await user.click(entryFor('Game 26'));
    expect(screen.getByRole('region', { name: /Game 26/i })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(26);
  });

  it('shows the metadata filtering is built on', async () => {
    const user = userEvent.setup();
    const ranked = rank([
      game({
        id: 'steam:1',
        name: 'Signal Drift',
        platforms: ['pc', 'switch'],
        tags: ['Roguelike', 'Cozy'],
        ownerBand: { min: 200_000, max: 500_000 },
        handheld: { deck: 'verified', protonTier: 'platinum' },
      }),
    ]);

    renderRanking(ranked);
    await user.click(entryFor('Signal Drift'));

    const detail = within(screen.getByRole('region', { name: /Signal Drift/i }));
    expect(detail.getByText(/Roguelike/)).toBeTruthy();
    expect(detail.getByText(/PC/)).toBeTruthy();
    expect(detail.getByText(/Switch/)).toBeTruthy();
    expect(detail.getByText(/200K/)).toBeTruthy();
    expect(detail.getByText(/Deck Verified/i)).toBeTruthy();
  });
});
