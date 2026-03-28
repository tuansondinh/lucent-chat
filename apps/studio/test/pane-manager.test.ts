import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PaneManager } from '../src/main/pane-manager.js'
import { ProcessManager } from '../src/main/process-manager.js'
import { AgentBridge } from '../src/main/agent-bridge.js'
import { Orchestrator } from '../src/main/orchestrator.js'
import { SessionService } from '../src/main/session-service.js'
import { SettingsService } from '../src/main/settings-service.js'

// Mock settings service
class MockSettingsService {
  public settings: any = {
    tavilyApiKey: undefined,
    defaultModel: undefined,
    theme: 'dark',
    fontSize: 14,
    tavilyApiKey: undefined,
    sidebarCollapsed: false,
    windowBounds: undefined,
    onboardingComplete: false,
    voicePttShortcut: 'space',
    voiceAudioEnabled: true,
    voiceModelsDownloaded: false,
  }

  get() {
    return this.settings
  }

  save(partial: any) {
    Object.assign(this.settings, partial)
  }
}

// Mock process manager
class MockProcessManager extends EventEmitter {
  public spawned = false
  public killedProcesses: string[] = []
  public shutdownCalled = false
  public agentProcess: any = null

  constructor() {
    super()
    this.agentProcess = { stdout: null, stderr: null }
  }

  spawnAgent(projectRoot: string, env?: Record<string, string>): void {
    this.spawned = true
    this.emit('agent-spawned')
  }

  getAgentProcess() {
    return this.agentProcess
  }

  async killProcess(name: string): Promise<void> {
    this.killedProcesses.push(name)
  }

  async shutdownAll(): Promise<void> {
    this.shutdownCalled = true
  }

  getStates(): Record<string, string> {
    return { agent: this.spawned ? 'ready' : 'stopped' }
  }

  setState(name: string, state: string): void {
    // Mock
  }

  onAgentRestarting(callback: () => void): void {
    this.on('agent-restarting', callback)
  }

  removeAllListeners(): void {
    super.removeAllListeners()
  }
}

// Mock agent bridge
class MockAgentBridge {
  public attached = false
  public detached = false
  public currentProcess: any = null

  attach(proc: any): void {
    this.attached = true
    this.currentProcess = proc
  }

  detach(): void {
    this.detached = true
    this.currentProcess = null
  }

  async getState(): Promise<any> {
    return {
      model: { provider: 'test', id: 'test-model' },
      sessionFile: 'test-session.json',
    }
  }

  async getAvailableModels(): Promise<any[]> {
    return []
  }

  setModel(provider: string, modelId: string): void {
    // Mock
  }

  async newSession(): Promise<any> {
    return { cancelled: false }
  }

  async prompt(text: string, options?: any): Promise<void> {
    // Mock
  }

  async abort(): Promise<void> {
    // Mock
  }

  onAgentEvent(callback: (event: any) => void): () => void {
    return () => {}
  }
}

// Mock session service
class MockSessionService {
  public activeSessionId: string | null = null
  public sessions: any[] = []

  async loadActiveSessionId(): Promise<void> {
    // Mock
  }

  setActiveSessionId(id: string): void {
    this.activeSessionId = id
  }

  async listSessions(): Promise<any[]> {
    return this.sessions
  }

  async switchSession(path: string, orchestrator: any): Promise<void> {
    // Mock
  }

  async renameSession(name: string): Promise<void> {
    // Mock
  }

  async deleteSession(path: string): Promise<void> {
    // Mock
  }

  async getMessages(): Promise<any[]> {
    return []
  }
}

function createTestPaneManager(): PaneManager {
  return new PaneManager(() => new MockProcessManager() as unknown as ProcessManager)
}

test('PaneManager: initPane0 creates pane-0', (t) => {
  const paneManager = new PaneManager()
  const processManager = new MockProcessManager()
  const agentBridge = new MockAgentBridge()
  const orchestrator = new Orchestrator(agentBridge, {
    onChunk: () => {},
    onDone: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    onTurnState: () => {},
    onError: () => {},
    onThinkingStart: () => {},
    onThinkingChunk: () => {},
    onThinkingEnd: () => {},
    onTextBlockStart: () => {},
    onTextBlockEnd: () => {},
  })
  const sessionService = new MockSessionService()
  const attachBridge = () => {}

  const pane = paneManager.initPane0(
    processManager,
    agentBridge,
    orchestrator,
    sessionService,
    attachBridge,
    '/test/project'
  )

  assert.equal(pane.id, 'pane-0')
  assert.equal(pane.projectRoot, '/test/project')
  assert.ok(paneManager.getPane('pane-0'))
  assert.deepEqual(paneManager.getPaneIds(), ['pane-0'])
})

