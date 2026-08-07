import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { Theme } from '@astryxdesign/core/theme';
import { App } from './App.js';
import { grsTheme } from './theme.js';
import './styles.css';

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
