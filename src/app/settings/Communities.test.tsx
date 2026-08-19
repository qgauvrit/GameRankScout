// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Communities } from './Communities.js';
import { DEFAULT_READER_STATE } from '../state/local.js';
import type { ReaderState } from '../state/local.js';
import type { CommunityRef } from '../../communities/catalogue.js';

function state(overrides: Partial<ReaderState> = {}): ReaderState {
  return { ...DEFAULT_READER_STATE, ...overrides };
}

function renderCommunities(
  overrides: Partial<ReaderState> = {},
  props: Partial<Parameters<typeof Communities>[0]> = {},
) {
  const onChange = vi.fn();
  const onPull = vi.fn();
  render(
    <Communities
      state={state(overrides)}
      onChange={onChange}
      covered={() => true}
      adhoc={{}}
      onPull={onPull}
      {...props}
    />,
  );
  return { onChange, onPull };
}

const added: CommunityRef = {
  id: 'r/mine',
  source: 'reddit',
  label: 'mine',
  covers: [],
  tier: 'recommended',
};

describe('Communities progressive disclosure (U4)', () => {
  it('collapses the recommended catalogue on a fresh reader state and reveals it on demand', async () => {
    const user = userEvent.setup();
    renderCommunities();

    // The catalogue is behind a closed disclosure (its display:none content is a
    // CSS concern the jsdom render cannot compute, so aria-expanded is the
    // contract to assert here; the visual collapse is browser-verified).
    const trigger = screen.getByRole('button', { name: /recommended communities \(0 selected\)/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('checkbox', { name: 'r/roguelites' })).toBeInTheDocument();
  });

  it('starts expanded and states the count when recommendations are already enabled', () => {
    renderCommunities({ enabledRecommended: ['r/roguelites', 'r/JRPG'] });

    expect(
      screen.getByRole('button', { name: /recommended communities \(2 selected\)/i }),
    ).toHaveAttribute('aria-expanded', 'true');
    // Already-enabled choices stay visible without any interaction.
    expect(screen.getByRole('checkbox', { name: 'r/roguelites' })).toBeInTheDocument();
  });

  it('emits the same reader-state update when a recommended community is toggled', async () => {
    const user = userEvent.setup();
    // One already enabled, so the section starts open and the next is clickable.
    const { onChange } = renderCommunities({ enabledRecommended: ['r/roguelites'] });

    await user.click(screen.getByRole('checkbox', { name: 'r/cozygames' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        enabledRecommended: expect.arrayContaining(['r/roguelites', 'r/cozygames']),
      }),
    );
  });

  it('keeps the reader’s own communities and the Add action outside the collapsed region', () => {
    renderCommunities({ addedCommunities: [added] });

    // The recommended catalogue is collapsed (no recommendations enabled)...
    expect(
      screen.getByRole('button', { name: /recommended communities \(0 selected\)/i }),
    ).toHaveAttribute('aria-expanded', 'false');
    // ...but "Yours" and the add form stay in view regardless.
    expect(screen.getByRole('heading', { name: /yours/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'r/mine' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('keeps the on-by-default communities expanded and labelled', () => {
    renderCommunities();

    expect(screen.getByRole('heading', { name: /on by default/i })).toBeInTheDocument();
    // A curated community is visible with no disclosure to open.
    expect(screen.getByRole('checkbox', { name: 'r/Games' })).toBeInTheDocument();
  });
});
