// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ranking } from './Ranking.js';
import { rankGames } from '../../ranking/score.js';
import { evidence, game } from '../../../test/factory.js';
import type { GameEntry } from '../../corpus/schema.js';

function rank(games: GameEntry[]) {
  return rankGames(games, {
    mode: 'hiddenGems',
    window: 'week',
    now: Date.parse('2026-07-28T00:00:00.000Z'),
  });
}

function entryFor(name: string) {
  return screen.getByRole('button', { name: new RegExp(name, 'i') });
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

    render(<Ranking ranked={ranked} />);

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

    render(<Ranking ranked={ranked} />);

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

    render(<Ranking ranked={ranked} />);
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

    render(<Ranking ranked={ranked} />);
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

    render(<Ranking ranked={ranked} />);
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

    render(<Ranking ranked={ranked} />);

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

    render(<Ranking ranked={ranked} />);
    await user.click(entryFor('Signal Drift'));

    // The name and the evidence are what actually resolved, and both still show.
    expect(screen.getByText('Signal Drift')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Thread/i })).toBeTruthy();
    // A missing store link is stated rather than silently absent.
    expect(screen.getByRole('region', { name: /Signal Drift/i })).toHaveTextContent(
      /no store link/i,
    );
  });

  it('collapses an expanded entry when it is toggled again', async () => {
    const user = userEvent.setup();
    const ranked = rank([game({ id: 'steam:1', name: 'Signal Drift' })]);

    render(<Ranking ranked={ranked} />);
    const toggle = entryFor('Signal Drift');

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
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

    render(<Ranking ranked={ranked} />);

    expect(entryFor('Signal Drift')).toHaveTextContent(/2 threads.*2 communities/i);
  });

  it('renders a designed empty state rather than an empty list', () => {
    render(<Ranking ranked={[]} />);

    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('heading', { name: /nothing ranked/i })).toBeTruthy();
  });

  it('keeps entries independent, so opening one does not open another', async () => {
    const user = userEvent.setup();
    const ranked = rank([
      game({ id: 'steam:1', name: 'Signal Drift', ownerBand: { min: 20_000, max: 50_000 } }),
      game({ id: 'steam:2', name: 'Broadcast Storm' }),
    ]);

    render(<Ranking ranked={ranked} />);
    await user.click(entryFor('Signal Drift'));

    expect(screen.getByRole('region', { name: /Signal Drift/i })).toBeTruthy();
    expect(screen.queryByRole('region', { name: /Broadcast Storm/i })).toBeNull();
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

    render(<Ranking ranked={ranked} />);
    await user.click(entryFor('Signal Drift'));

    const detail = within(screen.getByRole('region', { name: /Signal Drift/i }));
    expect(detail.getByText(/Roguelike/)).toBeTruthy();
    expect(detail.getByText(/PC/)).toBeTruthy();
    expect(detail.getByText(/Switch/)).toBeTruthy();
    expect(detail.getByText(/200K/)).toBeTruthy();
    expect(detail.getByText(/Deck Verified/i)).toBeTruthy();
  });
});
