/**
 * Tests for named process management in ProcessManager.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

// ---------------------------------------------------------------------------
// ProcessManager
// ---------------------------------------------------------------------------

test('ProcessManager.spawnNamedProcess registers a named process and returns ChildProcess', async () => {
  const { ProcessManager } = await import('../src/main/process-manager.ts')
  const pm = new ProcessManager()

  const proc = pm.spawnNamedProcess('echo-test', 'echo', ['hello'], {})
  assert.ok(proc, 'should return a ChildProcess')
  assert.ok(pm.getNamedProcess('echo-test'), 'getNamedProcess returns the process')

  // Clean up
  await pm.killNamed('echo-test')
})

test('ProcessManager.killNamed removes process from named map', async () => {
  const { ProcessManager } = await import('../src/main/process-manager.ts')
  const pm = new ProcessManager()

  pm.spawnNamedProcess('kill-test', 'sleep', ['60'], {})
  assert.ok(pm.getNamedProcess('kill-test'), 'process exists before kill')

  await pm.killNamed('kill-test')
  assert.equal(pm.getNamedProcess('kill-test'), null, 'process gone after kill')
})

test('ProcessManager.getNamedProcess returns null for unknown name', async () => {
  const { ProcessManager } = await import('../src/main/process-manager.ts')
  const pm = new ProcessManager()
  assert.equal(pm.getNamedProcess('nonexistent'), null)
})
