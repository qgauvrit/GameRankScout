// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterBar } from './FilterBar.js';
import { DEFAULT_FILTERS } from './apply.js';
import type { Filters } from './apply.js';

function setup(overrides: Partial<Filters> = {}, tags: string[] = ['Roguelike', 'Cozy']) {
  const filters = { ...DEFAULT_FILTERS, ...overrides };
  const onChange = vi.fn();
  render(<FilterBar filters={filters} onChange={onChange} tags={tags} />);
  return { onChange, user: userEvent.setup() };
}

describe('filter bar', () => {
  it('offers every v1 ranking mode', () => {
    setup();

    for (const mode of ['Hidden gems', 'Top', 'Most discussed', 'Breakout', 'Rising']) {
      expect(screen.getByRole('button', { name: mode })).toBeInTheDocument();
    }
  });

  it('marks the active mode as pressed rather than only styling it', () => {
    setup({ mode: 'breakout' });

    expect(screen.getByRole('button', { name: 'Breakout' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Top' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports a mode change', async () => {
    const { onChange, user } = setup();

    await user.click(screen.getByRole('button', { name: 'Most discussed' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'mostDiscussed' }));
  });

  it('offers every timeframe in R20', () => {
    setup();
    const timeframe = screen.getByLabelText(/timeframe/i);

    expect(
      [...timeframe.querySelectorAll('option')].map((option) => option.textContent),
    ).toEqual(['Past week', 'Past month', 'Past six months', 'Past year']);
  });

  it('offers every platform in R22, plus the general default', async () => {
    const { onChange, user } = setup();
    const platform = screen.getByLabelText(/platform/i);

    expect([...platform.querySelectorAll('option')].map((option) => option.value)).toEqual([
      'any',
      'pc',
      'switch',
      'switch2',
      'ps5',
      'xbox-series',
      'android',
      'ios',
    ]);

    await user.selectOptions(platform, 'ps5');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ platform: 'ps5' }));
  });

  it('offers every top-level genre in R21', () => {
    setup();
    const genre = screen.getByLabelText(/genre/i);

    expect([...genre.querySelectorAll('option')].map((option) => option.value)).toEqual([
      'any',
      'action-adventure',
      'rpg',
      'survival',
      'shooter',
      'simulation',
      'strategy',
      'sports-racing',
      'puzzle',
      'fighting',
      'horror',
    ]);
  });

  it('reaches the finer vocabulary through tags rather than more top-level genres', async () => {
    const { onChange, user } = setup({}, ['Roguelike', 'Metroidvania', 'Cozy']);
    const tag = screen.getByLabelText(/tag/i);

    expect([...tag.querySelectorAll('option')].map((option) => option.value)).toEqual([
      'any',
      'Roguelike',
      'Metroidvania',
      'Cozy',
    ]);

    await user.selectOptions(tag, 'Metroidvania');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tag: 'Metroidvania' }));
  });

  it('offers handheld filtering only inside a PC selection (R23)', () => {
    const { unmount } = renderWith({ platform: 'any' });
    expect(screen.queryByLabelText(/handheld/i)).toBeNull();
    unmount();

    renderWith({ platform: 'pc' });
    expect(screen.getByLabelText(/handheld/i)).toBeInTheDocument();
  });

  it('drops a handheld restriction the reader can no longer see', async () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        filters={{ ...DEFAULT_FILTERS, platform: 'pc', handheldOnly: true }}
        onChange={onChange}
        tags={[]}
      />,
    );

    await userEvent.setup().selectOptions(screen.getByLabelText(/platform/i), 'ps5');

    // Leaving it set would keep filtering by a control that is no longer on screen.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'ps5', handheldOnly: false }),
    );
  });

  it('hides the tag control when the corpus produced no tags', () => {
    renderWith({}, []);

    expect(screen.queryByLabelText(/tag/i)).toBeNull();
  });
});

function renderWith(overrides: Partial<Filters> = {}, tags: string[] = ['Roguelike']) {
  return render(
    <FilterBar
      filters={{ ...DEFAULT_FILTERS, ...overrides }}
      onChange={vi.fn()}
      tags={tags}
    />,
  );
}
