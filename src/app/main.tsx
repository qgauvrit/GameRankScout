import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { Theme } from '@astryxdesign/core/theme';
import { App } from './App.js';
// The theme is consumed pre-built (`__built: true`), not as the runtime
// `defineTheme` object from ./theme.ts. A built theme ships its tokens and
// component overrides as a static CSS file imported here, so `<Theme>` skips
// its runtime `<style>` injection — the injection the deploy CSP (style-src
// 'self', see public/_headers) blocks. ./theme.ts stays the human-authored
// source; `npm run build:theme` regenerates this pair from it.
import { grsTheme } from './theme.generated/grs.js';
import './theme.generated/grs.css';
import './fonts.js';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// The corpus is cached by the app itself (see corpus.ts); this registration
// covers the shell, so a cold offline open still has something to run.
registerSW({ immediate: true });

createRoot(root).render(
  <StrictMode>
    {/* Forced dark, regardless of OS preference (R2). The root Theme syncs
        data-theme onto <html> so browser chrome follows the app. */}
    <Theme theme={grsTheme} mode="dark">
      <App />
    </Theme>
  </StrictMode>,
);
