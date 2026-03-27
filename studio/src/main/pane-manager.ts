/**
 * PaneManager — owns the lifecycle of all chat panes.
 *
 * Each pane has its own ProcessManager, AgentBridge, Orchestrator, and SessionService.
 * Pane-0 is always present (bootstrapped from index.ts at startup).
 * Additional panes (1-3) are created on demand via cmd:pane-create.
 */

import { ProcessManager } from './process-manager.js'
import { AgentBridge } from './agent-bridge.js'
import { Orchestrator, type OrchestratorCallbacks } from './orchestrator.js'
import { SessionService } from './session-service.js'
import type { SettingsService } from './settings-service.js'

// ============================================================================
// Types
// ============================================================================

export interface PaneRuntime {
  id: string
  processManager: ProcessManager
  agentBridge: AgentBridge
  orchestrator: Orchestrator
  sessionService: SessionService
  model: string
  /** Project root for this pane's explorer, git context, and agent cwd. */
  projectRoot: string
  attachBridge: () => void
}

// ============================================================================
// PaneManager
// ============================================================================

export class PaneManager {
  private panes = new Map<string, PaneRuntime>()
  private nextPaneIndex = 1

  /**
   * Initialize pane-0 from existing services (called from index.ts at startup).
   * This wraps the already-created services so pane-0 is not a cold start.
   */
  initPane0(
    processManager: ProcessManager,
    agentBridge: AgentBridge,
    orchestrator: Orchestrator,
    sessionService: SessionService,
    attachBridge: () => void,
    projectRoot: string = process.cwd(),
  ): PaneRuntime {
    const pane: PaneRuntime = {
      id: 'pane-0',
      processManager,
      agentBridge,
      orchestrator,
      sessionService,
      model: '',
      projectRoot,
      attachBridge,
    }
    this.panes.set('pane-0', pane)
    return pane
  }

  /**
   * Create a new pane with its own process, bridge, orchestrator, and session service.
   * Spawns a fresh agent process.
   */
  async createPane(
    settingsService: SettingsService,
    pushEvent: (channel: string, data: unknown) => void
  ): Promise<PaneRuntime> {
    const id = `pane-${this.nextPaneIndex++}`
    const settings = settingsService.get()
    const agentEnv: Record<string, string> = {}
    if (settings.tavilyApiKey) {
      agentEnv.TAVILY_API_KEY = settings.tavilyApiKey as string
    }

    const processManager = new ProcessManager()
    const agentBridge = new AgentBridge()
    const sessionService = new SessionService(agentBridge)

    const callbacks: OrchestratorCallbacks = {
      onChunk: (d) => pushEvent('event:agent-chunk', { paneId: id, ...d }),
      onDone: (d) => pushEvent('event:agent-done', { paneId: id, ...d }),
      onToolStart: (d) => pushEvent('event:tool-start', { paneId: id, ...d }),
      onToolEnd: (d) => pushEvent('event:tool-end', { paneId: id, ...d }),
      onTurnState: (d) => pushEvent('event:turn-state', { paneId: id, ...d }),
      onError: (d) => pushEvent('event:error', { paneId: id, ...d }),
      onThinkingStart: (d) => pushEvent('event:thinking-start', { paneId: id, ...d }),
      onThinkingChunk: (d) => pushEvent('event:thinking-chunk', { paneId: id, ...d }),
      onThinkingEnd: (d) => pushEvent('event:thinking-end', { paneId: id, ...d }),
      onTextBlockStart: (d) => pushEvent('event:text-block-start', { paneId: id, ...d }),
      onTextBlockEnd: (d) => pushEvent('event:text-block-end', { paneId: id, ...d }),
    }
    const orchestrator = new Orchestrator(agentBridge, callbacks)

    // Helper: attach bridge once the agent process is up
    const attachBridge = () => {
      const proc = processManager.getAgentProcess()
      if (!proc) return
      agentBridge.detach()
      agentBridge.attach(proc)
      agentBridge
        .getState()
        .then((state) => {
          processManager.setState('agent', 'ready')
          if (state.sessionFile) {
            sessionService.setActiveSessionId(state.sessionFile)
          }
        })
        .catch(() => {})
    }

    // Spawn agent and wire up bridge
    const projectRoot = process.cwd()
    processManager.spawnAgent(projectRoot, agentEnv)
    attachBridge()
    processManager.on('agent-restarting', () => setTimeout(attachBridge, 200))
    processManager.on('health', (states: Record<string, string>) => {
      pushEvent('event:health', { paneId: id, states })
    })

    await sessionService.loadActiveSessionId()

    const pane: PaneRuntime = { id, processManager, agentBridge, orchestrator, sessionService, model: '', projectRoot, attachBridge }
    this.panes.set(id, pane)
    return pane
  }

  async restartPaneAgent(id: string, projectRoot?: string): Promise<void> {
    const pane = this.panes.get(id)
    if (!pane) return

    if (projectRoot) {
      pane.projectRoot = projectRoot
    }

    try {
      await pane.orchestrator.abortCurrentTurn()
    } catch {
      // ignore
    }

    pane.agentBridge.detach()
    await pane.processManager.killProcess('agent')
    pane.processManager.spawnAgent(pane.projectRoot)
    pane.attachBridge()
  }

  /**
   * Destroy a pane and shut down its agent process.
   * Pane-0 is not destroyable — it is owned by the main app lifecycle.
   */
  async destroyPane(id: string): Promise<void> {
    if (id === 'pane-0') return
    const pane = this.panes.get(id)
    if (!pane) return
    try {
      await pane.orchestrator.abortCurrentTurn()
    } catch {
      // ignore — turn may already be idle
    }
    await pane.processManager.shutdownAll()
    this.panes.delete(id)
  }

  getPane(id: string): PaneRuntime | undefined {
    return this.panes.get(id)
  }

  getPaneIds(): string[] {
    return Array.from(this.panes.keys())
  }

  /** Destroy all non-pane-0 panes (called during graceful app shutdown). */
  async shutdownAll(): Promise<void> {
    const ids = Array.from(this.panes.keys()).filter((id) => id !== 'pane-0')
    await Promise.all(ids.map((id) => this.destroyPane(id)))
  }
}
