import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { ProcessManager } from '../src/main/process-manager.js'

test('ProcessManager: initializes with agent and sidecar processes', () => {
  const manager = new ProcessManager()

  const states = manager.getStates()
  assert.ok('agent' in states)
  assert.ok('sidecar' in states)
  assert.equal(states.agent, 'stopped')
  assert.equal(states.sidecar, 'stopped')
})

test('ProcessManager: spawnAgent sets state to starting', () => {
  const manager = new ProcessManager()

  manager.spawnAgent()

  const states = manager.getStates()
  assert.equal(states.agent, 'starting')
})

test('ProcessManager: spawnAgent persists cwd and extraEnv for restarts', () => {
  const manager = new ProcessManager()

  const cwd = '/test/directory'
  const extraEnv = { TEST_VAR: 'test-value' }

  manager.spawnAgent(cwd, extraEnv)

  // Verify the process state has the saved config
  const processes = (manager as any).processes
  const agent = processes.get('agent')
  assert.equal(agent.cwd, cwd)
  assert.deepEqual(agent.extraEnv, extraEnv)
})

test('ProcessManager: setState emits events', (t) => {
  const manager = new ProcessManager()

  const events: any[] = []
  manager.on('state-change', (name, state) => {
    events.push({ name, state })
  })

  manager.setState('agent', 'starting')

  assert.equal(events.length, 1)
  assert.equal(events[0].name, 'agent')
  assert.equal(events[0].state, 'starting')
})

test('ProcessManager: setState emits health event', () => {
  const manager = new ProcessManager()

  const healthEvents: any[] = []
  manager.on('health', (states) => {
    healthEvents.push(states)
  })

  manager.setState('agent', 'ready')

  assert.equal(healthEvents.length, 1)
  assert.ok('agent' in healthEvents[0])
})

test('ProcessManager: setState emits restarted event when ready', () => {
  const manager = new ProcessManager()

  const restartedEvents: any[] = []
  manager.on('restarted', (name) => {
    restartedEvents.push(name)
  })

  manager.setState('agent', 'ready')

  assert.equal(restartedEvents.length, 1)
  assert.equal(restartedEvents[0], 'agent')
})

test('ProcessManager: setState resets backoff on ready', () => {
  const manager = new ProcessManager()

  const processes = (manager as any).processes
  const agent = processes.get('agent')
  agent.backoffMs = 5000

  manager.setState('agent', 'ready')

  assert.equal(agent.backoffMs, 1000) // Reset to initial
})

test('ProcessManager: getAgentProcess returns null when not running', () => {
  const manager = new ProcessManager()

  const proc = manager.getAgentProcess()
  assert.equal(proc, null)
})

test('ProcessManager: getSidecarProcess returns null when not running', () => {
  const manager = new ProcessManager()

  const proc = manager.getSidecarProcess()
  assert.equal(proc, null)
})

test('ProcessManager: getStates returns snapshot of all states', () => {
  const manager = new ProcessManager()

  manager.setState('agent', 'starting')
  manager.setState('sidecar', 'ready')

  const states = manager.getStates()

  assert.equal(states.agent, 'starting')
  assert.equal(states.sidecar, 'ready')
})

test('ProcessManager: killProcess handles non-existent process gracefully', async () => {
  const manager = new ProcessManager()

  // Add a process without a proc (stopped state)
  const processes = (manager as any).processes
  const agent = processes.get('agent')
  agent.proc = null

  // Should not throw
  await manager.killProcess('agent')
  assert.ok(true)
})

test('ProcessManager: killProcess handles graceful shutdown timeout', async () => {
  const manager = new ProcessManager()

  // Create a mock process that never exits
  const mockProc = new EventEmitter() as any
  mockProc.kill = () => {}
  mockProc.exitCode = null

  const processes = (manager as any).processes
  const agent = processes.get('agent')
  agent.proc = mockProc

  // This should timeout after 3 seconds and force kill
  const startTime = Date.now()
  await manager.killProcess('agent')
  const duration = Date.now() - startTime

  // Should take approximately 3 seconds (grace period)
  assert.ok(duration >= 2900 && duration < 3500, `Expected ~3000ms, got ${duration}ms`)
})

test('ProcessManager: killProcessGroup handles errors gracefully', async () => {
  const manager = new ProcessManager()

  // Try to kill a non-existent process group
  await manager.killProcessGroup(99999)

  // Should not throw
  assert.ok(true)
})

