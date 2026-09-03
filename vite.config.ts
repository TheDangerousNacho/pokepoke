import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves a project site from /<repo>/, so assets need that prefix.
// Overridable via BASE_PATH for a different host or a local `vite preview`.
const base = process.env.BASE_PATH ?? '/pokepoke/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // The whole point is a tool that opens at a raid gym on one bar of
      // signal, so the app shell must come from cache without asking the
      // network first.
      registerType: 'autoUpdate',
      manifest: false, // public/manifest.webmanifest is hand-written; keep it.
      workbox: {
        // The Tesseract runtime is ~23MB and only matters if you open Scan.
        // Precaching it would make the first visit download all of it, so it
        // is cached on use instead (see runtimeCaching below).
        globIgnores: ['**/tesseract/**'],
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        // The game master bundle rides inside the JS chunk, which is why the
        // precache is still only a few hundred KB.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/tesseract/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'tesseract-runtime',
              // Content-addressed by version; a year is fine and means the
              // second scan of the day costs nothing.
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // Off in dev: a service worker caching a dev server is a debugging trap.
        enabled: false,
      },
    }),
  ],
})
