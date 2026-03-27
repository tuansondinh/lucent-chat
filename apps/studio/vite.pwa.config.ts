/**
 * vite.pwa.config.ts — standalone Vite config for building the PWA target.
 *
 * Output: dist/pwa/
 *
 * Usage:
 *   npm run build:pwa   → production build
 *   npm run serve:pwa   → serve the PWA build locally (for testing)
 *
 * Service worker strategy:
 *   - Precache: HTML, CSS, JS, fonts, icons (app shell assets)
 *   - Runtime: cache-first for static assets (images, fonts)
 *   - API calls (/api/*, /events) and WebSocket state are NEVER cached
 *   - Offline fallback: /offline.html for navigation requests
 */

import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },

  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      // Use 'generateSW' mode so Workbox handles precaching automatically
      strategies: 'generateSW',

      // Output the SW to the build output dir
      registerType: 'autoUpdate',

      // We register the SW manually in main.tsx (conditional on !__ELECTRON__)
      injectRegister: null,

      // Workbox configuration
      workbox: {
        // Glob patterns for assets to precache (static app shell only)
        globPatterns: [
          '**/*.{html,css,js,mjs,woff,woff2,ttf,eot,svg,ico,png,webp,json,webmanifest}',
        ],

        // Do NOT cache API endpoints or WebSocket-backed state
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          // Bridge server API routes
          /^\/api\//,
          /^\/events$/,
        ],

        // Runtime caching: fonts and icons get cache-first treatment
        runtimeCaching: [
          {
            // Cache fonts at runtime with cache-first strategy
            urlPattern: /\.(?:woff2?|ttf|eot)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'lucent-fonts-v1',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
          {
            // Cache SVG icons at runtime
            urlPattern: /\/icons\/.+\.svg$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'lucent-icons-v1',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
        ],

        // Skip waiting so new SW activates on next navigation
        skipWaiting: true,
        clientsClaim: true,
      },

      // Manifest is served as a static file from public/
      // vite-plugin-pwa will inject the link tag automatically;
      // we also add it manually in index.html for Electron compatibility.
      manifest: false,

      // Dev service worker support (for local testing)
      devOptions: {
        enabled: false,
      },
    }),
  ],

  define: {
    // Ensure the renderer knows it is running as a PWA (not Electron)
    'window.__ELECTRON__': 'undefined',
  },

  build: {
    outDir: resolve(__dirname, 'dist/pwa'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },

  preview: {
    port: 4173,
    host: true,
  },
})
