// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExternalLink } from './ExternalLink.js';

/**
 * The single external-link affordance (R4, U4). The new-tab *attributes* are
 * asserted here; that a click actually opens a tab is confirmed in the browser
 * walkthrough (jsdom performs no navigation).
 */
describe('ExternalLink', () => {
  it('opens in a new tab with a safe rel', () => {
    render(<ExternalLink href="https://store.steampowered.com/app/1/">Steam</ExternalLink>);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('appends the new-tab hint without replacing the visible label', () => {
    render(<ExternalLink href="https://example.test/">Steam</ExternalLink>);
    const link = screen.getByRole('link');
    // The visible text survives in the accessible name; the hint supplements it.
    expect(link).toHaveAccessibleName('Steam (opens in a new tab)');
    expect(screen.getByText('Steam')).toBeInTheDocument();
    expect(screen.getByText('(opens in a new tab)')).toBeInTheDocument();
  });

  it('renders the external-link glyph decoratively (not in the accessible name)', () => {
    render(<ExternalLink href="https://example.test/">Steam</ExternalLink>);
    // The affordance icon must not leak into the name — proven by the exact name
    // above containing only the label plus the hint. Here we confirm a decorative
    // (aria-hidden) element is present as the affordance.
    const link = screen.getByRole('link');
    expect(link.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
