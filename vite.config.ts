import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { astryxStylex } from '@astryxdesign/build/vite';

// Astryx compiles through StyleX at build time. This runs for both `vite build`
// and the vitest suite (they share this config), so component styles are
// transformed the same way in production and in tests (R4).
//
// Astryx's own `astryx-css-layer-order` plugin declares the StyleX cascade-layer
// order by injecting an inline <style> into index.html — which the deploy CSP
// (style-src 'self', see public/_headers) blocks, leaving components mis-layered.
// It is dropped here and replaced by `astryxLayerOrderLink` below, which points
// at public/astryx-layers.css instead: same declaration, same guaranteed-first
// position, but an external stylesheet served from this origin — no inline style.
const astryxPlugins = astryxStylex().filter(
  (plugin) => !plugin || (plugin as Plugin).name !== 'astryx-css-layer-order',
);

// Head-prepends <link rel="stylesheet" href="/astryx-layers.css"> so the layer
// order is the first thing the document parses, before any @layer block in the
// bundled CSS. Mirrors the replaced plugin's `transformIndexHtml`.
const astryxLayerOrderLink: Plugin = {
  name: 'astryx-css-layer-order-link',
  transformIndexHtml() {
    return [
      {
        tag: 'link',
        attrs: { rel: 'stylesheet', href: '/astryx-layers.css' },
        injectTo: 'head-prepend',
      },
    ];
  },
};

export default defineConfig({
  plugins: [
    react(),
    ...astryxPlugins,
    astryxLayerOrderLink,
    VitePWA({
      registerType: 'autoUpdate',
      // The manifest is authored by hand in public/ so it stays reviewable.
      manifest: false,
      includeAssets: ['icon.svg', 'icons/*.png', 'manifest.webmanifest'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
        // The corpus has its own cache with schema-version invalidation, so the
        // service worker must not also hold a copy it cannot reason about.
        navigateFallbackDenylist: [/^\/corpus\.json$/],
        runtimeCaching: [
          {
            urlPattern: /\/corpus\.json$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'grs-corpus',
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 14 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    globals: true,
    // The astryxStylex plugin's StyleX transform (a public-beta dependency)
    // leaves file handles open on the vite server, so after the suite passes
    // vitest waits out its close timeout before force-exiting cleanly (exit 0).
    // Capping the wait keeps that beta leak from adding ~10s to every run; it
    // only bounds post-success server teardown, never a test's own execution.
    teardownTimeout: 2000,
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'worker/**/*.test.ts',
      // The deploy-time guards live here — the smoke check and the publish
      // recorder. They are scripts because they need a live deployment or a
      // real file, but their decisions are ordinary logic, and a guard nothing
      // exercises is a guard that reports whatever it was last written to say.
      'scripts/**/*.test.ts',
      // The fixtures themselves are checked for anything that should not be in
      // a public repository, so this pattern has to reach outside src/.
      'test/**/*.test.ts',
    ],
    setupFiles: ['test/setup.ts'],
    environmentOptions: {
      // Without a real origin jsdom refuses to expose localStorage, and the
      // offline corpus cache is exactly what the component tests need to
      // exercise. A served app always has an origin, so this matches reality.
      jsdom: { url: 'http://localhost:5173/' },
    },
  },
});
