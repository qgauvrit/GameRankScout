// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@astryxdesign/core';

/**
 * Proves the Astryx/StyleX build integration works under vitest (R4, U1).
 *
 * The suite and the production build share vite.config.ts, so a rendered Astryx
 * primitive here means the StyleX transform ran at test time — the risk U1
 * exists to retire before any real UI is migrated onto the design system. It
 * asserts by role, not by style, because jsdom does not apply the emitted CSS;
 * the build-level proof (StyleX CSS is emitted) lives in the Verification
 * Contract's `vite build` check.
 */
describe('Astryx build integration', () => {
  it('renders an Astryx primitive as a real control', () => {
    render(<Button label="Play" />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });
});
