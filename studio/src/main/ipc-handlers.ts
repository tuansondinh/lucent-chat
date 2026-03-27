/**
 * IPC Handlers — registers all Electron IPC channels between main and renderer.
 *
 * All pane-specific commands now accept paneId as the first argument so that
 * each pane's agent process, bridge, and orchestrator are addressed separately.
 *
 * Commands: renderer → main (ipcMain.handle, invoked via ipcRenderer.invoke)
 * Events:   main → renderer (webContents.send, received via ipcRenderer.on)
 */

import { ipcMain, type BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import type { PaneManager } from './pane-manager.js'
import type { SettingsService } from './settings-service.js'
import type { TerminalManager } from './terminal-manager.js'
import type { AuthService } from './auth-service.js'
import type { VoiceService } from './voice-service.js'
import type { FileService } from './file-service.js'
import type { GitService } from './git-service.js'
import type { FileWatchService } from './file-watch-service.js'

// Re-export SessionFile for consumers that imported it from here
export type { SessionInfo as SessionFile } from './session-service.js'

// ============================================================================
// IPC registration
// ============================================================================

export function registerIpcHandlers(
  paneManager: PaneManager,
  settingsService: SettingsService,
  terminalManager: TerminalManager,
  authService: AuthService,
  voiceService: VoiceService,
  fileService: FileService,
  gitService: GitService,
  fileWatchService: FileWatchService,
  restartAllAgents: () => Promise<void>,
  getMainWindow: () => BrowserWindow | null,
): void {

  // --------------------------------------------------------------------------
  // Pane-specific commands — all accept paneId as first arg
  // --------------------------------------------------------------------------

  ipcMain.handle('cmd:prompt', async (_event, paneId: string, text: string) => {
    const pane = paneManager.getPane(paneId)
    if (!pane) throw new Error(`Unknown pane: ${paneId}`)

    const statuses = authService.getProviderStatuses()

    // Broad check: no provider configured at all
    if (!statuses.some((s) => s.configured)) {
      throw new Error('No AI provider configured — add an API key or sign in via Settings (⌘,).')
    }

    // Specific check: is the active model's provider configured?
    // Query agent state with a short timeout so we don't delay the prompt.
    try {
      const agentState = await Promise.race([
        pane.agentBridge.getState(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2_000)),
      ])
      if (agentState.model) {
        const activeProvider = statuses.find((s) => s.id === agentState.model!.provider)
        if (activeProvider && !activeProvider.configured) {
          throw new Error(
            `${activeProvider.label} is not configured — add an API key or sign in via Settings (⌘,).`
          )
        }
      }
    } catch (err) {
      const msg = (err as Error).message
      // Re-throw credential errors; swallow timeout/fetch failures and let the
      // 30-second first-activity timeout in the orchestrator handle them.
      if (msg.includes('is not configured')) throw err
    }

    return pane.orchestrator.submitTurn(text, 'text')
  })

  ipcMain.handle('cmd:abort', (_event, paneId: string) => {
    return paneManager.getPane(paneId)?.orchestrator.abortCurrentTurn()
  })

  ipcMain.handle('cmd:switch-model', (_event, paneId: string, provider: string, modelId: string) => {
    return paneManager.getPane(paneId)?.agentBridge.setModel(provider, modelId)
  })

  ipcMain.handle('cmd:new-session', async (_event, paneId: string) => {
    const pane = paneManager.getPane(paneId)
    if (!pane) throw new Error(`Unknown pane: ${paneId}`)
    const result = await pane.agentBridge.newSession()
    if (!result.cancelled) {
      pane.agentBridge.getState().then((state) => {
        if (state.sessionFile) pane.sessionService.setActiveSessionId(state.sessionFile)
      }).catch(() => {})
    }
    return result
  })

  ipcMain.handle('cmd:switch-session', (_event, paneId: string, sessionPath: string) => {
    const pane = paneManager.getPane(paneId)
    if (!pane) throw new Error(`Unknown pane: ${paneId}`)
    return pane.sessionService.switchSession(sessionPath, pane.orchestrator)
  })

  ipcMain.handle('cmd:rename-session', (_event, paneId: string, name: string) => {
    return paneManager.getPane(paneId)?.sessionService.renameSession(name)
  })

  ipcMain.handle('cmd:get-sessions', (_event, paneId: string) => {
    return paneManager.getPane(paneId)?.sessionService.listSessions()
  })

  ipcMain.handle('cmd:delete-session', (_event, paneId: string, path: string) => {
    return paneManager.getPane(paneId)?.sessionService.deleteSession(path)
  })

  ipcMain.handle('cmd:get-messages', (_event, paneId: string) => {
    return paneManager.getPane(paneId)?.sessionService.getMessages()
  })

  ipcMain.handle('cmd:get-models', (_event, paneId: string) => {
    return paneManager.getPane(paneId)?.agentBridge.getAvailableModels()
  })

  ipcMain.handle('cmd:get-state', (_event, paneId: string) => {
    return paneManager.getPane(paneId)?.agentBridge.getState()
  })

  ipcMain.handle('cmd:get-health', (_event, paneId: string) => {
    return paneManager.getPane(paneId)?.processManager.getStates()
  })

  // --------------------------------------------------------------------------
  // Pane lifecycle
  // --------------------------------------------------------------------------

  ipcMain.handle('cmd:pane-create', async () => {
    const win = getMainWindow()
    const pane = await paneManager.createPane(settingsService, (channel, data) => {
      if (win && !win.isDestroyed()) win.webContents.send(channel, data)
    })
    fileWatchService.watchPane(pane.id, pane.projectRoot)
    return { paneId: pane.id }
  })

  ipcMain.handle('cmd:pane-close', async (_event, paneId: string) => {
    fileWatchService.unwatchPane(paneId)
    await paneManager.destroyPane(paneId)
  })

  ipcMain.handle('cmd:pane-list', () => {
    return paneManager.getPaneIds()
  })

  // --------------------------------------------------------------------------
  // Settings — not pane-specific
  // --------------------------------------------------------------------------

  ipcMain.handle('cmd:get-settings', () => {
    return settingsService.get()
  })

  ipcMain.handle('cmd:set-settings', (_event, partial: Record<string, unknown>) => {
    settingsService.save(partial)
    return settingsService.get()
  })

  // --------------------------------------------------------------------------
  // Provider auth — not pane-specific
  // --------------------------------------------------------------------------

  ipcMain.handle('cmd:validate-and-save-provider-key', async (_event, providerId: string, apiKey: string) => {
    const result = await authService.validateAndSaveApiKey(providerId, apiKey)
    if (result.ok) {
      void restartAllAgents()
    }
    return result
  })

  ipcMain.handle('cmd:remove-provider-key', (_event, providerId: string) => {
    const statuses = authService.removeApiKey(providerId)
    void restartAllAgents()
    return statuses
  })

  ipcMain.handle('cmd:get-provider-auth-status', () => {
    return authService.getProviderStatuses()
  })

  ipcMain.handle('cmd:get-provider-catalog', () => {
    return authService.getProviderCatalog()
  })

  ipcMain.handle('cmd:oauth-start', async (_event, providerId: string) => {
    const win = getMainWindow()
    const { shell } = await import('electron')
    return authService.startOAuthLogin(
      providerId,
      (channel, data) => {
        if (win && !win.isDestroyed()) win.webContents.send(channel, data)
      },
      (url) => shell.openExternal(url),
    )
  })

  ipcMain.handle('cmd:oauth-submit-code', (_event, providerId: string, code: string) => {
    authService.submitOAuthCode(providerId, code)
  })

  ipcMain.handle('cmd:oauth-cancel', (_event, providerId: string) => {
    authService.cancelOAuthFlow(providerId)
  })

  // --------------------------------------------------------------------------
  // Window / shell — not pane-specific
  // --------------------------------------------------------------------------

  ipcMain.handle('cmd:set-window-title', (_event, title: string) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.setTitle(title)
    }
  })

  ipcMain.handle('cmd:open-external', async (_event, url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const { shell } = await import('electron')
      await shell.openExternal(url)
    }
  })

  // --------------------------------------------------------------------------
  // File system — pane-scoped (uses pane's projectRoot for path validation)
  // --------------------------------------------------------------------------

  ipcMain.handle('cmd:fs-list-dir', async (_e, paneId: string, relativePath: string) => {
    const root = paneManager.getPane(paneId)?.projectRoot
    if (!root) throw new Error(`Unknown pane: ${paneId}`)
    return fileService.listDirectory(root, relativePath)
  })

  ipcMain.handle('cmd:fs-read-file', async (_e, paneId: string, relativePath: string) => {
    const root = paneManager.getPane(paneId)?.projectRoot
    if (!root) throw new Error(`Unknown pane: ${paneId}`)
    return fileService.readFile(root, relativePath)
  })

  // --------------------------------------------------------------------------
  // Git — pane-scoped
  // --------------------------------------------------------------------------

  ipcMain.handle('cmd:git-branch', async (_e, paneId: string) => {
    const root = paneManager.getPane(paneId)?.projectRoot
    if (!root) return null
    return gitService.getBranch(root)
  })

  ipcMain.handle('cmd:git-list-branches', async (_e, paneId: string) => {
    const root = paneManager.getPane(paneId)?.projectRoot
    if (!root) {
      return { current: null, branches: [] }
    }
    return gitService.listBranches(root)
  })

  ipcMain.handle('cmd:git-checkout-branch', async (_e, paneId: string, branch: string) => {
    const root = paneManager.getPane(paneId)?.projectRoot
    if (!root) return null

    const nextBranch = await gitService.checkoutBranch(root, branch)
    if (nextBranch) {
      fileWatchService.notifyRootChanged(paneId)
    }
    return nextBranch
  })

  ipcMain.handle('cmd:git-project-root', (_e, paneId: string) => {
    const root = paneManager.getPane(paneId)?.projectRoot ?? process.cwd()
    return root
  })

  ipcMain.handle('cmd:git-modified-files', async (_e, paneId: string) => {
    const root = paneManager.getPane(paneId)?.projectRoot
    if (!root) return []
    return gitService.getModifiedFiles(root)
  })

  ipcMain.handle('cmd:git-changed-files', async (_e, paneId: string) => {
    const root = paneManager.getPane(paneId)?.projectRoot
    if (!root) return []
    return gitService.getChangedFiles(root)
  })

  ipcMain.handle('cmd:git-file-diff', async (_e, paneId: string, relativePath: string) => {
    const root = paneManager.getPane(paneId)?.projectRoot
    if (!root) return null
    return gitService.getFileDiff(root, relativePath)
  })

  ipcMain.handle('cmd:get-pane-info', (_e, paneId: string) => {
    const pane = paneManager.getPane(paneId)
    return { paneId, projectRoot: pane?.projectRoot ?? process.cwd() }
  })

  ipcMain.handle('cmd:set-pane-root', async (_e, paneId: string, absolutePath: string) => {
    const pane = paneManager.getPane(paneId)
    if (!pane) throw new Error(`Unknown pane: ${paneId}`)
    // Validate it's a real directory
    const stat = await fs.stat(absolutePath)
    if (!stat.isDirectory()) throw new Error('Not a directory')
    await paneManager.restartPaneAgent(paneId, absolutePath)
    fileWatchService.watchPane(paneId, absolutePath)
    fileWatchService.notifyRootChanged(paneId)
    return { projectRoot: absolutePath }
  })

  ipcMain.handle('cmd:pick-folder', async () => {
    const win = getMainWindow()
    if (!win) return null
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  // --------------------------------------------------------------------------
  // Terminal — not pane-specific
  // --------------------------------------------------------------------------

  ipcMain.handle('cmd:terminal-create', () => {
    terminalManager.create('main')
  })

  ipcMain.handle('cmd:terminal-input', (_event, data: { data: string }) => {
    terminalManager.write('main', data.data)
  })

  ipcMain.handle('cmd:terminal-resize', (_event, data: { cols: number; rows: number }) => {
    terminalManager.resize('main', data.cols, data.rows)
  })

  ipcMain.handle('cmd:terminal-destroy', () => {
    terminalManager.destroy('main')
  })

  // --------------------------------------------------------------------------
  // Voice — not pane-specific (global sidecar)
  // --------------------------------------------------------------------------

  ipcMain.handle('cmd:voice-probe', async () => {
    return voiceService.probe()
  })

  ipcMain.handle('cmd:voice-start', async () => {
    return voiceService.start()
  })

  ipcMain.handle('cmd:voice-stop', async () => {
    return voiceService.stop()
  })

  ipcMain.handle('cmd:voice-status', () => {
    return voiceService.getStatus()
  })

  // Forward voice status events to renderer
  voiceService.on('status', (status) => {
    const win = getMainWindow()
    pushEvent(win, 'event:voice-status', status)
  })

  void getMainWindow // referenced by pushEvent callers in index.ts
}

// ============================================================================
// Event push helper
// ============================================================================

/** Push an event from main process to the renderer window. */
export function pushEvent(win: BrowserWindow | null, channel: string, data: unknown): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data)
  }
}
