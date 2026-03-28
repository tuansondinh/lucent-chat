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
import { WebBridgeServer } from './web-bridge-server.js'
import { TailscaleService } from './tailscale-service.js'
import { resolveRemotePaneRoot } from './pane-root-policy.js'
import { sanitizeSettingsForRenderer, validateSettingsPatch } from './settings-contract.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Suppress EPIPE errors on stdout/stderr — these happen when the parent terminal
// closes its end of the pipe (e.g. during app shutdown) while console.log is in-flight.
process.stdout.on('error', (err: NodeJS.ErrnoException) => { if (err.code !== 'EPIPE') throw err })
process.stderr.on('error', (err: NodeJS.ErrnoException) => { if (err.code !== 'EPIPE') throw err })

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let processManager: ProcessManager | null = null
let terminalManager: TerminalManager | null = null
let paneManager: PaneManager | null = null
let voiceService: VoiceService | null = null
let fileWatchService: FileWatchService | null = null
let webBridgeServer: WebBridgeServer | null = null
let tailscaleService: TailscaleService | null = null

/** Send an event to both the Electron renderer and all PWA WebSocket clients. */
function broadcast(channel: string, data: unknown): void {
  pushEvent(mainWindow, channel, data)
  webBridgeServer?.pushEvent(channel, data)
}

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
    // Shift+Tab (no Meta) — toggle active pane permission mode
    if (input.shift && input.code === 'Tab' && !input.meta && !input.control && !input.alt) {
      event.preventDefault()
      window.webContents.send('event:app-shortcut', { action: 'toggle-permission-mode' })
      return
    }

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
      // Only prewarm the sidecar if the user has opted in to voice features.
      // On first launch (voiceOptIn undefined), skip — the onboarding will ask.
      // Clicking the mic always starts on demand regardless of this flag.
      if (settings.voiceOptIn !== true) return
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

  // 7. Spawn agent and attach — pass TAVILY_API_KEY and permission mode if configured
  const agentEnv: Record<string, string> = {}
  if (settings.tavilyApiKey) {
    agentEnv.TAVILY_API_KEY = settings.tavilyApiKey
  }
  // Pass permission mode so the agent can register the stdio approval handler
  agentEnv.GSD_STUDIO_PERMISSION_MODE = (settings as any).permissionMode ?? 'danger-full-access'
  processManager.spawnAgent(initialProjectRoot, agentEnv)
  attachAgentBridge()

  // Re-attach whenever the agent restarts (brief delay for new proc to be set)
  processManager.on('agent-restarting', () => {
    setTimeout(attachAgentBridge, 200)
  })

  // 8. PaneManager — create pane-0 with pane-aware event callbacks
  paneManager = new PaneManager()

  const orchestrator = new Orchestrator(agentBridge, {
    onChunk: (d) => broadcast('event:agent-chunk', { paneId: 'pane-0', ...d }),
    onDone: (d) => broadcast('event:agent-done', { paneId: 'pane-0', ...d }),
    onToolStart: (d) => broadcast('event:tool-start', { paneId: 'pane-0', ...d }),
    onToolEnd: (d) => broadcast('event:tool-end', { paneId: 'pane-0', ...d }),
    onToolUpdate: (d) => broadcast('event:tool-update', { paneId: 'pane-0', ...d }),
    onTurnState: (d) => broadcast('event:turn-state', { paneId: 'pane-0', ...d }),
    onError: (d) => broadcast('event:error', { paneId: 'pane-0', ...d }),
    onThinkingStart: (d) => broadcast('event:thinking-start', { paneId: 'pane-0', ...d }),
    onThinkingChunk: (d) => broadcast('event:thinking-chunk', { paneId: 'pane-0', ...d }),
    onThinkingEnd: (d) => broadcast('event:thinking-end', { paneId: 'pane-0', ...d }),
    onTextBlockStart: (d) => broadcast('event:text-block-start', { paneId: 'pane-0', ...d }),
    onTextBlockEnd: (d) => broadcast('event:text-block-end', { paneId: 'pane-0', ...d }),
  })

  paneManager.initPane0(processManager, agentBridge, orchestrator, sessionService, attachAgentBridge, initialProjectRoot)

  // Forward health events for pane-0 to renderer and PWA clients (with paneId)
  processManager.on('health', (states: Record<string, string>) => {
    broadcast('event:health', { paneId: 'pane-0', states })
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
    broadcast,
  )

  // 11. WebBridgeServer — auto-start if enabled in settings
  tailscaleService = new TailscaleService()

  const startWebBridgeServer = async (): Promise<void> => {
    const currentSettings = settingsService.get()
    const port = currentSettings.remoteAccessPort ?? 8788
    let token = currentSettings.remoteAccessToken

    // Auto-generate a token if none exists
    if (!token) {
      const { webcrypto } = await import('node:crypto')
      const bytes = new Uint8Array(16)
      webcrypto.getRandomValues(bytes)
      token = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
      settingsService.save({ remoteAccessToken: token })
    }

    // dispatchCmd routes remote bridge commands to the local IPC handlers
    const dispatchCmd = async (name: string, args: unknown[]): Promise<unknown> => {
      // Route remote bridge commands to local services.
      // This mirrors a subset of the IPC handlers — only safe, non-terminal commands.
      const pane = () => paneManager?.getPane(args[0] as string)
      const root = () => pane()?.projectRoot
      switch (name) {
        // Settings
        case 'get-settings': return sanitizeSettingsForRenderer(settingsService.get())
        case 'set-settings': {
          const validated = validateSettingsPatch(args[0] as Record<string, unknown>)
          settingsService.save(validated)
          return sanitizeSettingsForRenderer(settingsService.get())
        }
        // Pane lifecycle
        case 'pane-list': return paneManager?.getPaneIds() ?? []
        case 'pane-create': { const p = await paneManager!.createPane(settingsService, broadcast); return { paneId: p.id } }
        case 'pane-close': return paneManager?.destroyPane(args[0] as string)
        // Agent
        case 'prompt': return pane()?.orchestrator.submitTurn(args[1] as string, 'text')
        case 'abort': return pane()?.orchestrator.abortCurrentTurn()
        case 'get-state': return pane()?.agentBridge.getState()
        case 'get-models': return pane()?.agentBridge.getAvailableModels()
        case 'switch-model': return pane()?.agentBridge.setModel(args[1] as string, args[2] as string)
        case 'new-session': return pane()?.agentBridge.newSession()
        case 'get-health': return pane()?.processManager.getStates() ?? {}
        // Sessions
        case 'get-sessions': return pane()?.sessionService.listSessions() ?? []
        case 'get-messages': return pane()?.sessionService.getMessages() ?? []
        case 'switch-session': return pane()?.sessionService.switchSession(args[1] as string, pane()!.orchestrator)
        case 'rename-session': return pane()?.sessionService.renameSession(args[1] as string)
        case 'delete-session': return pane()?.sessionService.deleteSession(args[1] as string)
        // Provider auth
        case 'get-provider-auth-status': return authService.getProviderStatuses()
        case 'get-provider-catalog': return authService.getProviderCatalog()
        case 'validate-and-save-provider-key': return authService.validateAndSaveApiKey(args[0] as string, args[1] as string)
        case 'remove-provider-key': return authService.removeApiKey(args[0] as string)
        // Pane info
        case 'get-pane-info': return { paneId: args[0], projectRoot: pane()?.projectRoot ?? process.cwd() }
        case 'set-pane-root': {
          const p2 = pane()
          if (!p2) throw new Error('Unknown pane')
          const resolvedPath = await resolveRemotePaneRoot(p2.accessRoot, args[1] as string)
          await paneManager!.restartPaneAgent(args[0] as string, resolvedPath)
          fileWatchService?.watchPane(args[0] as string, resolvedPath)
          fileWatchService?.notifyRootChanged(args[0] as string)
          return { projectRoot: resolvedPath }
        }
        // File system
        case 'fs-list-dir': return root() ? fileService.listDirectory(root()!, args[1] as string) : { entries: [], truncated: false }
        case 'fs-read-file': return root() ? fileService.readFile(root()!, args[1] as string) : null
        case 'fs-read-full': return root() ? fileService.readFileFull(root()!, args[1] as string) : null
        case 'fs-write-file': return root() ? fileService.writeFile(root()!, args[1] as string, args[2] as string) : null
        // Git
        case 'git-branch': return root() ? gitService.getBranch(root()!) : null
        case 'git-list-branches': return root() ? gitService.listBranches(root()!) : { current: null, branches: [] }
        case 'git-checkout-branch': return root() ? gitService.checkoutBranch(root()!, args[1] as string) : null
        case 'git-project-root': return root() ?? process.cwd()
        case 'git-modified-files': return root() ? gitService.getModifiedFiles(root()!) : []
        case 'git-changed-files': return root() ? gitService.getChangedFiles(root()!) : []
        case 'git-file-diff': return root() ? gitService.getFileDiff(root()!, args[1] as string) : null
        // Approval RPC
        case 'approval-respond': {
          const approvalPane = pane()
          if (approvalPane) {
            approvalPane.agentBridge.respondToApproval(args[1] as string, args[2] as boolean)
          }
          return null
        }
        // Voice sidecar
        case 'voice-probe': return voiceService?.probe() ?? { available: false, reason: 'Voice service unavailable' }
        case 'voice-start': return voiceService?.start()
        case 'voice-stop': return voiceService?.stop()
        case 'voice-status': return voiceService?.getStatus() ?? { available: false, state: 'unavailable', port: null, token: null }
        // No-ops for remote context
        case 'open-external': return null
        case 'set-window-title': return null
        case 'set-window-width': return null
        default: throw new Error(`Command '${name}' not supported via remote bridge`)
      }
    }

    const tailscaleOrigin = await tailscaleService!.getStatus().then((s) => {
      if (s.magicDnsHostname) return `https://${s.magicDnsHostname}`
      return undefined
    }).catch(() => undefined)

    const pwaDir = app.isPackaged
      ? join(process.resourcesPath, 'pwa')
      : join(__dirname, '../../dist/pwa')

    webBridgeServer = new WebBridgeServer({
      token,
      dispatchCmd,
      tailscaleOrigin,
      staticDir: pwaDir,
      getVoiceEndpoint: () => {
        const status = voiceService?.getStatus()
        if (status?.state === 'ready' && status.port && status.token) {
          return { port: status.port, token: status.token }
        }
        return null
      },
    })

    try {
      await webBridgeServer.start(port)
      console.log(`[studio] WebBridgeServer started on port ${port}`)

      // If tailscale serve is enabled, activate it
      if (currentSettings.tailscaleServeEnabled) {
        tailscaleService!.enableServe(port).catch((err: Error) => {
          console.warn('[studio] Tailscale serve failed:', err.message)
        })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[studio] WebBridgeServer failed to start:', msg)
      webBridgeServer = null
    }
  }

  // Start WebBridgeServer after a brief delay (after window loads)
  setTimeout(() => {
    startWebBridgeServer().catch((err: Error) => {
      console.warn('[studio] WebBridgeServer auto-start error:', err.message)
    })
  }, 1_500)

  // 13. System tray
  // Minimal 16×16 transparent PNG as placeholder icon
  const iconDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/' +
    '9hAAAAFElEQVQ4T2NkYGD4z8BQDwAEgAF/AAAyxgF/AAAAAElFTkSuQmCC'
  const trayIcon = nativeImage.createFromDataURL(iconDataUrl)
  tray = new Tray(trayIcon)
  tray.setToolTip('Lucent Code')

  const updateTray = () => {
    const states = processManager!.getStates()
    const agentState = states.agent ?? 'stopped'
    tray!.setContextMenu(buildTrayMenu(agentState))
    tray!.setToolTip(`Lucent Code — agent: ${agentState}`)
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
        // Stop WebBridgeServer
        await webBridgeServer?.stop()
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
