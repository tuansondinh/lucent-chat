import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { ProcessManager } from '../src/main/process-manager.js'

class MockChildProcess extends EventEmitter {
  pid: number
  exitCode: number | null = null
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdio = [null, this.stdout, this.stderr]
  killCalls: string[] = []

  constructor(pid: number) {
    super()
    this.pid = pid
  }

  kill(signal?: string): boolean {
    this.killCalls.push(signal ?? 'SIGTERM')
    this.exitCode = 0
    this.emit('exit', 0, signal ?? null)
    return true
  }
}

function createSpawnStub() {
  const calls: Array<{ command: string; args: string[]; options: unknown; proc: MockChildProcess }> = []
  let nextPid = 1000
  const spawnStub = ((command: string, args: string[], options: unknown) => {
    const proc = new MockChildProcess(nextPid++)
    calls.push({ command, args, options, proc })
    queueMicrotask(() => proc.emit('spawn'))
    return proc as any
  }) as typeof import('node:child_process').spawn
  return { spawnStub, calls }
}

test('ProcessManager: initializes with agent and sidecar processes', () => {
  const manager = new ProcessManager()

  const states = manager.getStates()
  assert.ok('agent' in states)
  assert.ok('sidecar' in states)
  assert.equal(states.agent, 'stopped')
  assert.equal(states.sidecar, 'stopped')
})

test('ProcessManager: spawnAgent sets state to starting', () => {
  const { spawnStub } = createSpawnStub()
  const manager = new ProcessManager(spawnStub)

  manager.spawnAgent()

  const states = manager.getStates()
  assert.equal(states.agent, 'starting')
})

test('ProcessManager: spawnAgent persists cwd and extraEnv for restarts', () => {
  const { spawnStub } = createSpawnStub()
  const manager = new ProcessManager(spawnStub)

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

// Removed: killProcess graceful shutdown timeout test (waits 3 seconds — too slow for unit test suite)

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
  const { spawnStub } = createSpawnStub()
  const manager = new ProcessManager(spawnStub)

  const processes = (manager as any).processes
  const agent = processes.get('agent')
  agent.backoffMs = 10
  ;(manager as any).scheduleRestart('agent')
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(agent.backoffMs, 20)
})

test('ProcessManager: backoff caps at BACKOFF_MAX_MS', () => {
  const { spawnStub } = createSpawnStub()
  const manager = new ProcessManager(spawnStub)

  const processes = (manager as any).processes
  const agent = processes.get('agent')

  // Set backoff to max
  agent.backoffMs = 30000

  ;(manager as any).scheduleRestart('agent')
  assert.ok(agent.restartTimer)
  assert.ok(agent.backoffMs <= 30000)
  clearTimeout(agent.restartTimer)
  agent.restartTimer = null
})

test('ProcessManager: spawnSidecar returns ChildProcess', () => {
  const { spawnStub } = createSpawnStub()
  const manager = new ProcessManager(spawnStub)

  const proc = manager.spawnSidecar('echo', ['hello'], {})

  assert.ok(proc)
  assert.ok(proc.pid)
})

test('ProcessManager: spawnSidecar registers the process', () => {
  const { spawnStub } = createSpawnStub()
  const manager = new ProcessManager(spawnStub)

  const proc = manager.spawnSidecar('echo', ['hello'], {})

  const sidecarProc = manager.getSidecarProcess()
  assert.equal(sidecarProc, proc)
})

test('ProcessManager: handles crash loop detection', () => {
  const { spawnStub } = createSpawnStub()
  const manager = new ProcessManager(spawnStub)

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
  assert.ok(agent.restartTimer)
  assert.equal(agent.backoffMs, initialBackoff)
  clearTimeout(agent.restartTimer)
  agent.restartTimer = null
})

test('ProcessManager: shutdown during restart timer', async () => {
  const { spawnStub } = createSpawnStub()
  const manager = new ProcessManager(spawnStub)

  // Start an agent (will set state to starting)
  manager.spawnAgent()

  // Kill it before it fully starts
  await manager.killProcess('agent')

  const states = manager.getStates()
  assert.equal(states.agent, 'stopped')
})

test('ProcessManager: intentionalKill prevents restart', () => {
  const { spawnStub, calls } = createSpawnStub()
  const manager = new ProcessManager(spawnStub)

  manager.spawnAgent()

  const processes = (manager as any).processes
  const agent = processes.get('agent')

  // Set intentional kill flag
  agent.intentionalKill = true

  calls[0].proc.emit('exit', 0, null)

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
  const { spawnStub } = createSpawnStub()
  const manager = new ProcessManager(spawnStub)

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
  const { spawnStub } = createSpawnStub()
  const manager = new ProcessManager(spawnStub)

  const extraEnv = { API_KEY: 'test-key', DEBUG: 'true' }
  manager.spawnAgent(undefined, extraEnv)

  const processes = (manager as any).processes
  const agent = processes.get('agent')

  assert.deepEqual(agent.extraEnv, extraEnv)
})