test('PaneManager: createPane creates new pane', async (t) => {
  const paneManager = createTestPaneManager()
  const settingsService = new MockSettingsService()
  const events: any[] = []
  const pushEvent = (channel: string, data: any) => {
    events.push({ channel, data })
  }

  const pane = await paneManager.createPane(settingsService, pushEvent)

  assert.ok(pane.id.startsWith('pane-'))
  assert.equal(pane.projectRoot, process.cwd())
  assert.ok(paneManager.getPane(pane.id))
  assert.equal(paneManager.getPaneIds().length, 1)
})

test('PaneManager: destroyPane removes pane', async (t) => {
  const paneManager = createTestPaneManager()
  const settingsService = new MockSettingsService()
  const pushEvent = () => {}

  const pane = await paneManager.createPane(settingsService, pushEvent)

  // Pane should exist
  assert.ok(paneManager.getPane(pane.id))

  // Destroy it
  await paneManager.destroyPane(pane.id)

  // Pane should be gone
  assert.ok(!paneManager.getPane(pane.id))
  assert.equal(paneManager.getPaneIds().length, 0)
})

test('PaneManager: pane-0 is not destroyable', async (t) => {
  const paneManager = new PaneManager()
  const processManager = new MockProcessManager()
  const agentBridge = new MockAgentBridge()
  const orchestrator = new Orchestrator(agentBridge, {
    onChunk: () => {},
    onDone: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    onTurnState: () => {},
    onError: () => {},
    onThinkingStart: () => {},
    onThinkingChunk: () => {},
    onThinkingEnd: () => {},
    onTextBlockStart: () => {},
    onTextBlockEnd: () => {},
  })
  const sessionService = new MockSessionService()
  const attachBridge = () => {}

  paneManager.initPane0(
    processManager,
    agentBridge,
    orchestrator,
    sessionService,
    attachBridge
  )

  // Try to destroy pane-0
  await paneManager.destroyPane('pane-0')

  // pane-0 should still exist
  assert.ok(paneManager.getPane('pane-0'))
})

test('PaneManager: destroyPane during active generation', async (t) => {
  const paneManager = createTestPaneManager()
  const settingsService = new MockSettingsService()
  const pushEvent = () => {}

  const pane = await paneManager.createPane(settingsService, pushEvent)

  // Simulate active generation by having a non-idle turn
  // We can't easily test this without a real orchestrator, but we can verify
  // that destroyPane calls abortCurrentTurn
  const originalAbort = pane.orchestrator.abortCurrentTurn
  let abortCalled = false
  pane.orchestrator.abortCurrentTurn = async () => {
    abortCalled = true
    await originalAbort.call(pane.orchestrator)
  }

  await paneManager.destroyPane(pane.id)

  // Abort should have been called
  assert.ok(abortCalled, 'abort should be called during destroy')

  // Process should be shut down
  assert.ok((pane.processManager as any).shutdownCalled)
})

test('PaneManager: restartPaneAgent during turn', async (t) => {
  const paneManager = createTestPaneManager()
  const settingsService = new MockSettingsService()
  const pushEvent = () => {}

  const pane = await paneManager.createPane(settingsService, pushEvent)

  // Set initial project root
  const initialRoot = '/initial/root'
  pane.projectRoot = initialRoot

  // Restart with new root
  const newRoot = '/new/root'
  await paneManager.restartPaneAgent(pane.id, newRoot)

  // Project root should be updated
  assert.equal(pane.projectRoot, newRoot)

  // Process should have been killed and respawned
  assert.ok((pane.processManager as MockProcessManager).killedProcesses.includes('agent'))
})

test('PaneManager: restartPaneAgent preserves state', async (t) => {
  const paneManager = createTestPaneManager()
  const settingsService = new MockSettingsService()
  const pushEvent = () => {}

  const pane = await paneManager.createPane(settingsService, pushEvent)

  // Set some state
  pane.projectRoot = '/test/root'

  // Restart
  await paneManager.restartPaneAgent(pane.id)

  // State should be preserved
  assert.equal(pane.projectRoot, '/test/root')
  assert.equal(pane.id, pane.id) // ID should not change
})

test('PaneManager: multiple panes are isolated', async (t) => {
  const paneManager = createTestPaneManager()
  const settingsService = new MockSettingsService()
  const pushEvent = () => {}

  // Create multiple panes
  const pane1 = await paneManager.createPane(settingsService, pushEvent)
  const pane2 = await paneManager.createPane(settingsService, pushEvent)
  const pane3 = await paneManager.createPane(settingsService, pushEvent)

  // Each should have unique ID
  assert.ok(pane1.id !== pane2.id)
  assert.ok(pane2.id !== pane3.id)

  // All should be accessible
  assert.ok(paneManager.getPane(pane1.id))
  assert.ok(paneManager.getPane(pane2.id))
  assert.ok(paneManager.getPane(pane3.id))

  // Modify one pane's root
  pane1.projectRoot = '/pane1/root'

  // Others should be unaffected
  assert.notEqual(pane2.projectRoot, '/pane1/root')
  assert.notEqual(pane3.projectRoot, '/pane1/root')

  // Destroy one pane
  await paneManager.destroyPane(pane2.id)

  // Others should still exist
  assert.ok(paneManager.getPane(pane1.id))
  assert.ok(!paneManager.getPane(pane2.id))
  assert.ok(paneManager.getPane(pane3.id))
})

