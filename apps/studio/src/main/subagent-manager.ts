/**
 * SubagentManager — spawns and tracks child agent processes.
 *
 * Each subagent gets its own ChildProcess. Maps parent turn_id to child
 * agent IDs. Enforces max 4 concurrent subagents. Handles crash (emit
 * error event + cleanup), orphan cleanup on parent abort, and
 * shutdownAll() on app quit.
 *
 * NOTE: Imports are kept minimal (no ProcessManager/AgentBridge) so this
 * module can be imported in Node test runners without bundler `.js`→`.ts`
 * resolution. ProcessManager and AgentBridge are wired at the orchestrator
 * layer which runs through electron-vite's bundler.
 */

import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'

const MAX_SUBAGENTS = 4
const KILL_GRACE_MS = 3_000

// ============================================================================
// Types
// ============================================================================

export type SubagentStatus = 'spawning' | 'running' | 'done' | 'error' | 'aborted'

export interface SubagentEntry {
  id: string
  parentTurnId: string
  agentType: string
  prompt: string
  status: SubagentStatus
  startedAt: number
  endedAt?: number
  proc: ChildProcess | null
}

export interface SubagentSummary {
  id: string
  parentTurnId: string
  agentType: string
  prompt: string
  status: SubagentStatus
  startedAt: number
  endedAt?: number
}

/** Minimal interface so callers can inject a custom AgentBridge factory. */
export interface AgentBridgeLike {
  attach(proc: ChildProcess): void
  abort(): Promise<void>
  onAgentEvent(handler: (event: any) => void): () => void
}

export interface SubagentManagerOptions {
  /**
   * Optional factory to create an AgentBridge per subagent.
   * If provided, each spawned process gets its own bridge for RPC.
   * If omitted, only raw process management is done.
   */
  createBridge?: () => AgentBridgeLike

  /**
   * Optional factory for the loader so types can be resolved at call site.
   * Takes agent type and returns { systemPrompt: string } or null.
   */
  loadDefinition?: (agentType: string) => Promise<{ systemPrompt: string } | null>
}

// ============================================================================
// SubagentManager
// ============================================================================

export class SubagentManager extends EventEmitter {
  private subagents = new Map<string, SubagentEntry & { bridge?: AgentBridgeLike; systemPrompt?: string }>()
  private options: SubagentManagerOptions

  constructor(options: SubagentManagerOptions = {}) {
    super()
    this.options = options
  }

