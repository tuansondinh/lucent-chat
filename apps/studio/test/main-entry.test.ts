import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir, readFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsService } from '../src/main/settings-service.js'
import { SessionService } from '../src/main/session-service.js'
import { VoiceService } from '../src/main/voice-service.js'
import { PaneManager } from '../src/main/pane-manager.js'
import { ProcessManager } from '../src/main/process-manager.js'
import { AgentBridge } from '../src/main/agent-bridge.js'
import { Orchestrator } from '../src/main/orchestrator.js'
import { AuthService } from '../src/main/auth-service.js'
import { FileService } from '../src/main/file-service.js'
import { GitService } from '../src/main/git-service.js'
import { FileWatchService } from '../src/main/file-watch-service.js'

// Helper to create a test config directory
async function createTestConfigDir(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'lucent-main-'))
  const configDir = join(base, 'lucent')
  await mkdir(configDir, { recursive: true })
  return configDir
}

// Helper to create a test auth directory
async function createTestAuthDir(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'lucent-auth-'))
  const authDir = join(base, 'agent')
  await mkdir(authDir, { recursive: true })
  return base
}

test('Main entry: SettingsService loads settings on startup', async (t) => {
  const configDir = await createTestConfigDir()

  try {
    // Override the config path
    const originalEnv = process.env.LUCENT_CONFIG_DIR
    process.env.LUCENT_CONFIG_DIR = configDir

    // Create settings file
    const settingsPath = join(configDir, 'settings.json')
    const testSettings = {
      theme: 'dark',
      fontSize: 16,
      tavilyApiKey: undefined,
      defaultModel: undefined,
      sidebarCollapsed: true,
      windowBounds: { x: 100, y: 100, width: 1200, height: 800 },
      lastProjectRoot: '/tmp/demo-project',
      lastActiveFilePath: 'src/main.ts',
      onboardingComplete: true,
      voicePttShortcut: 'alt+space' as const,
      voiceAudioEnabled: false,
      voiceServiceEnabled: false,
      voiceModelsDownloaded: true,
    }
    await writeFile(settingsPath, JSON.stringify(testSettings, null, 2), 'utf8')

    // Load settings
    const settingsService = new SettingsService()
    const settings = settingsService.load()

    // Verify settings were loaded
    assert.equal(settings.theme, 'dark')
    assert.equal(settings.fontSize, 16)
    assert.equal(settings.sidebarCollapsed, true)
    assert.deepEqual(settings.windowBounds, { x: 100, y: 100, width: 1200, height: 800 })
    assert.equal(settings.lastProjectRoot, '/tmp/demo-project')
    assert.equal(settings.lastActiveFilePath, 'src/main.ts')
    assert.equal(settings.onboardingComplete, true)
    assert.equal(settings.voicePttShortcut, 'alt+space')
    assert.equal(settings.voiceAudioEnabled, false)
    assert.equal(settings.voiceServiceEnabled, false)
    assert.equal(settings.voiceModelsDownloaded, true)

    // Restore env
    if (originalEnv === undefined) {
      delete process.env.LUCENT_CONFIG_DIR
    } else {
      process.env.LUCENT_CONFIG_DIR = originalEnv
    }
  } finally {
    await rm(configDir, { recursive: true, force: true })
  }
})

test('Main entry: SettingsService creates default settings when file missing', async (t) => {
  const configDir = await createTestConfigDir()

  try {
    const originalEnv = process.env.LUCENT_CONFIG_DIR
    const originalHome = process.env.HOME
    process.env.LUCENT_CONFIG_DIR = configDir
    process.env.HOME = join(configDir, 'isolated-home')
    await mkdir(process.env.HOME, { recursive: true })

    // Don't create settings file - should use defaults
    const settingsService = new SettingsService()
    const settings = settingsService.load()

    // Should have defaults
    assert.equal(settings.theme, 'dark')
    assert.equal(settings.fontSize, 14)
    assert.equal(settings.sidebarCollapsed, false)
    assert.equal(settings.onboardingComplete, false)
    assert.equal(settings.voicePttShortcut, 'space')
    assert.equal(settings.voiceAudioEnabled, true)
    assert.equal(settings.voiceServiceEnabled, true)
    assert.equal(settings.voiceModelsDownloaded, false)

    // File should be created
    const settingsPath = join(configDir, 'settings.json')
    const content = await readFile(settingsPath, 'utf8')
    const parsed = JSON.parse(content)
    assert.equal(parsed.theme, 'dark')

    if (originalEnv === undefined) {
      delete process.env.LUCENT_CONFIG_DIR
    } else {
      process.env.LUCENT_CONFIG_DIR = originalEnv
    }
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
  } finally {
    await rm(configDir, { recursive: true, force: true })
  }
})

