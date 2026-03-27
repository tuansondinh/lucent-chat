/**
 * Phase 1: Subagent System (Infra + UI) — tests
 *
 * Covers:
 * - ProcessManager: spawnNamedProcess, killNamed, getNamedProcess
 * - AgentDefinitionLoader: parse frontmatter + extract body
 * - SubagentManager: max-4 enforcement, crash handling, shutdownAll
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

// ---------------------------------------------------------------------------
// AgentDefinitionLoader
// ---------------------------------------------------------------------------

test('AgentDefinitionLoader.load returns name, description, and systemPrompt', async () => {
  const { AgentDefinitionLoader } = await import('../src/main/agent-definition-loader.ts')
  const loader = new AgentDefinitionLoader()

  const worker = await loader.load('worker')
  assert.equal(worker.name, 'worker')
  assert.ok(worker.description.length > 0, 'description is non-empty')
  assert.ok(worker.systemPrompt.length > 0, 'systemPrompt is non-empty')
  // Body should not contain frontmatter markers
  assert.ok(!worker.systemPrompt.includes('---'), 'systemPrompt has no frontmatter')
})

test('AgentDefinitionLoader.load works for scout and researcher', async () => {
  const { AgentDefinitionLoader } = await import('../src/main/agent-definition-loader.ts')
  const loader = new AgentDefinitionLoader()

  const scout = await loader.load('scout')
  assert.equal(scout.name, 'scout')
  assert.ok(scout.systemPrompt.length > 0)

  const researcher = await loader.load('researcher')
  assert.equal(researcher.name, 'researcher')
  assert.ok(researcher.systemPrompt.length > 0)
})

test('AgentDefinitionLoader.load throws for unknown agent type', async () => {
  const { AgentDefinitionLoader } = await import('../src/main/agent-definition-loader.ts')
  const loader = new AgentDefinitionLoader()

  await assert.rejects(
    () => loader.load('nonexistent'),
    /not found|ENOENT/i,
  )
})

test('AgentDefinitionLoader.listAll returns array of agent types', async () => {
  const { AgentDefinitionLoader } = await import('../src/main/agent-definition-loader.ts')
  const loader = new AgentDefinitionLoader()

  const types = await loader.listAll()
  assert.ok(Array.isArray(types), 'returns an array')
  assert.ok(types.includes('worker'), 'includes worker')
  assert.ok(types.includes('scout'), 'includes scout')
  assert.ok(types.includes('researcher'), 'includes researcher')
})

// ---------------------------------------------------------------------------
// SubagentManager (uses options-based constructor — no transitive TS imports)
// ---------------------------------------------------------------------------

test('SubagentManager enforces max 4 concurrent subagents', async () => {
  const { SubagentManager } = await import('../src/main/subagent-manager.ts')

  const mgr = new SubagentManager()

  // Spawn 4 subagents (sleep processes to keep them alive)
  const ids = []
  for (let i = 0; i < 4; i++) {
    const id = await mgr.spawn('parent-turn-1', 'worker', 'task ' + i)
    ids.push(id)
  }
  assert.equal(ids.length, 4)

  // 5th should be rejected
  await assert.rejects(
    () => mgr.spawn('parent-turn-1', 'worker', 'task 5'),
    /max.*subagent|limit/i,
  )

  // Clean up
  await mgr.shutdownAll()
})

test('SubagentManager.shutdownAll terminates all children', async () => {
  const { SubagentManager } = await import('../src/main/subagent-manager.ts')

  const mgr = new SubagentManager()

  await mgr.spawn('parent-turn-2', 'worker', 'task a')
  assert.equal(mgr.activeCount, 1)

  await mgr.shutdownAll()
  assert.equal(mgr.activeCount, 0)

  // After shutdown, spawning again should work (count resets to 0)
  const id = await mgr.spawn('parent-turn-3', 'worker', 'task b')
  assert.ok(typeof id === 'string' && id.length > 0)
  await mgr.shutdownAll()
})

test('SubagentManager.abort cleans up a single subagent by id', async () => {
  const { SubagentManager } = await import('../src/main/subagent-manager.ts')

  const mgr = new SubagentManager()

  const id = await mgr.spawn('parent-turn-4', 'worker', 'task x')
  const listBefore = mgr.list()
  assert.ok(listBefore.some((s) => s.id === id), 'subagent in list before abort')

  await mgr.abort(id)
  const listAfter = mgr.list()
  assert.ok(!listAfter.some((s) => s.id === id), 'subagent removed after abort')
})

test('SubagentManager.abortByParentTurn cleans up orphans on parent abort', async () => {
  const { SubagentManager } = await import('../src/main/subagent-manager.ts')

  const mgr = new SubagentManager()

  const parentTurnId = 'parent-turn-5'
  await mgr.spawn(parentTurnId, 'worker', 'task y')
  await mgr.spawn(parentTurnId, 'worker', 'task z')

  assert.equal(mgr.list().filter((s) => s.parentTurnId === parentTurnId).length, 2)

  await mgr.abortByParentTurn(parentTurnId)
  assert.equal(mgr.list().filter((s) => s.parentTurnId === parentTurnId).length, 0)
})
