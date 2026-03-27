import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
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
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'release/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/test/**',
        'vitest.setup.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer/src'),
    },
  },
})