  /**
   * Spawn a new subagent process for the given parentTurnId.
   * Returns the subagent ID.
   * Throws if max concurrency (4) is exceeded.
   */
  async spawn(
    parentTurnId: string,
    agentType: string,
    prompt: string,
  ): Promise<string> {
    const active = Array.from(this.subagents.values()).filter(
      (s) => s.status === 'spawning' || s.status === 'running',
    )
    if (active.length >= MAX_SUBAGENTS) {
      throw new Error(
        `Max subagent limit (${MAX_SUBAGENTS}) reached — cannot spawn more concurrent subagents`,
      )
    }

    const id = randomUUID()

    // Optionally load the agent definition
    let systemPrompt = ''
    if (this.options.loadDefinition) {
      try {
        const def = await this.options.loadDefinition(agentType)
        systemPrompt = def?.systemPrompt ?? ''
      } catch (err: any) {
        console.warn(`[subagent-manager] failed to load definition for "${agentType}": ${err.message}`)
      }
    }

    // Spawn a lightweight process.
    // In production this would be: node dist/loader.js --mode rpc
    // with the system prompt injected via env or stdin handshake.
    // For the infrastructure layer, we use 'sleep' as a placeholder that
    // keeps the process alive until abort. The orchestrator layer uses the
    // bridge to send actual prompts.
    const proc = spawn('sleep', ['3600'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const entry: SubagentEntry & { bridge?: AgentBridgeLike; systemPrompt: string } = {
      id,
      parentTurnId,
      agentType,
      prompt,
      status: 'running',
      startedAt: Date.now(),
      endedAt: undefined,
      proc,
      bridge: undefined,
      systemPrompt,
    }

    this.subagents.set(id, entry)

    // Attach an AgentBridge if a factory was provided
    if (this.options.createBridge) {
      const bridge = this.options.createBridge()
      bridge.attach(proc)
      entry.bridge = bridge

      // Listen for agent_end event (clean completion)
      const unsubscribe = bridge.onAgentEvent((event: any) => {
        if (event.type === 'agent_end') {
          entry.status = 'done'
          entry.endedAt = Date.now()
          unsubscribe()
          this.emit('subagent-done', { id, parentTurnId, agentType })
          this.subagents.delete(id)
        }
      })
    }

    // Watch for crash/unexpected exit
    proc.once('exit', (code, signal) => {
      const e = this.subagents.get(id)
      if (!e) return
      e.proc = null
      if (e.status === 'running' || e.status === 'spawning') {
        e.status = 'error'
        e.endedAt = Date.now()
        this.emit('subagent-error', {
          id,
          parentTurnId,
          agentType,
          reason: signal ? `killed by ${signal}` : `exited with code ${code}`,
        })
        this.subagents.delete(id)
      }
    })

    proc.once('error', (err) => {
      const e = this.subagents.get(id)
      if (!e) return
      e.proc = null
      e.status = 'error'
      e.endedAt = Date.now()
      this.emit('subagent-error', { id, parentTurnId, agentType, reason: err.message })
      this.subagents.delete(id)
    })

    console.log(`[subagent-manager] spawned subagent ${id} (type=${agentType}, parent=${parentTurnId}, pid=${proc.pid})`)
    return id
  }

  /**
   * Abort a single subagent by ID. Cleans up the process and removes from map.
   */
  async abort(subagentId: string): Promise<void> {
    const entry = this.subagents.get(subagentId)
    if (!entry) return

    const prevStatus = entry.status
    entry.status = 'aborted'
    entry.endedAt = Date.now()

    // Try graceful abort via bridge
    if (entry.bridge) {
      try {
        await entry.bridge.abort()
      } catch {
        // Bridge may already be dead
      }
    }

    // Kill the process
    const proc = entry.proc
    if (proc && proc.exitCode === null) {
      await new Promise<void>((resolve) => {
        const forceKillTimer = setTimeout(() => {
          try { proc.kill('SIGKILL') } catch {}
          resolve()
        }, KILL_GRACE_MS)

        proc.once('exit', () => {
          clearTimeout(forceKillTimer)
          resolve()
        })

        try { proc.kill('SIGTERM') } catch {}
      })
    }

    entry.proc = null
    this.subagents.delete(subagentId)

    if (prevStatus !== 'aborted') {
      this.emit('subagent-aborted', { id: subagentId, parentTurnId: entry.parentTurnId })
    }
    console.log(`[subagent-manager] aborted subagent ${subagentId}`)
  }

  /**
   * Abort all subagents belonging to a parent turn (orphan cleanup).
   * Called when the parent turn is aborted or the pane is closed.
   */
  async abortByParentTurn(parentTurnId: string): Promise<void> {
    const toAbort = Array.from(this.subagents.values()).filter(
      (s) => s.parentTurnId === parentTurnId,
    )
    await Promise.all(toAbort.map((s) => this.abort(s.id)))
    console.log(
      `[subagent-manager] aborted ${toAbort.length} subagent(s) for parent turn ${parentTurnId}`,
    )
  }

  /**
   * Shut down all subagents. Called on app quit.
   */
  async shutdownAll(): Promise<void> {
    console.log('[subagent-manager] shutting down all subagents')
    const all = Array.from(this.subagents.values())
    await Promise.all(all.map((s) => this.abort(s.id)))
    console.log('[subagent-manager] all subagents stopped')
  }

  /**
   * Return a summary list of all tracked subagents (active + recently completed).
   */
  list(): SubagentSummary[] {
    return Array.from(this.subagents.values()).map((s) => ({
      id: s.id,
      parentTurnId: s.parentTurnId,
      agentType: s.agentType,
      prompt: s.prompt,
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
    }))
  }

  /** Get a single subagent entry by ID (without internal bridge). */
  get(subagentId: string): SubagentSummary | undefined {
    const e = this.subagents.get(subagentId)
    if (!e) return undefined
    return {
      id: e.id,
      parentTurnId: e.parentTurnId,
      agentType: e.agentType,
      prompt: e.prompt,
      status: e.status,
      startedAt: e.startedAt,
      endedAt: e.endedAt,
    }
  }

  /** Count of currently active subagents. */
  get activeCount(): number {
    return Array.from(this.subagents.values()).filter(
      (s) => s.status === 'spawning' || s.status === 'running',
    ).length
  }
}