test('Main entry: SettingsService handles malformed settings file', async (t) => {
  const configDir = await createTestConfigDir()

  try {
    const originalEnv = process.env.LUCENT_CONFIG_DIR
    process.env.LUCENT_CONFIG_DIR = configDir

    // Write malformed JSON
    const settingsPath = join(configDir, 'settings.json')
    await writeFile(settingsPath, '{ invalid json }', 'utf8')

    // Should create new settings with defaults
    const settingsService = new SettingsService()
    const settings = settingsService.load()

    // Should have defaults
    assert.equal(settings.theme, 'dark')
    assert.equal(settings.fontSize, 14)
    assert.equal(settings.voiceServiceEnabled, true)

    if (originalEnv === undefined) {
      delete process.env.LUCENT_CONFIG_DIR
    } else {
      process.env.LUCENT_CONFIG_DIR = originalEnv
    }
  } finally {
    await rm(configDir, { recursive: true, force: true })
  }
})

test('Main entry: SessionService loads active session on startup', async (t) => {
  const configDir = await createTestConfigDir()

  try {
    const originalEnv = process.env.LUCENT_CONFIG_DIR
    process.env.LUCENT_CONFIG_DIR = configDir

    // Create session directory and files
    const sessionDir = join(configDir, 'sessions')
    await mkdir(sessionDir, { recursive: true })

    // Create active session file
    const activeSessionPath = join(configDir, 'active-session')
    await writeFile(activeSessionPath, 'session-1.json', 'utf8')

    // Create a session file
    const sessionPath = join(sessionDir, 'session-1.json')
    await writeFile(sessionPath, JSON.stringify([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]), 'utf8')

    // Load active session
    const agentBridge = new AgentBridge()
    const sessionService = new SessionService(agentBridge)
    await sessionService.loadActiveSessionId()

    // Verify active session was loaded
    // (This is limited without a real agent, but we can check no errors)
    assert.ok(true)

    if (originalEnv === undefined) {
      delete process.env.LUCENT_CONFIG_DIR
    } else {
      process.env.LUCENT_CONFIG_DIR = originalEnv
    }
  } finally {
    await rm(configDir, { recursive: true, force: true })
  }
})

test('Main entry: SessionService handles missing session directory', async (t) => {
  const configDir = await createTestConfigDir()

  try {
    const originalEnv = process.env.LUCENT_CONFIG_DIR
    process.env.LUCENT_CONFIG_DIR = configDir

    // Don't create session directory
    const agentBridge = new AgentBridge()
    const sessionService = new SessionService(agentBridge)

    // Should not throw
    await sessionService.loadActiveSessionId()

    if (originalEnv === undefined) {
      delete process.env.LUCENT_CONFIG_DIR
    } else {
      process.env.LUCENT_CONFIG_DIR = originalEnv
    }
  } finally {
    await rm(configDir, { recursive: true, force: true })
  }
})

test('Main entry: SessionService handles malformed session file', async (t) => {
  const configDir = await createTestConfigDir()

  try {
    const originalEnv = process.env.LUCENT_CONFIG_DIR
    process.env.LUCENT_CONFIG_DIR = configDir

    // Create session directory
    const sessionDir = join(configDir, 'sessions')
    await mkdir(sessionDir, { recursive: true })

    // Create malformed session file
    const sessionPath = join(sessionDir, 'session-1.json')
    await writeFile(sessionPath, '{ invalid json }', 'utf8')

    const agentBridge = new AgentBridge()
    const sessionService = new SessionService(agentBridge)

    // Should not throw
    const messages = await sessionService.getMessages()
    assert.ok(Array.isArray(messages))

    if (originalEnv === undefined) {
      delete process.env.LUCENT_CONFIG_DIR
    } else {
      process.env.LUCENT_CONFIG_DIR = originalEnv
    }
  } finally {
    await rm(configDir, { recursive: true, force: true })
  }
})

test('Main entry: VoiceService probes and prewarms on startup', async (t) => {
  const voiceService = new VoiceService(() => '/test/project')

  // Probe should not throw
  const probeResult = await voiceService.probe()
  assert.ok(typeof probeResult.available === 'boolean')

  // Start should not throw
  try {
    const startResult = await voiceService.start()
    assert.ok(typeof startResult === 'boolean')

    // Stop
    await voiceService.stop()
  } catch (err) {
    // Voice service might not be available in test environment
    assert.ok(err.message.includes('Python not found') || err.message.includes('voice') || err.message.includes('audio'))
  }
})

