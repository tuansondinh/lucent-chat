import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ProcessManager } from './process-manager.js'
import { AgentBridge } from './agent-bridge.js'
import { Orchestrator } from './orchestrator.js'
import { PaneManager } from './pane-manager.js'
import { registerIpcHandlers, pushEvent } from './ipc-handlers.js'
import { SessionService } from './session-service.js'
import { SettingsService } from './settings-service.js'
import { TerminalManager } from './terminal-manager.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let processManager: ProcessManager | null = null
let terminalManager: TerminalManager | null = null
let paneManager: PaneManager | null = null

// Extend Electron App type with isQuitting flag
declare module 'electron' {
  interface App {
    isQuitting: boolean
  }
}
app.isQuitting = false

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
    titleBarOverlay: process.platform === 'darwin' ? { height: 52 } : undefined,
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

  // 6. Spawn agent and attach — pass TAVILY_API_KEY if configured in settings
  const agentEnv: Record<string, string> = {}
  if (settings.tavilyApiKey) {
    agentEnv.TAVILY_API_KEY = settings.tavilyApiKey
  }
  processManager.spawnAgent(agentEnv)
  attachAgentBridge()

  // Re-attach whenever the agent restarts (brief delay for new proc to be set)
  processManager.on('agent-restarting', () => {
    setTimeout(attachAgentBridge, 200)
  })

  // 7. PaneManager — create pane-0 with pane-aware event callbacks
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

  paneManager.initPane0(processManager, agentBridge, orchestrator, sessionService)

  // Forward health events for pane-0 to renderer (with paneId)
  processManager.on('health', (states: Record<string, string>) => {
    pushEvent(mainWindow, 'event:health', { paneId: 'pane-0', states })
  })

  // 8. Terminal Manager — forwards pty output to renderer
  terminalManager = new TerminalManager((_id, data) => {
    pushEvent(mainWindow, 'event:terminal-data', { data })
  })

  // 9. IPC handlers
  registerIpcHandlers(
    paneManager,
    settingsService,
    terminalManager,
    () => mainWindow
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
