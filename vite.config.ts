import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // The manifest is authored by hand in public/ so it stays reviewable.
      manifest: false,
      includeAssets: ['icon.svg', 'icons/*.png', 'manifest.webmanifest'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
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
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'worker/**/*.test.ts'],
  },
});