test('Main entry: PaneManager initializes pane-0', async (t) => {
  const paneManager = new PaneManager()
  const processManager = new ProcessManager()
  const agentBridge = new AgentBridge()
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
  const sessionService = new SessionService(agentBridge)
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
})

// Removed: AgentBridge attaches to process — hangs in test env (getState waits for process response)

// Removed: ProcessManager spawns agent — integration test; process spawning tested in process-manager.test.ts

test('Main entry: FileWatchService watches pane-0', async (t) => {
  const events: any[] = []
  const pushEvent = (channel: string, data: any) => {
    events.push({ channel, data })
  }

  const fileWatchService = new FileWatchService(pushEvent)

  // Watch pane-0
  fileWatchService.watchPane('pane-0', '/test/project')

  // Notify root changed
  fileWatchService.notifyRootChanged('pane-0')

  await new Promise((resolve) => setTimeout(resolve, 150))

  // Should have root change event
  const rootEvents = events.filter(
    (e) => e.channel === 'event:file-changed' &&
    e.data.paneId === 'pane-0' &&
    e.data.changes.some((c: any) => c.eventType === 'root')
  )

  assert.ok(rootEvents.length > 0)

  // Cleanup
  fileWatchService.shutdown()
})

test('Main entry: AuthService loads provider statuses', async (t) => {
  const authService = new AuthService()

  // Get catalog
  const catalog = authService.getProviderCatalog()
  assert.ok(Array.isArray(catalog))
  assert.ok(catalog.length > 0)

  // Get statuses
  const statuses = authService.getProviderStatuses()
  assert.ok(Array.isArray(statuses))
  assert.equal(statuses.length, catalog.length)
})

test('Main entry: App relaunch restores active session', async (t) => {
  const configDir = await createTestConfigDir()

  try {
    const originalEnv = process.env.LUCENT_CONFIG_DIR
    process.env.LUCENT_CONFIG_DIR = configDir

    // Create session directory and files
    const sessionDir = join(configDir, 'sessions')
    await mkdir(sessionDir, { recursive: true })

    // Create active session marker
    const activeSessionPath = join(configDir, 'active-session')
    await writeFile(activeSessionPath, 'relaunch-session.json', 'utf8')

    // Create session file with messages
    const sessionPath = join(sessionDir, 'relaunch-session.json')
    await writeFile(sessionPath, JSON.stringify([
      { role: 'user', content: 'before relaunch' },
      { role: 'assistant', content: 'response before relaunch' },
    ], null, 2), 'utf8')

    // Create settings with persisted state
    const settingsPath = join(configDir, 'settings.json')
    await writeFile(settingsPath, JSON.stringify({
      theme: 'dark',
      fontSize: 18,
      tavilyApiKey: undefined,
      defaultModel: undefined,
      sidebarCollapsed: false,
      windowBounds: { x: 50, y: 50, width: 1400, height: 900 },
      lastProjectRoot: '/tmp/relaunch-project',
      lastActiveFilePath: 'README.md',
      onboardingComplete: true,
      voicePttShortcut: 'cmd+shift+space',
      voiceAudioEnabled: true,
      voiceModelsDownloaded: false,
    }, null, 2), 'utf8')

    // Simulate app relaunch by creating new services
    const settingsService = new SettingsService()
    const settings = settingsService.load()

    // Verify settings were restored
    assert.equal(settings.fontSize, 18)
    assert.equal(settings.onboardingComplete, true)
    assert.equal(settings.voicePttShortcut, 'cmd+shift+space')
    assert.deepEqual(settings.windowBounds, { x: 50, y: 50, width: 1400, height: 900 })
    assert.equal(settings.lastProjectRoot, '/tmp/relaunch-project')
    assert.equal(settings.lastActiveFilePath, 'README.md')

    // Load session
    const agentBridge = new AgentBridge()
    const sessionService = new SessionService(agentBridge)
    await sessionService.loadActiveSessionId()

    // Verify session can be loaded
    const messages = await sessionService.getMessages()
    assert.ok(Array.isArray(messages))

    if (originalEnv === undefined) {
      delete process.env.LUCENT_CONFIG_DIR
    } else {
      process.env.LUCENT_CONFIG_DIR = originalEnv
    }
  } finally {
    await rm(configDir, { recursive: true, force: true })
  }
})

test('Main entry: Startup handles missing auth directory', async (t) => {
  const authDir = await createTestAuthDir()

  try {
    const authService = new AuthService()
    const authPath = join(authDir, 'agent', 'auth.json')
    ;(authService as any).authPath = authPath

    // Don't create auth file - should handle gracefully
    const statuses = authService.getProviderStatuses()
    assert.ok(Array.isArray(statuses))
  } finally {
    await rm(authDir, { recursive: true, force: true })
  }
})

