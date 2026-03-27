/**
 * IPC Handlers — registers all Electron IPC channels between main and renderer.
 *
 * Commands: renderer → main (ipcMain.handle, invoked via ipcRenderer.invoke)
 * Events:   main → renderer (webContents.send, received via ipcRenderer.on)
 */

import { ipcMain, type BrowserWindow } from 'electron'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Orchestrator } from './orchestrator.js'
import type { AgentBridge } from './agent-bridge.js'
import type { ProcessManager } from './process-manager.js'

// ============================================================================
// Session file listing
// ============================================================================

export interface SessionFile {
  path: string
  name: string
  modified: number
}

async function listSessions(): Promise<SessionFile[]> {
  const sessionsBase = join(homedir(), '.pi', 'agent', 'sessions')
  const results: SessionFile[] = []

  async function walk(dir: string): Promise<void> {
    let entries: Awaited<ReturnType<typeof readdir>>
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const info = await stat(fullPath)
          // Use the filename stem as display name (may be overridden by session name)
          const name = entry.name.replace(/\.json$/, '')
          results.push({ path: fullPath, name, modified: info.mtimeMs })
        } catch {
          // Skip files we can't stat
        }
      }
    }
  }

  await walk(sessionsBase)
  // Sort newest first
  results.sort((a, b) => b.modified - a.modified)
  return results
}

// ============================================================================
// IPC registration
// ============================================================================

export function registerIpcHandlers(
  orchestrator: Orchestrator,
  agentBridge: AgentBridge,
  processManager: ProcessManager,
  getMainWindow: () => BrowserWindow | null
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
    return agentBridge.switchSession(sessionPath)
  })

  ipcMain.handle('cmd:rename-session', (_event, name: string) => {
    return agentBridge.setSessionName(name)
  })

  ipcMain.handle('cmd:get-sessions', () => {
    return listSessions()
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
