// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Theme, isDefinedTheme, resolveThemeToken } from '@astryxdesign/core/theme';
import { grsTheme, ACCENT_ORANGE } from './theme.js';

/**
 * The theme foundation (R2, R3). Uses .tsx rather than the planned .ts because
 * the forced-dark check renders the provider.
 */
describe('GRS theme', () => {
  it('is a defined theme built on Stone', () => {
    expect(isDefinedTheme(grsTheme)).toBe(true);
    expect(grsTheme.name).toBe('grs');
  });

  it('pins the accent to orange (R3)', () => {
    expect(resolveThemeToken(grsTheme, '--color-accent', { mode: 'dark' }).toLowerCase()).toBe(
      ACCENT_ORANGE,
    );
  });

  it('forces dark mode on the document regardless of OS preference (R2)', () => {
    render(
      <Theme theme={grsTheme} mode="dark">
        <span>content</span>
      </Theme>,
    );
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
