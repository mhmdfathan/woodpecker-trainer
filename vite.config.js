import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves a project site from /<repo>/, so every asset URL needs
// that prefix. Change this if the repository is renamed.
const BASE = '/woodpecker/';

export default defineConfig({
  base: BASE,
  // pool.json is ~2 MB. Emitting it as JSON.parse('...') rather than a JS object
  // literal makes the browser parse it with the JSON parser, which is markedly
  // faster on a phone. Only default imports work under this setting, which is
  // all src/pool.js uses.
  json: { stringify: true },
  server: {
    // Expose on the LAN so the board can be checked on a phone during development.
    host: true,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'favicon-32.png'],
      manifest: {
        name: 'Woodpecker',
        short_name: 'Woodpecker',
        description: 'Chess puzzle cycle trainer',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f4f3f1',
        theme_color: '#f4f3f1',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        // The puzzle pool pushes the main bundle past workbox's 2 MiB default,
        // and a bundle that is not precached is an app that will not open on a
        // train with no signal.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: `${BASE}index.html`,
      },
    }),
  ],
});