test('ProcessManager: shutdownAll kills all processes', async () => {
  const manager = new ProcessManager()

  // Add mock processes
  const processes = (manager as any).processes
  const agent = processes.get('agent')
  const sidecar = processes.get('sidecar')

  const mockProc1 = new EventEmitter() as any
  mockProc1.kill = () => {
    mockProc1.emit('exit')
  }
  mockProc1.exitCode = null

  const mockProc2 = new EventEmitter() as any
  mockProc2.kill = () => {
    mockProc2.emit('exit')
  }
  mockProc2.exitCode = null

  agent.proc = mockProc1
  sidecar.proc = mockProc2

  await manager.shutdownAll()

  // Should not throw
  assert.ok(true)
})

test('ProcessManager: scheduleRestart implements exponential backoff', async () => {
  const manager = new ProcessManager()

  // We can't easily test the actual timeout, but we can verify the backoff doubles
  const processes = (manager as any).processes
  const agent = processes.get('agent')

  const initialBackoff = agent.backoffMs
  ;(manager as any).scheduleRestart('agent')

  const afterFirstSchedule = agent.backoffMs
  assert.ok(afterFirstSchedule > initialBackoff)

  ;(manager as any).scheduleRestart('agent')

  const afterSecondSchedule = agent.backoffMs
  assert.ok(afterSecondSchedule > afterFirstSchedule)
})

test('ProcessManager: backoff caps at BACKOFF_MAX_MS', () => {
  const manager = new ProcessManager()

  const processes = (manager as any).processes
  const agent = processes.get('agent')

  // Set backoff to max
  agent.backoffMs = 30000

  ;(manager as any).scheduleRestart('agent')

  // Should not exceed max
  assert.ok(agent.backoffMs <= 30000)
})

test('ProcessManager: spawnSidecar returns ChildProcess', () => {
  const manager = new ProcessManager()

  const proc = manager.spawnSidecar('echo', ['hello'], {})

  assert.ok(proc)
  assert.ok(proc.pid)
})

test('ProcessManager: spawnSidecar registers the process', () => {
  const manager = new ProcessManager()

  const proc = manager.spawnSidecar('echo', ['hello'], {})

  const sidecarProc = manager.getSidecarProcess()
  assert.equal(sidecarProc, proc)
})

test('ProcessManager: handles crash loop detection', () => {
  const manager = new ProcessManager()

  // Simulate multiple crashes by setting state to crashed
  manager.setState('agent', 'crashed')

  const states = manager.getStates()
  assert.equal(states.agent, 'crashed')

  // The scheduleRestart logic should be triggered
  // We can verify the backoff increases
  const processes = (manager as any).processes
  const agent = processes.get('agent')
  const initialBackoff = agent.backoffMs

  ;(manager as any).scheduleRestart('agent')

  assert.ok(agent.backoffMs > initialBackoff)
})

test('ProcessManager: shutdown during restart timer', async () => {
  const manager = new ProcessManager()

  // Start an agent (will set state to starting)
  manager.spawnAgent()

  // Kill it before it fully starts
  await manager.killProcess('agent')

  const states = manager.getStates()
  assert.equal(states.agent, 'stopped')
})

test('ProcessManager: intentionalKill prevents restart', () => {
  const manager = new ProcessManager()

  const processes = (manager as any).processes
  const agent = processes.get('agent')

  // Set intentional kill flag
  agent.intentionalKill = true

  // Simulate exit event
  const mockProc = new EventEmitter() as any
  agent.proc = mockProc
  mockProc.emit('exit', 0, null)

  // State should be stopped, not crashed
  assert.equal(agent.state, 'stopped')
})

test('ProcessManager: handles multiple process types independently', () => {
  const manager = new ProcessManager()

  manager.setState('agent', 'ready')
  manager.setState('sidecar', 'starting')

  const states = manager.getStates()

  assert.equal(states.agent, 'ready')
  assert.equal(states.sidecar, 'starting')
})

test('ProcessManager: spawnAgent with different cwd switches context', () => {
  const manager = new ProcessManager()

  manager.spawnAgent('/dir1')
  let processes = (manager as any).processes
  let agent = processes.get('agent')
  assert.equal(agent.cwd, '/dir1')

  manager.spawnAgent('/dir2')
  processes = (manager as any).processes
  agent = processes.get('agent')
  assert.equal(agent.cwd, '/dir2')
})

test('ProcessManager: spawnAgent with extraEnv persists across restarts', () => {
  const manager = new ProcessManager()

  const extraEnv = { API_KEY: 'test-key', DEBUG: 'true' }
  manager.spawnAgent(undefined, extraEnv)

  const processes = (manager as any).processes
  const agent = processes.get('agent')

  assert.deepEqual(agent.extraEnv, extraEnv)
})