test('Main entry: Startup handles malformed auth file', async (t) => {
  const authDir = await createTestAuthDir()

  try {
    const authService = new AuthService()
    const authPath = join(authDir, 'agent', 'auth.json')
    ;(authService as any).authPath = authPath

    // Write malformed JSON
    await writeFile(authPath, '{ invalid json }', 'utf8')

    // Should handle gracefully
    const statuses = authService.getProviderStatuses()
    assert.ok(Array.isArray(statuses))

    // All file-based auth should be unconfigured
    const configuredViaFile = statuses.filter((s: any) => s.configuredVia === 'auth_file')
    assert.equal(configuredViaFile.length, 0)
  } finally {
    await rm(authDir, { recursive: true, force: true })
  }
})

test('Main entry: Startup handles missing session file reference', async (t) => {
  const configDir = await createTestConfigDir()

  try {
    const originalEnv = process.env.LUCENT_CONFIG_DIR
    process.env.LUCENT_CONFIG_DIR = configDir

    // Create session directory
    const sessionDir = join(configDir, 'sessions')
    await mkdir(sessionDir, { recursive: true })

    // Create active session marker pointing to non-existent file
    const activeSessionPath = join(configDir, 'active-session')
    await writeFile(activeSessionPath, 'non-existent-session.json', 'utf8')

    // Load should not throw
    const agentBridge = new AgentBridge()
    const sessionService = new SessionService(agentBridge)
    await sessionService.loadActiveSessionId()

    // Get messages should return empty array
    const messages = await sessionService.getMessages()
    assert.ok(Array.isArray(messages))
    assert.equal(messages.length, 0)

    if (originalEnv === undefined) {
      delete process.env.LUCENT_CONFIG_DIR
    } else {
      process.env.LUCENT_CONFIG_DIR = originalEnv
    }
  } finally {
    await rm(configDir, { recursive: true, force: true })
  }
})

test('Main entry: Multiple services can coexist', async (t) => {
  const configDir = await createTestConfigDir()

  try {
    const originalEnv = process.env.LUCENT_CONFIG_DIR
    process.env.LUCENT_CONFIG_DIR = configDir

    // Create all main services
    const settingsService = new SettingsService()
    const authService = new AuthService()
    const fileService = new FileService()
    const gitService = new GitService()
    const voiceService = new VoiceService(() => '/test/project')
    const processManager = new ProcessManager()
    const agentBridge = new AgentBridge()
    const sessionService = new SessionService(agentBridge)
    const paneManager = new PaneManager()
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

    // Initialize pane-0
    const attachBridge = () => {}
    paneManager.initPane0(
      processManager,
      agentBridge,
      orchestrator,
      sessionService,
      attachBridge,
      '/test/project'
    )

    // All should work together
    const settings = settingsService.load()
    assert.ok(settings)

    const catalog = authService.getProviderCatalog()
    assert.ok(catalog)

    // Get pane
    const pane = paneManager.getPane('pane-0')
    assert.ok(pane)

    if (originalEnv === undefined) {
      delete process.env.LUCENT_CONFIG_DIR
    } else {
      process.env.LUCENT_CONFIG_DIR = originalEnv
    }
  } finally {
    await rm(configDir, { recursive: true, force: true })
  }
})

test('Main entry: Window bounds are persisted on move/resize', async (t) => {
  const configDir = await createTestConfigDir()

  try {
    const originalEnv = process.env.LUCENT_CONFIG_DIR
    process.env.LUCENT_CONFIG_DIR = configDir

    const settingsService = new SettingsService()

    // Save bounds
    settingsService.save({
      windowBounds: { x: 200, y: 200, width: 1600, height: 1000 },
    })

    // Reload
    const settings = settingsService.load()
    assert.deepEqual(settings.windowBounds, { x: 200, y: 200, width: 1600, height: 1000 })

    // Update bounds
    settingsService.save({
      windowBounds: { x: 300, y: 300, width: 1500, height: 900 },
    })

    // Reload again
    const settings2 = settingsService.load()
    assert.deepEqual(settings2.windowBounds, { x: 300, y: 300, width: 1500, height: 900 })

    if (originalEnv === undefined) {
      delete process.env.LUCENT_CONFIG_DIR
    } else {
      process.env.LUCENT_CONFIG_DIR = originalEnv
    }
  } finally {
    await rm(configDir, { recursive: true, force: true })
  }
})
