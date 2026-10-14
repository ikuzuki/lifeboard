import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The waiting worker is surfaced to the UI rather than activated behind the
      // user's back, so registration is hand-rolled in src/lib/pwa.ts.
      registerType: 'prompt',
      injectRegister: null,

      // public/manifest.webmanifest is the single source of truth and is already
      // linked from index.html, so the plugin does not generate or inject one.
      manifest: false,

      workbox: {
        // Notification clicks are handled in the worker, because a worker-shown notification
        // has no default click behaviour at all.
        importScripts: ['/sw-notifications.js'],

        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // Store listing images and the unused stray favicon are not app shell. The imported
        // worker script is excluded too: it is worker code, fetched with the worker, and
        // precaching it would serve a stale copy after a deploy.
        globIgnores: ['**/screenshots/**', '**/favicon.svg', '**/sw-notifications.js'],

        // Every navigation is served the precached shell, so a cold start works
        // with no connection at all. Freshness is the update flow's job, not the
        // navigation handler's.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          // Anything with a file extension is an asset request, not a route.
          /\/[^/?]+\.[^/]+$/,
        ],

        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // Left false deliberately: skipWaiting is triggered from the UI instead.
        skipWaiting: false,
      },

      // No service worker in `npm run dev`; a stale worker during development is
      // more confusing than useful.
      devOptions: { enabled: false },
    }),
  ],
});
