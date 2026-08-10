// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { GameDetail } from './GameDetail.js';
import { STEAM_IMAGE_HOST } from './steamImage.js';
import { game, evidence } from '../../../test/factory.js';
import { rankGames } from '../../ranking/score.js';
import type { GameEntry } from '../../corpus/schema.js';

function contributingFor(entry: GameEntry) {
  const [ranked] = rankGames([entry], {
    mode: 'hiddenGems',
    window: 'week',
    now: Date.parse('2026-07-28T00:00:00.000Z'),
  });
  return ranked!.contributing;
}

function renderDetail(entry: GameEntry, onDismiss = vi.fn()) {
  return render(
    <GameDetail game={entry} contributing={contributingFor(entry)} onDismiss={onDismiss} />,
  );
}

describe('GameDetail hero image (U6)', () => {
  it('renders a decorative Steam hero for a Steam-linked game', () => {
    const entry = game({
      id: 'steam:292030',
      name: 'The Witcher 3',
      storeLinks: [{ store: 'steam', url: 'https://store.steampowered.com/app/292030/' }],
    });
    renderDetail(entry);

    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', `https://${STEAM_IMAGE_HOST}/steam/apps/292030/header.jpg`);
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    // Decorative: the section already announces the name, so alt is empty.
    expect(img).toHaveAttribute('alt', '');
  });

  it('falls back to a placeholder in the reserved frame on error (no broken image)', () => {
    const entry = game({
      id: 'steam:1',
      name: 'Signal Drift',
      storeLinks: [{ store: 'steam', url: 'https://store.steampowered.com/app/1/' }],
    });
    renderDetail(entry);

    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    // The image is swapped out; the reserved frame stays, so no layout jump.
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByLabelText(/Signal Drift store image/i)).toBeInTheDocument();
  });

  it('renders no hero when there is no Steam link', () => {
    const entry = game({
      id: 'gog:1',
      name: 'Offline Only',
      storeLinks: [{ store: 'gog', url: 'https://www.gog.com/game/foo' }],
    });
    renderDetail(entry);
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('GameDetail section headings (U7)', () => {
  it('orients the reader with a title and section headings', () => {
    const entry = game({
      id: 'steam:1',
      name: 'Signal Drift',
      tags: ['Roguelike', 'Cozy'],
      evidence: [evidence({ community: 'r/patientgamers', window: 'week' })],
    });
    renderDetail(entry);
    const detail = within(screen.getByRole('region', { name: /Signal Drift/i }));

    expect(detail.getByRole('heading', { name: 'Signal Drift' })).toBeInTheDocument();
    expect(detail.getByRole('heading', { name: /availability/i })).toBeInTheDocument();
    expect(detail.getByRole('heading', { name: /community tags/i })).toBeInTheDocument();
    expect(detail.getByRole('heading', { name: /why it ranked/i })).toBeInTheDocument();
  });

  it('omits the Community tags heading when there are no tags', () => {
    const entry = game({ id: 'steam:1', name: 'Signal Drift', tags: [] });
    renderDetail(entry);
    const detail = within(screen.getByRole('region', { name: /Signal Drift/i }));
    expect(detail.queryByRole('heading', { name: /community tags/i })).toBeNull();
  });
});
