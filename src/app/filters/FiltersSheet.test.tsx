// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FiltersSheet, activeFilterCount } from './FiltersSheet.js';
import { DEFAULT_FILTERS } from './apply.js';
import type { Filters } from './apply.js';

function setup(overrides: Partial<Filters> = {}, tags: string[] = ['Roguelike']) {
  const filters = { ...DEFAULT_FILTERS, ...overrides };
  const onChange = vi.fn();
  const view = render(<FiltersSheet filters={filters} onChange={onChange} tags={tags} />);
  return { onChange, user: userEvent.setup(), view };
}

describe('filters sheet (R8, R12)', () => {
  it('counts only the narrowing filters that differ from default, never mode', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, mode: 'breakout' })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, platform: 'ps5', genre: 'rpg' })).toBe(2);
  });

  it('shows no count on the control when every narrowing filter is default', () => {
    setup();
    expect(screen.getByRole('button', { name: /^filters$/i })).toBeInTheDocument();
  });

  it('indicates how many narrowing filters are active (AE3)', () => {
    setup({ platform: 'ps5', genre: 'rpg' });
    expect(screen.getByRole('button', { name: /filters \(2\)/i })).toBeInTheDocument();
  });

  it('opens the sheet from the control', async () => {
    const { user, view } = setup();
    const dialog = view.container.querySelector('dialog');

    expect(dialog?.hasAttribute('open')).toBe(false);
    await user.click(screen.getByRole('button', { name: /filters/i }));
    expect(dialog?.hasAttribute('open')).toBe(true);
  });

  it('re-renders on a filter change with no loading state (R12)', async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByRole('button', { name: /filters/i }));

    await user.selectOptions(screen.getByLabelText(/platform/i), 'ps5');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ platform: 'ps5' }));
  });

  it('drops a handheld restriction when the platform leaves PC', async () => {
    const onChange = vi.fn();
    render(
      <FiltersSheet
        filters={{ ...DEFAULT_FILTERS, platform: 'pc', handheldOnly: true }}
        onChange={onChange}
        tags={[]}
      />,
    );

    await userEvent.setup().selectOptions(screen.getByLabelText(/platform/i), 'ps5');
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'ps5', handheldOnly: false }),
    );
  });

  it('offers handheld filtering only within a PC selection', () => {
    const { unmount } = render(
      <FiltersSheet filters={DEFAULT_FILTERS} onChange={vi.fn()} tags={[]} />,
    );
    expect(screen.queryByLabelText(/handheld/i)).toBeNull();
    unmount();

    render(
      <FiltersSheet
        filters={{ ...DEFAULT_FILTERS, platform: 'pc' }}
        onChange={vi.fn()}
        tags={[]}
      />,
    );
    expect(screen.getByLabelText(/handheld/i)).toBeInTheDocument();
  });
});
