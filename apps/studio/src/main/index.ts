import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { ProcessManager } from './process-manager.js'
import { AgentBridge } from './agent-bridge.js'
import { Orchestrator } from './orchestrator.js'
import { PaneManager } from './pane-manager.js'
import { registerIpcHandlers, pushEvent } from './ipc-handlers.js'
import { SessionService } from './session-service.js'
import { SettingsService } from './settings-service.js'
import { TerminalManager } from './terminal-manager.js'
import { AuthService } from './auth-service.js'
import { VoiceService } from './voice-service.js'
import { FileService } from './file-service.js'
import { GitService } from './git-service.js'
import { FileWatchService } from './file-watch-service.js'
import { SkillRegistry } from './skill-registry.js'
import { SkillExecutor } from './skill-executor.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let processManager: ProcessManager | null = null
let terminalManager: TerminalManager | null = null
let paneManager: PaneManager | null = null
let voiceService: VoiceService | null = null
let fileWatchService: FileWatchService | null = null

// Extend Electron App type with isQuitting flag
declare module 'electron' {
  interface App {
    isQuitting: boolean
  }
}
app.isQuitting = false
app.setName('LC')

function createWindow(savedBounds?: { x: number; y: number; width: number; height: number }): BrowserWindow {
  const preload = join(__dirname, '../preload/index.cjs')

  const window = new BrowserWindow({
    width: savedBounds?.width ?? 1400,
    height: savedBounds?.height ?? 900,
    x: savedBounds?.x,
    y: savedBounds?.y,
    minWidth: 500,
    minHeight: 500,
    backgroundColor: '#1a1a1a',
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    titleBarOverlay: process.platform === 'darwin' ? { height: 36 } : undefined,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL

  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  const isAllowedNavigation = (targetUrl: string): boolean => {
    if (rendererUrl) {
      try {
        return new URL(targetUrl).origin === new URL(rendererUrl).origin
      } catch {
        return false
      }
    }

    const appFileUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
    return targetUrl === appFileUrl
  }

  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedNavigation(targetUrl)) {
      event.preventDefault()
    }
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  window.webContents.on('before-input-event', (event, input) => {
    if (!input.meta || input.control || input.alt) return

    if (!input.shift && input.code === 'KeyN') {
      event.preventDefault()
      window.webContents.send('event:app-shortcut', { action: 'new-session' })
      return
    }

    if (input.shift && input.code === 'KeyF') {
      event.preventDefault()
      window.webContents.send('event:app-shortcut', { action: 'toggle-file-viewer' })
    }
  })

  // Window close → hide to tray (macOS). On other platforms, allow normal close.
  window.on('close', (e) => {
    if (process.platform === 'darwin' && !app.isQuitting) {
      e.preventDefault()
      window.hide()
    }
  })

  // Open DevTools in dev mode to debug rendering issues
  if (process.env.ELECTRON_RENDERER_URL) {
    window.webContents.openDevTools()
  }

  console.log('[studio] window created')
  return window
}

function buildTrayMenu(agentState: string): Electron.Menu {
  return Menu.buildFromTemplate([
    { label: `Agent: ${agentState}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Open Window',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true
        app.quit()
      },
    },
  ])
}

app.whenReady().then(async () => {
  // 1. Settings — load first so we can restore window bounds
  const settingsService = new SettingsService()
  const settings = settingsService.load()

  // 2. Create window (restore saved bounds if available)
  mainWindow = createWindow(settings.windowBounds)

  // Persist window bounds on move/resize
  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const b = mainWindow.getBounds()
    settingsService.save({ windowBounds: { x: b.x, y: b.y, width: b.width, height: b.height } })
  }
  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)

  // 3. Process Manager
  processManager = new ProcessManager()

  // 3a. Voice Service — project root is 3 levels up from studio/dist/main at runtime
  voiceService = new VoiceService(() => join(__dirname, '..', '..', '..'))
  voiceService.probe()
    .then((result) => {
      if (!result.available) return
      // Prewarm the Python voice sidecar shortly after launch so first mic use is fast.
      setTimeout(() => {
        voiceService?.start().catch((err: Error) => {
          console.warn('[voice] background start failed:', err.message)
        })
      }, 2_000)
    })
    .catch((err: Error) => console.warn('[voice] probe failed:', err.message))

  // 4. Agent Bridge
  const agentBridge = new AgentBridge()

  // 5. Session Service
  const sessionService = new SessionService(agentBridge)
  await sessionService.loadActiveSessionId()

  // Helper: attach bridge to the current agent process and probe readiness
  const attachAgentBridge = () => {
    const proc = processManager!.getAgentProcess()
    if (!proc) return
    agentBridge.detach()
    agentBridge.attach(proc)
    // Probe readiness — mark 'ready' once agent responds to get_state
    agentBridge
      .getState()
      .then((state) => {
        processManager!.setState('agent', 'ready')
        // Sync active session ID from agent state so delete guard is accurate
        if (state.sessionFile) {
          sessionService.setActiveSessionId(state.sessionFile)
        }
      })
      .catch((err: Error) => {
        console.warn('[studio] agent readiness probe failed:', err.message)
        // Will be retried on next restart cycle
      })
  }

  // 6. Resolve initial project root from the app's current working directory.
  const initialProjectRoot = process.cwd()

  // 7. Spawn agent and attach — pass TAVILY_API_KEY if configured in settings
  const agentEnv: Record<string, string> = {}
  if (settings.tavilyApiKey) {
    agentEnv.TAVILY_API_KEY = settings.tavilyApiKey
  }
  processManager.spawnAgent(initialProjectRoot, agentEnv)
  attachAgentBridge()

  // Re-attach whenever the agent restarts (brief delay for new proc to be set)
  processManager.on('agent-restarting', () => {
    setTimeout(attachAgentBridge, 200)
  })

  // 8. PaneManager — create pane-0 with pane-aware event callbacks
  paneManager = new PaneManager()

  const orchestrator = new Orchestrator(agentBridge, {
    onChunk: (d) => pushEvent(mainWindow, 'event:agent-chunk', { paneId: 'pane-0', ...d }),
    onDone: (d) => pushEvent(mainWindow, 'event:agent-done', { paneId: 'pane-0', ...d }),
    onToolStart: (d) => pushEvent(mainWindow, 'event:tool-start', { paneId: 'pane-0', ...d }),
    onToolEnd: (d) => pushEvent(mainWindow, 'event:tool-end', { paneId: 'pane-0', ...d }),
    onTurnState: (d) => pushEvent(mainWindow, 'event:turn-state', { paneId: 'pane-0', ...d }),
    onError: (d) => pushEvent(mainWindow, 'event:error', { paneId: 'pane-0', ...d }),
    onThinkingStart: (d) => pushEvent(mainWindow, 'event:thinking-start', { paneId: 'pane-0', ...d }),
    onThinkingChunk: (d) => pushEvent(mainWindow, 'event:thinking-chunk', { paneId: 'pane-0', ...d }),
    onThinkingEnd: (d) => pushEvent(mainWindow, 'event:thinking-end', { paneId: 'pane-0', ...d }),
    onTextBlockStart: (d) => pushEvent(mainWindow, 'event:text-block-start', { paneId: 'pane-0', ...d }),
    onTextBlockEnd: (d) => pushEvent(mainWindow, 'event:text-block-end', { paneId: 'pane-0', ...d }),
  })

  paneManager.initPane0(processManager, agentBridge, orchestrator, sessionService, attachAgentBridge, initialProjectRoot)

  // Forward health events for pane-0 to renderer (with paneId)
  processManager.on('health', (states: Record<string, string>) => {
    pushEvent(mainWindow, 'event:health', { paneId: 'pane-0', states })
  })

  // 9. Terminal Manager — forwards pty output to renderer
  terminalManager = new TerminalManager((_id, data) => {
    pushEvent(mainWindow, 'event:terminal-data', { data })
  })

  // 10. Auth service + IPC handlers
  const authService = new AuthService()
  const fileService = new FileService()
  const gitService = new GitService()
  fileWatchService = new FileWatchService((channel, data) => {
    pushEvent(mainWindow, channel, data)
  })
  fileWatchService.watchPane('pane-0', initialProjectRoot)

  const restartAllAgents = async () => {
    for (const paneId of paneManager!.getPaneIds()) {
      await paneManager!.restartPaneAgent(paneId)
    }
  }

  // 10a. Skill system — load registry, create executor
  const skillRegistry = new SkillRegistry()
  await skillRegistry.load().catch((err: Error) => {
    console.warn('[studio] SkillRegistry load failed:', err.message)
  })
  const skillExecutor = new SkillExecutor(skillRegistry)

  registerIpcHandlers(
    paneManager,
    settingsService,
    terminalManager,
    authService,
    voiceService!,
    fileService,
    gitService,
    fileWatchService,
    restartAllAgents,
    () => mainWindow,
    undefined, // subagentManager
    skillRegistry,
    skillExecutor,
  )

  // 11. System tray
  // Minimal 16×16 transparent PNG as placeholder icon
  const iconDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/' +
    '9hAAAAFElEQVQ4T2NkYGD4z8BQDwAEgAF/AAAyxgF/AAAAAElFTkSuQmCC'
  const trayIcon = nativeImage.createFromDataURL(iconDataUrl)
  tray = new Tray(trayIcon)
  tray.setToolTip('Lucent Chat')

  const updateTray = () => {
    const states = processManager!.getStates()
    const agentState = states.agent ?? 'stopped'
    tray!.setContextMenu(buildTrayMenu(agentState))
    tray!.setToolTip(`Lucent Chat — agent: ${agentState}`)
  }

  updateTray()
  processManager.on('state-change', updateTray)

  // macOS: re-show window on dock/app click
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    } else {
      mainWindow?.show()
    }
  })
})

app.on('window-all-closed', () => {
  // On macOS, keep running in tray. On other platforms, quit.
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Graceful shutdown: SIGTERM all children, then exit
app.on('before-quit', (e) => {
  if (!app.isQuitting) {
    e.preventDefault()
    app.isQuitting = true
    void (async () => {
      try {
        terminalManager?.destroyAll()
        fileWatchService?.shutdown()
        // Stop voice sidecar first (non-blocking 3s grace)
        await voiceService?.stop()
        // Shutdown non-pane-0 panes first
        await paneManager?.shutdownAll()
        // Then shutdown pane-0's process manager
        await processManager?.shutdownAll()
      } finally {
        app.exit(0)
      }
    })()
  }
})
