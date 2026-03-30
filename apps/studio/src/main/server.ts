/**
 * server.ts — standalone PWA bridge server (no Electron required).
 *
 * Boots the same agent services as the Electron app but without a window,
 * then starts WebBridgeServer to serve the PWA and expose the bridge API.
 *
 * Usage (from apps/studio):
 *   npm run serve        # build:pwa first, then serve PWA + bridge on port 8788
 *
 * All agent events are broadcast directly to WebSocket clients.
 * Token is read from settings (~/.lucent/settings.json),
 * auto-generated on first run. Legacy ~/.voice-bridge-desktop/settings.json
 * is migrated automatically.
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { webcrypto } from 'node:crypto'

import { ProcessManager } from './process-manager.js'
import { AgentBridge } from './agent-bridge.js'
import { Orchestrator } from './orchestrator.js'
import { PaneManager } from './pane-manager.js'
import { SessionService } from './session-service.js'
import { SettingsService } from './settings-service.js'
import { AuthService } from './auth-service.js'
import { FileService } from './file-service.js'
import { GitService } from './git-service.js'
import { getDisabledVoiceStatus, VOICE_SERVICE_DISABLED_REASON, VoiceService } from './voice-service.js'
import { WebBridgeServer } from './web-bridge-server.js'
import { TailscaleService } from './tailscale-service.js'
import { resolveRemotePaneRoot } from './pane-root-policy.js'
import { sanitizeSettingsForRenderer, validateSettingsPatch } from './settings-contract.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function main(): Promise<void> {
  // 1. Settings
  const settingsService = new SettingsService()
  const settings = settingsService.load()

  // 2. Pure Node.js services (no Electron APIs needed)
  const processManager = new ProcessManager()
  const agentBridge = new AgentBridge()
  const sessionService = new SessionService(agentBridge)
  await sessionService.loadActiveSessionId()

  const authService = new AuthService()
  const fileService = new FileService()
  const gitService = new GitService()
  const tailscaleService = new TailscaleService()
  const paneManager = new PaneManager()

  const initialProjectRoot = process.cwd()

  // 2b. Voice service — project root for audio-service lookup
  const voiceService = new VoiceService(() => join(__dirname, '..', '..', '..'))
  const isVoiceServiceEnabled = (): boolean => settingsService.get().voiceServiceEnabled !== false
  voiceService.probe()
    .then((result) => {
      if (!result.available) return
      if (!isVoiceServiceEnabled()) return
      // Only prewarm if the user opted in — keeps behaviour consistent with index.ts.
      if (settings.voiceOptIn !== true) return
      setTimeout(() => {
        voiceService.start().catch((err: Error) => {
          console.warn('[server] voice background start failed:', err.message)
        })
      }, 2_000)
    })
    .catch((err: Error) => console.warn('[server] voice probe failed:', err.message))

  // 3. Ensure bearer token exists
  let token = settings.remoteAccessToken
  if (!token) {
    const bytes = new Uint8Array(16)
    webcrypto.getRandomValues(bytes)
    token = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
    settingsService.save({ remoteAccessToken: token })
  }

  const port = settings.remoteAccessPort ?? 8788

  // 4. Agent attachment helper
  function attachAgentBridge(): void {
    const proc = processManager.getAgentProcess()
    if (!proc) return
    agentBridge.detach()
    agentBridge.attach(proc)
    agentBridge.getState()
      .then((state) => {
        processManager.setState('agent', 'ready')
        if (state.sessionFile) sessionService.setActiveSessionId(state.sessionFile)
      })
      .catch((err: Error) => console.warn('[server] agent readiness probe failed:', err.message))
  }

  // 5. Dispatch command routing (same as index.ts, no Electron-only cmds)
  const pane = (args: unknown[]) => paneManager.getPane(args[0] as string)
  const root = (args: unknown[]) => pane(args)?.projectRoot

  // broadcast is set after WebBridgeServer is created (step 7)
  let broadcast: (channel: string, data: unknown) => void = () => {}

  const dispatchCmd = async (name: string, args: unknown[]): Promise<unknown> => {
    switch (name) {
      case 'get-settings': return sanitizeSettingsForRenderer(settingsService.get())
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
      case 'pane-list': return paneManager.getPaneIds()
      case 'pane-create': { const p = await paneManager.createPane(settingsService, broadcast, args[0] as string | undefined); return { paneId: p.id } }
      case 'pane-close': return paneManager.destroyPane(args[0] as string)
      case 'prompt': return pane(args)?.orchestrator.submitTurn(args[1] as string, 'text')
      case 'abort': return pane(args)?.orchestrator.abortCurrentTurn()
      case 'get-state': return pane(args)?.agentBridge.getState()
      case 'get-models': return pane(args)?.agentBridge.getAvailableModels()
      case 'switch-model': return pane(args)?.agentBridge.setModel(args[1] as string, args[2] as string)
      case 'new-session': return pane(args)?.agentBridge.newSession()
      case 'get-health': return pane(args)?.processManager.getStates() ?? {}
      case 'get-sessions': return pane(args)?.sessionService.listSessions() ?? []
      case 'get-messages': return pane(args)?.sessionService.getMessages() ?? []
      case 'switch-session': return pane(args)?.sessionService.switchSession(args[1] as string, pane(args)!.orchestrator)
      case 'rename-session': return pane(args)?.sessionService.renameSession(args[1] as string)
      case 'delete-session': return pane(args)?.sessionService.deleteSession(args[1] as string)
      case 'get-provider-auth-status': return authService.getProviderStatuses()
      case 'get-provider-catalog': return authService.getProviderCatalog()
      case 'validate-and-save-provider-key': return authService.validateAndSaveApiKey(args[0] as string, args[1] as string)
      case 'remove-provider-key': return authService.removeApiKey(args[0] as string)
      case 'get-pane-info': return { paneId: args[0], projectRoot: pane(args)?.projectRoot ?? process.cwd() }
      case 'set-pane-root': {
        const p2 = pane(args)
        if (!p2) throw new Error('Unknown pane')
        const resolvedPath = await resolveRemotePaneRoot(p2.accessRoot, args[1] as string)
        await paneManager.restartPaneAgent(args[0] as string, resolvedPath)
        return { projectRoot: resolvedPath }
      }
      case 'fs-list-dir': return root(args) ? fileService.listDirectory(root(args)!, args[1] as string) : { entries: [], truncated: false }
      case 'fs-read-file': return root(args) ? fileService.readFile(root(args)!, args[1] as string) : null
      case 'fs-delete-file': return root(args) ? fileService.deleteFile(root(args)!, args[1] as string) : null
      case 'git-branch': return root(args) ? gitService.getBranch(root(args)!) : null
      case 'git-list-branches': return root(args) ? gitService.listBranches(root(args)!) : { current: null, branches: [] }
      case 'git-checkout-branch': return root(args) ? gitService.checkoutBranch(root(args)!, args[1] as string) : null
      case 'git-project-root': return root(args) ?? process.cwd()
      case 'git-modified-files': return root(args) ? gitService.getModifiedFiles(root(args)!) : []
      case 'git-changed-files': return root(args) ? gitService.getChangedFiles(root(args)!) : []
      case 'git-file-diff': return root(args) ? gitService.getFileDiff(root(args)!, args[1] as string) : null
      case 'voice-probe':
        if (!isVoiceServiceEnabled()) return getDisabledVoiceStatus()
        return voiceService.probe()
      case 'voice-start':
        if (!isVoiceServiceEnabled()) throw new Error(VOICE_SERVICE_DISABLED_REASON)
        return voiceService.start()
      case 'voice-stop': return voiceService.stop()
      case 'voice-status':
        if (!isVoiceServiceEnabled()) return getDisabledVoiceStatus()
        return voiceService.getStatus()
      case 'open-external': return null
      case 'set-window-title': return null
      case 'set-window-width': return null
      case 'approval-respond': {
        const approvalPane = pane(args)
        if (approvalPane) {
          approvalPane.agentBridge.respondToApproval(args[1] as string, args[2] as boolean)
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
      default: throw new Error(`Command '${name}' not supported`)
    }
  }

  // 6. Tailscale origin for CORS
  const tailscaleOrigin = await tailscaleService.getStatus()
    .then((s) => s.magicDnsHostname ? `https://${s.magicDnsHostname}` : undefined)
    .catch(() => undefined)

  // 7. WebBridgeServer
  const webBridgeServer = new WebBridgeServer({
    token,
    dispatchCmd,
    tailscaleOrigin,
    staticDir: join(__dirname, '../../dist/pwa'),
    bindAddress: settings.tailscaleServeEnabled ? '0.0.0.0' : '127.0.0.1',
    getVoiceEndpoint: () => {
      const status = voiceService.getStatus()
      if (status.state === 'ready' && status.port && status.token) {
        return { port: status.port, token: status.token }
      }
      return null
    },
  })

  // Now that server exists, wire up broadcast
  broadcast = (channel: string, data: unknown) => webBridgeServer.pushEvent(channel, data)

  // Forward voice service status events to all PWA clients
  voiceService.on('status', (status) => {
    broadcast('event:voice-status', status)
  })

  // 8. Orchestrator for pane-0
  const orchestrator = new Orchestrator(agentBridge, {
    onChunk: (d) => broadcast('event:agent-chunk', { paneId: 'pane-0', ...d }),
    onDone: (d) => broadcast('event:agent-done', { paneId: 'pane-0', ...d }),
    onToolStart: (d) => broadcast('event:tool-start', { paneId: 'pane-0', ...d }),
    onToolEnd: (d) => broadcast('event:tool-end', { paneId: 'pane-0', ...d }),
    onTurnState: (d) => broadcast('event:turn-state', { paneId: 'pane-0', ...d }),
    onError: (d) => broadcast('event:error', { paneId: 'pane-0', ...d }),
    onThinkingStart: (d) => broadcast('event:thinking-start', { paneId: 'pane-0', ...d }),
    onThinkingChunk: (d) => broadcast('event:thinking-chunk', { paneId: 'pane-0', ...d }),
    onThinkingEnd: (d) => broadcast('event:thinking-end', { paneId: 'pane-0', ...d }),
    onTextBlockStart: (d) => broadcast('event:text-block-start', { paneId: 'pane-0', ...d }),
    onTextBlockEnd: (d) => broadcast('event:text-block-end', { paneId: 'pane-0', ...d }),
    onTurnComplete: () => {
      agentBridge.getState()
        .then((state) => {
          if (state.sessionFile) sessionService.setActiveSessionId(state.sessionFile)
        })
        .catch(() => {})
    },
  })

  paneManager.initPane0(processManager, agentBridge, orchestrator, sessionService, attachAgentBridge, initialProjectRoot)

  processManager.on('health', (states: Record<string, string>) => {
    broadcast('event:health', { paneId: 'pane-0', states })
  })

  // Forward approval requests from pane-0 to PWA clients
  agentBridge.on('approval-request', (req) => {
    broadcast('event:approval-request', { paneId: 'pane-0', ...req })
  })

  // 9. Spawn agent
  const agentEnv: Record<string, string> = {}
  if (settings.tavilyApiKey) agentEnv.TAVILY_API_KEY = settings.tavilyApiKey
  // Pass permission mode so the agent registers the stdio approval handler
  agentEnv.GSD_STUDIO_PERMISSION_MODE = (settings as any).permissionMode ?? 'accept-on-edit'
  processManager.spawnAgent(initialProjectRoot, agentEnv)
  attachAgentBridge()
  processManager.on('agent-restarting', () => setTimeout(attachAgentBridge, 200))

  // 10. Start server
  await webBridgeServer.start(port)
  console.log(`[server] listening on port ${port}`)
  console.log(`[server] PWA → http://localhost:${port}`)
  if (tailscaleOrigin) console.log(`[server] Tailscale → ${tailscaleOrigin}`)


  if (settings.tailscaleServeEnabled) {
    tailscaleService.enableServe(port).catch((err: Error) => {
      console.warn('[server] Tailscale serve failed:', err.message)
    })
  }

  // 11. Graceful shutdown
  const shutdown = async () => {
    console.log('[server] shutting down...')
    await webBridgeServer.stop()
    await voiceService.stop()
    await paneManager.shutdownAll()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err: Error) => {
  console.error('[server] fatal:', err)
  process.exit(1)
})
