/**
 * vite.pwa.config.ts — standalone Vite config for building the PWA target.
 *
 * Output: dist/pwa/
 *
 * Usage:
 *   npm run build:pwa   → production build
 *   npm run serve:pwa   → serve the PWA build locally (for testing)
 */

import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },

  plugins: [tailwindcss(), react()],

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
