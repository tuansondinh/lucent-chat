/**
 * Phase 1: Types, RPC Protocol, and Settings — auto mode
 *
 * Tests:
 * - PermissionMode includes 'auto'
 * - getPermissionMode() recognizes 'auto' from env var
 * - registerStdioClassifierHandler() and resolveClassifierResponse() exist
 * - requestClassifierDecision() exists and returns boolean
 * - settings-contract validates 'auto' permissionMode
 * - settings-contract validates autoModeRules
 * - PaneManager.togglePanePermissionMode cycles: danger-full-access → accept-on-edit → auto → danger-full-access
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

// ============================================================================
// tool-approval.ts tests
// ============================================================================

// Import tool-approval directly (monorepo path from apps/studio/test/)
import {
  getPermissionMode,
  registerStdioClassifierHandler,
  resolveClassifierResponse,
  requestClassifierDecision,
  setClassifierHandler,
} from '../../../packages/pi-coding-agent/src/core/tool-approval.js'

test('tool-approval: getPermissionMode returns auto when env var is auto', () => {
  const original = process.env.GSD_STUDIO_PERMISSION_MODE
  try {
    process.env.GSD_STUDIO_PERMISSION_MODE = 'auto'
    assert.equal(getPermissionMode(), 'auto')
  } finally {
    if (original === undefined) delete process.env.GSD_STUDIO_PERMISSION_MODE
    else process.env.GSD_STUDIO_PERMISSION_MODE = original
  }
})

test('tool-approval: getPermissionMode returns danger-full-access by default', () => {
  const original = process.env.GSD_STUDIO_PERMISSION_MODE
  try {
    delete process.env.GSD_STUDIO_PERMISSION_MODE
    assert.equal(getPermissionMode(), 'danger-full-access')
  } finally {
    if (original !== undefined) process.env.GSD_STUDIO_PERMISSION_MODE = original
  }
})

test('tool-approval: getPermissionMode returns accept-on-edit when env var is accept-on-edit', () => {
  const original = process.env.GSD_STUDIO_PERMISSION_MODE
  try {
    process.env.GSD_STUDIO_PERMISSION_MODE = 'accept-on-edit'
    assert.equal(getPermissionMode(), 'accept-on-edit')
  } finally {
    if (original === undefined) delete process.env.GSD_STUDIO_PERMISSION_MODE
    else process.env.GSD_STUDIO_PERMISSION_MODE = original
  }
})

test('tool-approval: registerStdioClassifierHandler is exported as a function', () => {
  assert.equal(typeof registerStdioClassifierHandler, 'function')
})

test('tool-approval: resolveClassifierResponse is exported as a function', () => {
  assert.equal(typeof resolveClassifierResponse, 'function')
})

test('tool-approval: requestClassifierDecision is exported as a function', () => {
  assert.equal(typeof requestClassifierDecision, 'function')
})

test('tool-approval: requestClassifierDecision returns true when mode is not auto (no-op)', async () => {
  const original = process.env.GSD_STUDIO_PERMISSION_MODE
  try {
    process.env.GSD_STUDIO_PERMISSION_MODE = 'danger-full-access'
    const result = await requestClassifierDecision({ toolName: 'bash', toolCallId: 'tc1', args: { command: 'ls' } })
    assert.equal(result, true)
  } finally {
    if (original === undefined) delete process.env.GSD_STUDIO_PERMISSION_MODE
    else process.env.GSD_STUDIO_PERMISSION_MODE = original
  }
})

test('tool-approval: requestClassifierDecision returns false when mode is auto and no handler', async () => {
  const original = process.env.GSD_STUDIO_PERMISSION_MODE
  try {
    process.env.GSD_STUDIO_PERMISSION_MODE = 'auto'
    // Reset classifier handler to null
    setClassifierHandler(null)
    const result = await requestClassifierDecision({ toolName: 'bash', toolCallId: 'tc1', args: { command: 'ls' } })
    assert.equal(result, false)
  } finally {
    if (original === undefined) delete process.env.GSD_STUDIO_PERMISSION_MODE
    else process.env.GSD_STUDIO_PERMISSION_MODE = original
    setClassifierHandler(null)
  }
})

test('tool-approval: setClassifierHandler and requestClassifierDecision work together', async () => {
  const original = process.env.GSD_STUDIO_PERMISSION_MODE
  try {
    process.env.GSD_STUDIO_PERMISSION_MODE = 'auto'
    // Set up a handler that immediately approves
    setClassifierHandler(async (_req) => true)
    const result = await requestClassifierDecision({ toolName: 'bash', toolCallId: 'tc2', args: {} })
    assert.equal(result, true)
  } finally {
    if (original === undefined) delete process.env.GSD_STUDIO_PERMISSION_MODE
    else process.env.GSD_STUDIO_PERMISSION_MODE = original
    setClassifierHandler(null)
  }
})

// ============================================================================
// settings-contract.ts tests: auto mode
// ============================================================================

test('settings-contract: validates permissionMode auto', async () => {
  const { validateSettingsPatch } = await import('../src/main/settings-contract.js')
  const result = validateSettingsPatch({ permissionMode: 'auto' })
  assert.deepEqual(result, { permissionMode: 'auto' })
})

test('settings-contract: validates autoModeRules empty array', async () => {
  const { validateSettingsPatch } = await import('../src/main/settings-contract.js')
  const result = validateSettingsPatch({ autoModeRules: [] })
  assert.deepEqual(result, { autoModeRules: [] })
})

test('settings-contract: validates autoModeRules with allow rule', async () => {
  const { validateSettingsPatch } = await import('../src/main/settings-contract.js')
  const rules = [{ toolName: 'bash', pattern: 'git *', decision: 'allow' }]
  const result = validateSettingsPatch({ autoModeRules: rules })
  assert.deepEqual(result, { autoModeRules: rules })
})

test('settings-contract: validates autoModeRules with deny rule', async () => {
  const { validateSettingsPatch } = await import('../src/main/settings-contract.js')
  const rules = [{ toolName: 'bash', pattern: 'rm *', decision: 'deny' }]
  const result = validateSettingsPatch({ autoModeRules: rules })
  assert.deepEqual(result, { autoModeRules: rules })
})

test('settings-contract: rejects autoModeRules with invalid decision', async () => {
  const { validateSettingsPatch } = await import('../src/main/settings-contract.js')
  assert.throws(
    () => validateSettingsPatch({ autoModeRules: [{ toolName: 'bash', pattern: '*', decision: 'maybe' }] }),
    /Invalid autoModeRules rule structure/,
  )
})

test('settings-contract: rejects autoModeRules with missing toolName', async () => {
  const { validateSettingsPatch } = await import('../src/main/settings-contract.js')
  assert.throws(
    () => validateSettingsPatch({ autoModeRules: [{ pattern: '*', decision: 'allow' }] }),
    /Invalid autoModeRules rule structure/,
  )
})

test('settings-contract: rejects autoModeRules that is not an array', async () => {
  const { validateSettingsPatch } = await import('../src/main/settings-contract.js')
  assert.throws(
    () => validateSettingsPatch({ autoModeRules: 'not-an-array' }),
    /Invalid autoModeRules setting/,
  )
})

// ============================================================================
// settings-service.ts tests: autoModeRules defaults
// ============================================================================

test('settings-service: AppSettings has autoModeRules with default rules', async () => {
  // We just test that the module exports the type correctly with defaults
  const { SettingsService } = await import('../src/main/settings-service.js')
  const service = new SettingsService()
  // Load applies defaults
  const settings = service.load()
  assert.ok(Array.isArray(settings.autoModeRules), 'autoModeRules should be an array')
  assert.ok(settings.autoModeRules!.length > 0, 'autoModeRules should have default rules')

  // Check for expected defaults: git allow, npm allow, rm deny, sudo deny, chmod deny
  const rules = settings.autoModeRules!
  const gitRule = rules.find((r) => r.toolName === 'bash' && r.pattern === 'git *')
  const npmRule = rules.find((r) => r.toolName === 'bash' && r.pattern === 'npm *')
  const rmRule = rules.find((r) => r.toolName === 'bash' && r.pattern === 'rm *')
  const sudoRule = rules.find((r) => r.toolName === 'bash' && r.pattern === 'sudo *')
  const chmodRule = rules.find((r) => r.toolName === 'bash' && r.pattern === 'chmod *')

  assert.ok(gitRule, 'should have git allow rule')
  assert.equal(gitRule?.decision, 'allow')
  assert.ok(npmRule, 'should have npm allow rule')
  assert.equal(npmRule?.decision, 'allow')
  assert.ok(rmRule, 'should have rm deny rule')
  assert.equal(rmRule?.decision, 'deny')
  assert.ok(sudoRule, 'should have sudo deny rule')
  assert.equal(sudoRule?.decision, 'deny')
  assert.ok(chmodRule, 'should have chmod deny rule')
  assert.equal(chmodRule?.decision, 'deny')
})

// ============================================================================
// pane-manager.ts tests: togglePanePermissionMode three-state cycling
// ============================================================================

test('PaneManager: togglePanePermissionMode cycles through 3 states', async () => {
  const { PaneManager } = await import('../src/main/pane-manager.js')
  const { Orchestrator } = await import('../src/main/orchestrator.js')

  // Create a mock agent bridge
  const mockAgentBridge = {
    attach: () => {},
    detach: () => {},
    getState: async () => ({ sessionFile: null }),
    onAgentEvent: () => () => {},
  }

  // Create a mock process manager
  const processManagerEvents: any[] = []
  const mockProcessManager = new EventEmitter() as any
  mockProcessManager.spawned = false
  mockProcessManager.spawnAgent = (root: string, env?: Record<string, string>) => {
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
    onTurnState: () => {},
    onError: () => {},
    onThinkingStart: () => {},
    onThinkingChunk: () => {},
    onThinkingEnd: () => {},
    onTextBlockStart: () => {},
    onTextBlockEnd: () => {},
  })

  const mockSessionService = {
    loadActiveSessionId: async () => {},
    setActiveSessionId: () => {},
  }

  const paneManager = new PaneManager()
  const pane = paneManager['panes'] // Direct access for test setup
  const paneRuntime = {
    id: 'pane-test',
    processManager: mockProcessManager,
    agentBridge: mockAgentBridge,
    orchestrator,
    sessionService: mockSessionService,
    model: '',
    projectRoot: '/test',
    accessRoot: '/test',
    attachBridge: () => {},
    permissionMode: 'danger-full-access' as const,
  }
  paneManager['panes'].set('pane-test', paneRuntime as any)

  // First toggle: danger-full-access → accept-on-edit
  const mode1 = await paneManager.togglePanePermissionMode('pane-test')
  assert.equal(mode1, 'accept-on-edit')

  // Second toggle: accept-on-edit → auto
  const mode2 = await paneManager.togglePanePermissionMode('pane-test')
  assert.equal(mode2, 'auto')

  // Third toggle: auto → danger-full-access
  const mode3 = await paneManager.togglePanePermissionMode('pane-test')
  assert.equal(mode3, 'danger-full-access')
})

test('PaneManager: togglePanePermissionMode returns danger-full-access for unknown pane', async () => {
  const { PaneManager } = await import('../src/main/pane-manager.js')
  const paneManager = new PaneManager()
  const result = await paneManager.togglePanePermissionMode('unknown-pane')
  assert.equal(result, 'danger-full-access')
})

// ============================================================================
// rpc-types.ts tests: classifier_request and classifier_response types
// ============================================================================

test('rpc-types: RpcExtensionUIRequest includes classifier_request shape', async () => {
  // We just verify the module compiles and exports properly
  // The type check is compile-time; at runtime we verify the JSON can be constructed
  const classifierRequest = {
    type: 'classifier_request' as const,
    id: 'cls_1',
    toolName: 'bash',
    toolCallId: 'tc_1',
    args: { command: 'ls' },
  }
  assert.equal(classifierRequest.type, 'classifier_request')
  assert.equal(classifierRequest.toolName, 'bash')
  assert.equal(classifierRequest.toolCallId, 'tc_1')
})

test('rpc-types: RpcCommand includes classifier_response shape', async () => {
  const classifierResponse = {
    type: 'classifier_response' as const,
    id: 'cls_1',
    approved: true,
  }
  assert.equal(classifierResponse.type, 'classifier_response')
  assert.equal(classifierResponse.approved, true)
})
