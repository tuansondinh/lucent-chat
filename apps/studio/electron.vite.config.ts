import { resolve } from 'node:path'
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Vite plugin that copies static assets required by the main-process bundle. */
function copyMainAssets() {
  return {
    name: 'copy-main-assets',
    closeBundle() {
      const outDir = resolve(__dirname, 'dist/main')
      mkdirSync(outDir, { recursive: true })
      // Copy all static assets from the LSP module (defaults.json, lsp.md, etc.)
      // These are require()'d or readFileSync()'d at runtime relative to the bundle.
      const lspSrc = resolve(__dirname, '../../packages/pi-coding-agent/src/core/lsp')
      for (const file of readdirSync(lspSrc)) {
        if (file.endsWith('.json') || file.endsWith('.md')) {
          copyFileSync(resolve(lspSrc, file), resolve(outDir, file))
        }
      }
    },
  }
}

export default defineConfig({
  main: {
    plugins: [copyMainAssets()],
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      lib: {
        entry: resolve(__dirname, 'src/preload/index.ts'),
        formats: ['cjs'],
        fileName: () => 'index.js',
      },
      rollupOptions: {
        external: ['electron'],
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [tailwindcss(), react()],
    build: {
      outDir: resolve(__dirname, 'dist/renderer')
    }
  }
})
