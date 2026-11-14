import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// VITE_BASE=/repo-name/ for GitHub Pages project sites; defaults to '/' (root hosting, local preview).
// Inside GitHub Actions the repository name is always known, so a project site works even if VITE_BASE was not passed.
const REPO = process.env.GITHUB_ACTIONS ? process.env.GITHUB_REPOSITORY?.split('/')[1] : undefined;
const BASE = (process.env.VITE_BASE ?? (REPO ? `/${REPO}/` : '/')).replace(/\/*$/, '/');

export default defineConfig({
  base: BASE,
  define: { __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'WayFarer R.E.S.C.U.E.',
        short_name: 'WayFarer',
        description: 'Offline evacuation analysis: scan, draw, or map a scenario and run 200 Monte Carlo trials.',
        theme_color: '#0B1220',
        background_color: '#0B1220',
        display: 'standalone',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Offline is non-negotiable: precache app shell, fonts and every bundled data asset.
        globPatterns: ['**/*.{js,css,html,woff,woff2,png,svg,json,geojson,pmtiles}'],
        maximumFileSizeToCacheInBytes: 64 * 1024 * 1024,
        navigateFallback: BASE + 'index.html',
        // the on-device language model runtime (~6 MB) is optional: never precache it; its weights come from a CDN on request
        globIgnores: ['**/node_modules/**', '**/webllm-*.js'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith(BASE + 'data/'),
            handler: 'CacheFirst',
            options: { cacheName: 'wayfarer-data', expiration: { maxEntries: 40 } },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 7000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@mlc-ai/web-llm')) return 'webllm';
          if (id.includes('maplibre-gl')) return 'maplibre';
          return undefined;
        },
      },
    },
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
