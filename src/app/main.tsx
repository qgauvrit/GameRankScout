import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// The corpus is cached by the app itself (see corpus.ts); this registration
// covers the shell, so a cold offline open still has something to run.
registerSW({ immediate: true });

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
