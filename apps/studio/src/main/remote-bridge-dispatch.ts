import { getDisabledVoiceStatus, VOICE_SERVICE_DISABLED_REASON, type VoiceService } from './voice-service.js'
import { resolveRemotePaneRoot } from './pane-root-policy.js'
import { sanitizeSettingsForRenderer, validateSettingsPatch } from './settings-contract.js'
import type { PaneManager } from './pane-manager.js'
import type { SettingsService } from './settings-service.js'
import type { AuthService } from './auth-service.js'
import type { FileService } from './file-service.js'
import type { GitService } from './git-service.js'
import type { FileWatchService } from './file-watch-service.js'
import type { ClassifierService } from './classifier-service.js'

interface RemoteBridgeDispatchOptions {
  settingsService: SettingsService
  paneManager: PaneManager
  voiceService: VoiceService
  authService: AuthService
  fileService: FileService
  gitService: GitService
  broadcast: (channel: string, data: unknown) => void
  fileWatchService?: FileWatchService | null
  classifierService?: ClassifierService
  restartAllAgents?: () => Promise<void>
}

export function createRemoteBridgeDispatcher({
  settingsService,
  paneManager,
  voiceService,
  authService,
  fileService,
  gitService,
  broadcast,
  fileWatchService,
  classifierService,
  restartAllAgents,
}: RemoteBridgeDispatchOptions): (name: string, args: unknown[]) => Promise<unknown> {
  const isVoiceServiceEnabled = (): boolean => settingsService.get().voiceServiceEnabled !== false
  const pane = (args: unknown[]) => paneManager.getPane(args[0] as string)
  const root = (args: unknown[]) => pane(args)?.projectRoot

  return async (name: string, args: unknown[]): Promise<unknown> => {
    switch (name) {
      case 'get-settings':
        return sanitizeSettingsForRenderer(settingsService.get())

      case 'set-settings': {
        const validated = validateSettingsPatch(args[0] as Record<string, unknown>)
        settingsService.save(validated)
        if ('voiceServiceEnabled' in validated) {
          if (validated.voiceServiceEnabled === false) {
            await voiceService.stop()
            broadcast('event:voice-status', getDisabledVoiceStatus())
          } else {
            await voiceService.probe()
          }
        }
        return sanitizeSettingsForRenderer(settingsService.get())
      }

      case 'pane-list':
        return paneManager.getPaneIds()

      case 'pane-create': {
        // createPane is now synchronous — pane registered immediately, agent
        // init runs in background so the UI can update without waiting.
        const createdPane = paneManager.createPane(
          settingsService,
          broadcast,
          args[0] as string | undefined,
        )
        fileWatchService?.watchPane(createdPane.id, createdPane.projectRoot)
        return { paneId: createdPane.id }
      }

      case 'pane-close':
        fileWatchService?.unwatchPane(args[0] as string)
        return paneManager.destroyPane(args[0] as string)

      case 'prompt':
        return pane(args)?.orchestrator.submitTurn(args[1] as string, 'text')

      case 'abort':
        return pane(args)?.orchestrator.abortCurrentTurn()

      case 'get-state':
        return pane(args)?.agentBridge.getState()

      case 'get-models':
        return pane(args)?.agentBridge.getAvailableModels()

      case 'switch-model':
        return pane(args)?.agentBridge.setModel(args[1] as string, args[2] as string)

      case 'new-session': {
        const targetPane = pane(args)
        if (!targetPane) return null
        const result = await targetPane.agentBridge.newSession()
        if (!result.cancelled) {
          try {
            const state = await targetPane.agentBridge.getState()
            if (state.sessionFile) {
              targetPane.sessionService.setActiveSessionId(state.sessionFile)
              targetPane.sessionService.setProjectSession(targetPane.projectRoot, state.sessionFile, {
                sessionName: typeof state.sessionName === 'string' && state.sessionName.length > 0
                  ? state.sessionName
                  : null,
              })
            }
          } catch {
            // best-effort only
          }
        }
        return result
      }

      case 'compact':
        return pane(args)?.agentBridge.compact(args[1] as string | undefined)

      case 'get-health':
        return pane(args)?.processManager.getStates() ?? {}

      case 'get-sessions':
        return pane(args)?.sessionService.listSessions() ?? []

      case 'get-messages':
        return pane(args)?.sessionService.getMessages() ?? []

      case 'switch-session':
        return pane(args)?.sessionService.switchSession(args[1] as string, pane(args)!.orchestrator)

      case 'rename-session':
        return pane(args)?.sessionService.renameSession(args[1] as string)

      case 'delete-session':
        return pane(args)?.sessionService.deleteSession(args[1] as string)

      case 'get-provider-auth-status':
        return authService.getProviderStatuses()

      case 'get-provider-catalog':
        return authService.getProviderCatalog()

      case 'validate-and-save-provider-key': {
        const result = await authService.validateAndSaveApiKey(args[0] as string, args[1] as string)
        if (result.ok) {
          await restartAllAgents?.()
        }
        return result
      }

      case 'remove-provider-key': {
        const statuses = authService.removeApiKey(args[0] as string)
        await restartAllAgents?.()
        return statuses
      }

      case 'get-pane-info':
        return { paneId: args[0], projectRoot: pane(args)?.projectRoot ?? process.cwd() }

      case 'set-pane-root': {
        const targetPane = pane(args)
        if (!targetPane) throw new Error('Unknown pane')
        const resolvedPath = await resolveRemotePaneRoot(targetPane.accessRoot, args[1] as string)
        await paneManager.restartPaneAgent(args[0] as string, resolvedPath)
        fileWatchService?.watchPane(args[0] as string, resolvedPath)
        fileWatchService?.notifyRootChanged(args[0] as string)
        return { projectRoot: resolvedPath }
      }

      case 'fs-list-dir':
        return root(args) ? fileService.listDirectory(root(args)!, args[1] as string) : { entries: [], truncated: false }

      case 'fs-read-file':
        return root(args) ? fileService.readFile(root(args)!, args[1] as string) : null

      case 'fs-read-full':
        return root(args) ? fileService.readFileFull(root(args)!, args[1] as string) : null

      case 'fs-write-file':
        return root(args) ? fileService.writeFile(root(args)!, args[1] as string, args[2] as string) : null

      case 'fs-delete-file':
        return root(args) ? fileService.deleteFile(root(args)!, args[1] as string) : null

      case 'git-branch':
        return root(args) ? gitService.getBranch(root(args)!) : null

      case 'git-list-branches':
        return root(args) ? gitService.listBranches(root(args)!) : { current: null, branches: [] }

      case 'git-checkout-branch':
        return root(args) ? gitService.checkoutBranch(root(args)!, args[1] as string) : null

      case 'git-project-root':
        return root(args) ?? process.cwd()

      case 'git-modified-files':
        return root(args) ? gitService.getModifiedFiles(root(args)!) : []

      case 'git-changed-files':
        return root(args) ? gitService.getChangedFiles(root(args)!) : []

      case 'git-file-diff':
        return root(args) ? gitService.getFileDiff(root(args)!, args[1] as string) : null

      case 'approval-respond': {
        const approvalPane = pane(args)
        if (!approvalPane) return null
        const requestId = args[1] as string
        const approved = args[2] as boolean
        if (requestId.startsWith('cls_')) {
          approvalPane.agentBridge.respondToClassifier(requestId, approved)
        } else {
          approvalPane.agentBridge.respondToApproval(requestId, approved)
        }
        return null
      }

      case 'ui-select-respond': {
        const respondPane = pane(args)
        if (respondPane) {
          respondPane.agentBridge.respondToUiSelect(args[1] as string, args[2] as string | string[])
        }
        return null
      }

      case 'get-auto-mode-state':
        if (!classifierService) throw new Error(`Command '${name}' not supported`)
        return classifierService.getPaneState(args[0] as string)

      case 'resume-auto-mode':
        if (!classifierService) throw new Error(`Command '${name}' not supported`)
        classifierService.resume(args[0] as string)
        broadcast('event:auto-mode-resumed', { paneId: args[0] })
        return classifierService.getPaneState(args[0] as string)

      case 'toggle-pane-permission-mode': {
        const mode = await paneManager.togglePanePermissionMode(args[0] as string)
        broadcast('event:pane-permission-mode-changed', { paneId: args[0], mode })
        return mode
      }

      case 'voice-probe':
        if (!isVoiceServiceEnabled()) return getDisabledVoiceStatus()
        return voiceService.probe()

      case 'voice-start':
        if (!isVoiceServiceEnabled()) throw new Error(VOICE_SERVICE_DISABLED_REASON)
        return voiceService.start()

      case 'voice-stop':
        return voiceService.stop()

      case 'voice-status':
        if (!isVoiceServiceEnabled()) return getDisabledVoiceStatus()
        return voiceService.getStatus()

      case 'open-external':
      case 'set-window-title':
      case 'set-window-width':
        return null

      default:
        throw new Error(`Command '${name}' not supported`)
    }
  }
}
