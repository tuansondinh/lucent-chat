import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./vitest.react-act-patch.ts', './vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/**/*.renderer.test.{ts,tsx}'],
    exclude: [
      'node_modules',
      'dist',
      'release',
      'test/**/*.test.mjs',
      'test/**/*.test.ts',
      'test/**/git-service.test.ts',
      'test/**/tokens.test.mjs',
      'test/**/smoke.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'release/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/test/**',
        'vitest.setup.ts',
        '**/*.stories.*',
        '**/index.ts',
        '**/index.*',
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
        './src/main/**/*.ts': {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
        './src/renderer/**/*.tsx': {
          branches: 70,
          functions: 70,
          lines: 70,
          statements: 70,
        },
        './src/main/ipc-handlers.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        './src/preload/index.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer/src'),
    },
  },
})
