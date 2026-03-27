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
import type { PaneManager } from './pane-manager.js'
import type { SettingsService } from './settings-service.js'
import type { TerminalManager } from './terminal-manager.js'
import type { AuthService } from './auth-service.js'
import type { VoiceService } from './voice-service.js'

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
  restartAllAgents: () => Promise<void>,
  getMainWindow: () => BrowserWindow | null,
): void {

  // --------------------------------------------------------------------------
  // Pane-specific commands — all accept paneId as first arg
  // --------------------------------------------------------------------------

  ipcMain.handle('cmd:prompt', (_event, paneId: string, text: string) => {
    const pane = paneManager.getPane(paneId)
    if (!pane) throw new Error(`Unknown pane: ${paneId}`)
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
    return { paneId: pane.id }
  })

  ipcMain.handle('cmd:pane-close', async (_event, paneId: string) => {
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
