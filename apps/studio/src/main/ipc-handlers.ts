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
import type { AppSettings, SettingsService } from './settings-service.js'
import type { TerminalManager } from './terminal-manager.js'
import type { AuthService } from './auth-service.js'
import type { VoiceService } from './voice-service.js'
import type { FileService } from './file-service.js'
import type { GitService } from './git-service.js'
import type { FileWatchService } from './file-watch-service.js'
import type { SkillRegistry } from './skill-registry.js'
import type { SkillExecutor } from './skill-executor.js'

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
  skillRegistry?: SkillRegistry,
  skillExecutor?: SkillExecutor,
): void {
  const approvedPaneRoots = new Set<string>()

  for (const paneId of paneManager.getPaneIds()) {
    const root = paneManager.getPane(paneId)?.projectRoot
    if (root) approvedPaneRoots.add(root)
  }

  // --------------------------------------------------------------------------
  // Pane-specific commands — all accept paneId as first arg
  // --------------------------------------------------------------------------

  ipcMain.handle('cmd:prompt', async (_event, paneId: string, text: string, options?: { streamingBehavior?: 'steer' | 'followUp' }) => {
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

    return pane.orchestrator.submitTurn(text, 'text', options)
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
    return sanitizeSettingsForRenderer(settingsService.get())
  })

  ipcMain.handle('cmd:set-settings', (_event, partial: Record<string, unknown>) => {
    const validated = validateSettingsPatch(partial)
    settingsService.save(validated)
    return sanitizeSettingsForRenderer(settingsService.get())
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
      (url) => openExternalHttpUrl(shell.openExternal, url),
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
    const { shell } = await import('electron')
    await openExternalHttpUrl(shell.openExternal, url)
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
    const resolvedPath = await fs.realpath(absolutePath)
    const stat = await fs.stat(resolvedPath)
    if (!stat.isDirectory()) throw new Error('Not a directory')
    const currentRoot = await fs.realpath(pane.projectRoot).catch(() => pane.projectRoot)
    if (!approvedPaneRoots.has(resolvedPath) && currentRoot !== resolvedPath) {
      throw new Error('Pane root must be selected through the folder picker first')
    }
    await paneManager.restartPaneAgent(paneId, resolvedPath)
    fileWatchService.watchPane(paneId, resolvedPath)
    fileWatchService.notifyRootChanged(paneId)
    return { projectRoot: resolvedPath }
  })

  ipcMain.handle('cmd:pick-folder', async () => {
    const win = getMainWindow()
    if (!win) return null
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    if (result.canceled) return null
    const selected = result.filePaths[0] ?? null
    if (!selected) return null
    const resolved = await fs.realpath(selected)
    approvedPaneRoots.add(resolved)
    return resolved
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
  // Skill commands — not pane-specific
  // --------------------------------------------------------------------------

  ipcMain.handle('cmd:skill-list', async () => {
    if (!skillRegistry) return []
    const skills = skillRegistry.listAll()
    return skills.map((s) => ({
      name: s.name,
      description: s.description,
      trigger: s.trigger,
      stepCount: s.steps.length,
    }))
  })

  ipcMain.handle('cmd:skill-execute', async (_event, paneId: string, trigger: string, input: string) => {
    if (!skillRegistry || !skillExecutor) throw new Error('Skill system not initialized')
    if (!skillRegistry.isLoaded) throw new Error('SkillRegistry not loaded')

    const pane = paneManager.getPane(paneId)
    if (!pane) throw new Error(`Unknown pane: ${paneId}`)

    // Step runner: delegates to pane orchestrator
    const runStep = async (step: import('./skill-registry.js').SkillStep, context: string): Promise<string> => {
      const prompt = context ? `${step.prompt}\n\nContext:\n${context}` : step.prompt
      return new Promise<string>((resolve) => {
        const turnId = pane.orchestrator.submitTurn(prompt, 'text')
        // Collect agent output for chaining
        let accumulated = ''
        const unsub1 = pane.orchestrator.on('chunk', (data: { turn_id: string; text: string }) => {
          if (data.turn_id === turnId) accumulated += data.text
        })
        const unsub2 = pane.orchestrator.once('done', (data: { turn_id: string }) => {
          if (data.turn_id === turnId) {
            pane.orchestrator.removeListener('chunk', unsub1 as any)
            resolve(accumulated)
          }
        })
        void unsub2
      })
    }

    const skillId = await skillExecutor.execute(trigger, input, runStep)
    return skillId
  })

  ipcMain.handle('cmd:skill-abort', (_event, skillId: string) => {
    skillExecutor?.abort(skillId)
  })

  // Forward skill events to renderer
  if (skillExecutor) {
    skillExecutor.on('skill-progress', (data) => {
      const win = getMainWindow()
      pushEvent(win, 'event:skill-progress', data)
    })
    skillExecutor.on('skill-complete', (data) => {
      const win = getMainWindow()
      pushEvent(win, 'event:skill-complete', data)
    })
  }

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

type RendererSettings = Omit<AppSettings, 'tavilyApiKey'> & { hasTavilyKey: boolean }

function sanitizeSettingsForRenderer(settings: AppSettings): RendererSettings {
  const { tavilyApiKey, ...rest } = settings
  return {
    ...rest,
    hasTavilyKey: typeof tavilyApiKey === 'string' && tavilyApiKey.length > 0,
  }
}

function validateSettingsPatch(partial: Record<string, unknown>): Partial<AppSettings> {
  const validated: Partial<AppSettings> = {}

  if ('defaultModel' in partial) {
    const value = partial.defaultModel
    if (
      value === undefined
      || (
        typeof value === 'object'
        && typeof (value as { provider?: unknown }).provider === 'string'
        && typeof (value as { modelId?: unknown }).modelId === 'string'
      )
    ) {
      validated.defaultModel = value as AppSettings['defaultModel']
    } else {
      throw new Error('Invalid defaultModel setting')
    }
  }

  if ('theme' in partial) {
    if (partial.theme !== 'dark') throw new Error('Invalid theme setting')
    validated.theme = 'dark'
  }

  if ('fontSize' in partial) {
    if (typeof partial.fontSize !== 'number' || !Number.isFinite(partial.fontSize)) {
      throw new Error('Invalid fontSize setting')
    }
    validated.fontSize = partial.fontSize
  }

  if ('tavilyApiKey' in partial) {
    if (typeof partial.tavilyApiKey !== 'string') {
      throw new Error('Invalid tavilyApiKey setting')
    }
    validated.tavilyApiKey = partial.tavilyApiKey
  }

  if ('sidebarCollapsed' in partial) {
    if (typeof partial.sidebarCollapsed !== 'boolean') {
      throw new Error('Invalid sidebarCollapsed setting')
    }
    validated.sidebarCollapsed = partial.sidebarCollapsed
  }

  if ('windowBounds' in partial) {
    const value = partial.windowBounds
    if (
      value === undefined
      || (
        value !== null
        && typeof value === 'object'
        && ['x', 'y', 'width', 'height'].every((key) => typeof (value as Record<string, unknown>)[key] === 'number')
      )
    ) {
      validated.windowBounds = value as AppSettings['windowBounds']
    } else {
      throw new Error('Invalid windowBounds setting')
    }
  }

  if ('onboardingComplete' in partial) {
    if (typeof partial.onboardingComplete !== 'boolean') {
      throw new Error('Invalid onboardingComplete setting')
    }
    validated.onboardingComplete = partial.onboardingComplete
  }

  if ('voicePttShortcut' in partial) {
    const value = partial.voicePttShortcut
    if (value !== 'space' && value !== 'alt+space' && value !== 'cmd+shift+space') {
      throw new Error('Invalid voicePttShortcut setting')
    }
    validated.voicePttShortcut = value
  }

  if ('voiceAudioEnabled' in partial) {
    if (typeof partial.voiceAudioEnabled !== 'boolean') {
      throw new Error('Invalid voiceAudioEnabled setting')
    }
    validated.voiceAudioEnabled = partial.voiceAudioEnabled
  }

  if ('voiceModelsDownloaded' in partial) {
    if (typeof partial.voiceModelsDownloaded !== 'boolean') {
      throw new Error('Invalid voiceModelsDownloaded setting')
    }
    validated.voiceModelsDownloaded = partial.voiceModelsDownloaded
  }

  const unknownKeys = Object.keys(partial).filter((key) => !(key in validated))
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown settings key: ${unknownKeys[0]}`)
  }

  return validated
}

function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

async function openExternalHttpUrl(
  openExternal: (url: string) => Promise<void>,
  url: string,
): Promise<void> {
  if (!isSafeExternalUrl(url)) {
    throw new Error('Only http:// and https:// URLs are allowed')
  }
  await openExternal(url)
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