test('PaneManager: getPane returns undefined for unknown pane', (t) => {
  const paneManager = new PaneManager()

  assert.strictEqual(paneManager.getPane('unknown-pane'), undefined)
})

test('PaneManager: getPaneIds returns all pane IDs', async (t) => {
  const paneManager = createTestPaneManager()
  const settingsService = new MockSettingsService()
  const pushEvent = () => {}

  // Initially empty (except pane-0 which needs init)
  assert.deepEqual(paneManager.getPaneIds(), [])

  // Create pane-0
  const processManager = new MockProcessManager()
  const agentBridge = new MockAgentBridge()
  const orchestrator = new Orchestrator(agentBridge, {
    onChunk: () => {},
    onDone: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    onTurnState: () => {},
    onError: () => {},
    onThinkingStart: () => {},
    onThinkingChunk: () => {},
    onThinkingEnd: () => {},
    onTextBlockStart: () => {},
    onTextBlockEnd: () => {},
  })
  const sessionService = new MockSessionService()
  const attachBridge = () => {}

  paneManager.initPane0(
    processManager,
    agentBridge,
    orchestrator,
    sessionService,
    attachBridge
  )

  assert.deepEqual(paneManager.getPaneIds(), ['pane-0'])

  // Create more panes
  const pane1 = await paneManager.createPane(settingsService, pushEvent)
  const pane2 = await paneManager.createPane(settingsService, pushEvent)

  const ids = paneManager.getPaneIds()
  assert.equal(ids.length, 3)
  assert.ok(ids.includes('pane-0'))
  assert.ok(ids.includes(pane1.id))
  assert.ok(ids.includes(pane2.id))
})

test('PaneManager: shutdownAll destroys all non-pane-0 panes', async (t) => {
  const paneManager = createTestPaneManager()
  const settingsService = new MockSettingsService()
  const pushEvent = () => {}

  // Create pane-0
  const processManager = new MockProcessManager()
  const agentBridge = new MockAgentBridge()
  const orchestrator = new Orchestrator(agentBridge, {
    onChunk: () => {},
    onDone: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    onTurnState: () => {},
    onError: () => {},
    onThinkingStart: () => {},
    onThinkingChunk: () => {},
    onThinkingEnd: () => {},
    onTextBlockStart: () => {},
    onTextBlockEnd: () => {},
  })
  const sessionService = new MockSessionService()
  const attachBridge = () => {}

  paneManager.initPane0(
    processManager,
    agentBridge,
    orchestrator,
    sessionService,
    attachBridge
  )

  // Create additional panes
  const pane1 = await paneManager.createPane(settingsService, pushEvent)
  const pane2 = await paneManager.createPane(settingsService, pushEvent)

  // Shutdown all
  await paneManager.shutdownAll()

  // pane-0 should still exist
  assert.ok(paneManager.getPane('pane-0'))

  // Other panes should be gone
  assert.ok(!paneManager.getPane(pane1.id))
  assert.ok(!paneManager.getPane(pane2.id))
})

test('PaneManager: createPane increments index correctly', async (t) => {
  const paneManager = createTestPaneManager()
  const settingsService = new MockSettingsService()
  const pushEvent = () => {}

  const pane1 = await paneManager.createPane(settingsService, pushEvent)
  const pane2 = await paneManager.createPane(settingsService, pushEvent)
  const pane3 = await paneManager.createPane(settingsService, pushEvent)

  assert.equal(pane1.id, 'pane-1')
  assert.equal(pane2.id, 'pane-2')
  assert.equal(pane3.id, 'pane-3')
})

test('PaneManager: restartPaneAgent handles unknown pane', async (t) => {
  const paneManager = new PaneManager()

  // Should not throw
  await paneManager.restartPaneAgent('unknown-pane')
  await paneManager.restartPaneAgent('unknown-pane', '/new/root')
})

test('PaneManager: destroyPane handles unknown pane', async (t) => {
  const paneManager = new PaneManager()

  // Should not throw
  await paneManager.destroyPane('unknown-pane')
})

test('PaneManager: pane runtime has all required properties', async (t) => {
  const paneManager = createTestPaneManager()
  const settingsService = new MockSettingsService()
  const pushEvent = () => {}

  const pane = await paneManager.createPane(settingsService, pushEvent)

  // Check all required properties exist
  assert.ok(pane.id)
  assert.ok(pane.processManager)
  assert.ok(pane.agentBridge)
  assert.ok(pane.orchestrator)
  assert.ok(pane.sessionService)
  assert.ok(typeof pane.model === 'string')
  assert.ok(pane.projectRoot)
  assert.ok(typeof pane.attachBridge === 'function')
})
