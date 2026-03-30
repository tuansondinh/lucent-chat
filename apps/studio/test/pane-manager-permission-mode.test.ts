import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

test('PaneManager: togglePanePermissionMode cycles through all permission modes', async () => {
  const { PaneManager } = await import('../src/main/pane-manager.js')
  const { Orchestrator } = await import('../src/main/orchestrator.js')

  const mockAgentBridge = {
    attach: () => {},
    detach: () => {},
    getState: async () => ({ sessionFile: null }),
    onAgentEvent: () => () => {},
    setPermissionMode: async () => {},
  }

  const processManagerEvents: Array<{ type: string; env?: Record<string, string> }> = []
  const mockProcessManager = new EventEmitter() as any
  mockProcessManager.spawned = false
  mockProcessManager.spawnAgent = (_root: string, env?: Record<string, string>) => {
    processManagerEvents.push({ type: 'spawn', env })
    mockProcessManager.spawned = true
  }
  mockProcessManager.getAgentProcess = () => null
  mockProcessManager.killProcess = async () => {}
  mockProcessManager.shutdownAll = async () => {}
  mockProcessManager.setState = () => {}

  const orchestrator = new Orchestrator(mockAgentBridge as any, {
    onChunk: () => {},
    onDone: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    onToolUpdate: () => {},
    onTurnState: () => {},
    onError: () => {},
    onThinkingStart: () => {},
    onThinkingChunk: () => {},
    onThinkingEnd: () => {},
    onTextBlockStart: () => {},
    onTextBlockEnd: () => {},
  })

  const paneManager = new PaneManager()
  paneManager['panes'].set('pane-test', {
    id: 'pane-test',
    processManager: mockProcessManager,
    agentBridge: mockAgentBridge,
    orchestrator,
    sessionService: {
      loadActiveSessionId: async () => {},
      setActiveSessionId: () => {},
    },
    model: '',
    projectRoot: '/test',
    accessRoot: '/test',
    attachBridge: () => {},
    permissionMode: 'danger-full-access',
  } as any)

  assert.equal(await paneManager.togglePanePermissionMode('pane-test'), 'accept-on-edit')
  assert.equal(await paneManager.togglePanePermissionMode('pane-test'), 'auto')
  assert.equal(await paneManager.togglePanePermissionMode('pane-test'), 'danger-full-access')
})

test('PaneManager: togglePanePermissionMode falls back to the default for unknown panes', async () => {
  const { PaneManager } = await import('../src/main/pane-manager.js')
  const { DEFAULT_PERMISSION_MODE } = await import('../src/main/settings-service.js')

  const paneManager = new PaneManager()
  assert.equal(await paneManager.togglePanePermissionMode('unknown-pane'), DEFAULT_PERMISSION_MODE)
})
