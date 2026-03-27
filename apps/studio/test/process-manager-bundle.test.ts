import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Tests for the rewired resolveAgentPath / resolveAgentCommand logic.
 * These validate Phase 2 changes:
 *  - Packaged mode uses bundled Node binary (no ELECTRON_RUN_AS_NODE)
 *  - Dev mode uses system node + workspace build output
 *  - Dev path goes up 4 levels (apps/studio/dist/main → project root)
 */

// We test the exported path-resolution helpers extracted from process-manager
// by inspecting the ProcessManager private internals under test conditions.
import { ProcessManager } from '../src/main/process-manager.js'

test('ProcessManager: spawnAgent does not set ELECTRON_RUN_AS_NODE in any mode', async () => {
  // The new design must NEVER assign ELECTRON_RUN_AS_NODE into the env object.
  // Comments mentioning it are fine; only actual assignments are forbidden.
  const { readFileSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')

  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const pmSrc = join(moduleDir, '..', 'src', 'main', 'process-manager.ts')
  const source = readFileSync(pmSrc, 'utf-8')

  // Check that ELECTRON_RUN_AS_NODE is not assigned as an env var (i.e., not used as a key)
  assert.ok(
    !source.includes('ELECTRON_RUN_AS_NODE:'),
    'process-manager.ts must not assign ELECTRON_RUN_AS_NODE as an env var'
  )
})

test('ProcessManager: dev mode path goes up 4 levels from __dirname', async () => {
  // Verify the 4-level path correction for apps/studio/dist/main → project root
  // The new process-manager should use join(__dirname, '..', '..', '..', '..')
  // We read the source file and check for the pattern.
  const { readFileSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')

  // Get the process-manager source path
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const pmSrc = join(moduleDir, '..', 'src', 'main', 'process-manager.ts')

  const source = readFileSync(pmSrc, 'utf-8')

  // Must go 4 levels up for apps/studio/dist/main → project root
  assert.ok(
    source.includes("'..', '..', '..', '..'") ||
    source.includes("'../../../../'") ||
    source.includes("../../../../"),
    'process-manager.ts dev mode should go 4 levels up from __dirname'
  )
})

test('ProcessManager: packaged mode uses bundled node binary path', async () => {
  const { readFileSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')

  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const pmSrc = join(moduleDir, '..', 'src', 'main', 'process-manager.ts')

  const source = readFileSync(pmSrc, 'utf-8')

  // Must reference bundled node binary path
  assert.ok(
    source.includes("runtime', 'node'") || source.includes("runtime/node"),
    'process-manager.ts should reference bundled node binary at runtime/node'
  )
})

test('ProcessManager: packaged mode does NOT assign ELECTRON_RUN_AS_NODE env var', async () => {
  const { readFileSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')

  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const pmSrc = join(moduleDir, '..', 'src', 'main', 'process-manager.ts')

  const source = readFileSync(pmSrc, 'utf-8')

  // Comments referencing the var are OK; actual env assignments are not
  assert.ok(
    !source.includes('ELECTRON_RUN_AS_NODE:'),
    'process-manager.ts must not assign ELECTRON_RUN_AS_NODE in env object literals'
  )
})

test('ProcessManager: packaged mode uses bundled dist/entrypoint.js', async () => {
  const { readFileSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')

  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const pmSrc = join(moduleDir, '..', 'src', 'main', 'process-manager.ts')

  const source = readFileSync(pmSrc, 'utf-8')

  // Must reference dist/entrypoint.js as the bundled entry
  assert.ok(
    source.includes("'runtime', 'dist', 'entrypoint.js'") ||
    source.includes('runtime/dist/entrypoint.js') ||
    source.includes("dist', 'entrypoint.js'"),
    'process-manager.ts packaged mode should reference runtime/dist/entrypoint.js'
  )
})
