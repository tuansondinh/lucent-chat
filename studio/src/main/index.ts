import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ProcessManager } from './process-manager.js'
import { AgentBridge } from './agent-bridge.js'
import { Orchestrator } from './orchestrator.js'
import { registerIpcHandlers, pushEvent } from './ipc-handlers.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let processManager: ProcessManager | null = null

// Extend Electron App type with isQuitting flag
declare module 'electron' {
  interface App {
    isQuitting: boolean
  }
}
app.isQuitting = false

function createWindow(): BrowserWindow {
  const preload = join(__dirname, '../preload/index.mjs')

  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0a0a0a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 16 } : undefined,
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
  // 1. Create window
  mainWindow = createWindow()

  // 2. Process Manager
  processManager = new ProcessManager()

  // 3. Agent Bridge
  const agentBridge = new AgentBridge()

  // Helper: attach bridge to the current agent process and probe readiness
  const attachAgentBridge = () => {
    const proc = processManager!.getAgentProcess()
    if (!proc) return
    agentBridge.detach()
    agentBridge.attach(proc)
    // Probe readiness — mark 'ready' once agent responds to get_state
    agentBridge
      .getState()
      .then(() => {
        processManager!.setState('agent', 'ready')
      })
      .catch((err: Error) => {
        console.warn('[studio] agent readiness probe failed:', err.message)
        // Will be retried on next restart cycle
      })
  }

  // 4. Spawn agent and attach
  processManager.spawnAgent()
  attachAgentBridge()

  // Re-attach whenever the agent restarts (brief delay for new proc to be set)
  processManager.on('agent-restarting', () => {
    setTimeout(attachAgentBridge, 200)
  })

  // 5. Orchestrator
  const orchestrator = new Orchestrator(agentBridge, {
    onChunk: (d) => pushEvent(mainWindow, 'event:agent-chunk', d),
    onDone: (d) => pushEvent(mainWindow, 'event:agent-done', d),
    onToolStart: (d) => pushEvent(mainWindow, 'event:tool-start', d),
    onToolEnd: (d) => pushEvent(mainWindow, 'event:tool-end', d),
    onTurnState: (d) => pushEvent(mainWindow, 'event:turn-state', d),
    onError: (d) => pushEvent(mainWindow, 'event:error', d),
  })

  // 6. IPC handlers
  registerIpcHandlers(orchestrator, agentBridge, processManager, () => mainWindow)

  // 7. Forward health events to renderer
  processManager.on('health', (states: Record<string, string>) => {
    pushEvent(mainWindow, 'event:health', states)
  })

  // 8. System tray
  // Minimal 16×16 transparent PNG as placeholder icon
  const iconDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/' +
    '9hAAAAFElEQVQ4T2NkYGD4z8BQDwAEgAF/AAAyxgF/AAAAAElFTkSuQmCC'
  const trayIcon = nativeImage.createFromDataURL(iconDataUrl)
  tray = new Tray(trayIcon)
  tray.setToolTip('GSD Studio')

  const updateTray = () => {
    const states = processManager!.getStates()
    const agentState = states.agent ?? 'stopped'
    tray!.setContextMenu(buildTrayMenu(agentState))
    tray!.setToolTip(`GSD Studio — agent: ${agentState}`)
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
        await processManager?.shutdownAll()
      } finally {
        app.exit(0)
      }
    })()
  }
})
