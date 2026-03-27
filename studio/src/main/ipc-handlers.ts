/**
 * IPC Handlers — registers all Electron IPC channels between main and renderer.
 *
 * Commands: renderer → main (ipcMain.handle, invoked via ipcRenderer.invoke)
 * Events:   main → renderer (webContents.send, received via ipcRenderer.on)
 */

import { ipcMain, type BrowserWindow } from 'electron'
import type { Orchestrator } from './orchestrator.js'
import type { AgentBridge } from './agent-bridge.js'
import type { ProcessManager } from './process-manager.js'
import type { SessionService } from './session-service.js'
import type { SettingsService } from './settings-service.js'

// Re-export SessionFile for consumers that imported it from here
export type { SessionInfo as SessionFile } from './session-service.js'

// ============================================================================
// IPC registration
// ============================================================================

export function registerIpcHandlers(
  orchestrator: Orchestrator,
  agentBridge: AgentBridge,
  processManager: ProcessManager,
  getMainWindow: () => BrowserWindow | null,
  sessionService: SessionService,
  settingsService: SettingsService
): void {
  // --- Commands (renderer → main) ---

  ipcMain.handle('cmd:prompt', (_event, text: string) => {
    return orchestrator.submitTurn(text, 'text')
  })

  ipcMain.handle('cmd:abort', () => {
    return orchestrator.abortCurrentTurn()
  })

  ipcMain.handle('cmd:switch-model', (_event, provider: string, modelId: string) => {
    return agentBridge.setModel(provider, modelId)
  })

  ipcMain.handle('cmd:new-session', () => {
    return agentBridge.newSession()
  })

  ipcMain.handle('cmd:switch-session', (_event, sessionPath: string) => {
    return sessionService.switchSession(sessionPath, orchestrator)
  })

  ipcMain.handle('cmd:rename-session', (_event, name: string) => {
    return sessionService.renameSession(name)
  })

  ipcMain.handle('cmd:get-sessions', () => {
    return sessionService.listSessions()
  })

  ipcMain.handle('cmd:delete-session', (_event, path: string) => {
    return sessionService.deleteSession(path)
  })

  ipcMain.handle('cmd:get-messages', () => {
    return sessionService.getMessages()
  })

  ipcMain.handle('cmd:get-models', () => {
    return agentBridge.getAvailableModels()
  })

  ipcMain.handle('cmd:get-state', () => {
    return agentBridge.getState()
  })

  ipcMain.handle('cmd:get-health', () => {
    return processManager.getStates()
  })

  ipcMain.handle('cmd:get-settings', () => {
    return settingsService.get()
  })

  ipcMain.handle('cmd:set-settings', (_event, partial: Record<string, unknown>) => {
    settingsService.save(partial)
    return settingsService.get()
  })

  ipcMain.handle('cmd:open-external', async (_event, url: string) => {
    // Only allow http/https URLs to prevent security issues
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const { shell } = await import('electron')
      await shell.openExternal(url)
    }
  })

  void getMainWindow // used by pushEvent callers in index.ts
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
