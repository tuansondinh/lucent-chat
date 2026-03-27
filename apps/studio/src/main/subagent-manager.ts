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
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import {
  registerWorker,
  updateWorker,
  clearWorker,
} from './worker-registry.js'

const MAX_SUBAGENTS = 4
const KILL_GRACE_MS = 3_000

// ============================================================================
// Agent binary resolution (duplicated from process-manager to keep this module
// importable without bundler resolution — see note at top)
// ============================================================================

function _resolveAgentPath(): string {
  // Packaged mode: use the bundled entrypoint.js from the @lc/runtime bundle.
  try {
    const bundledEntry = join(process.resourcesPath, 'runtime', 'dist', 'entrypoint.js')
    if (existsSync(bundledEntry)) {
      return bundledEntry
    }
  } catch {
    // process.resourcesPath may not be defined outside Electron (tests)
  }

  // Dev mode: __dirname is apps/studio/dist/main after electron-vite build.
  // Go up 4 levels to reach the monorepo root.
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  const projectRoot = join(__dirname, '..', '..', '..', '..')
  return join(projectRoot, 'dist', 'loader.js')
}

function _resolveAgentCommand(entry: string): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  try {
    const bundledNode = join(process.resourcesPath, 'runtime', 'node')
    if (entry.startsWith(join(process.resourcesPath, 'runtime'))) {
      return {
        command: bundledNode,
        args: [entry, '--mode', 'rpc'],
        env: { ...process.env },
      }
    }
  } catch {
    // Not in Electron context
  }

  return {
    command: 'node',
    args: [entry, '--mode', 'rpc'],
    env: process.env,
  }
}

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
  /** Accumulated token cost in USD for this subagent. */
  totalCost: number
}

export interface SubagentSummary {
  id: string
  parentTurnId: string
  agentType: string
  prompt: string
  status: SubagentStatus
  startedAt: number
  endedAt?: number
  /** Accumulated token cost in USD. */
  totalCost: number
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

  /**
   * Token budget in USD. When cumulative cost across all subagents reaches
   * 80% of this value, a 'budget-alert' event is emitted.
   * If omitted or <= 0, no budget alerts are fired.
   */
  budgetUsd?: number
}

// ============================================================================
// SubagentManager
// ============================================================================

export class SubagentManager extends EventEmitter {
  private subagents = new Map<string, SubagentEntry & { bridge?: AgentBridgeLike; systemPrompt?: string }>()
  private options: SubagentManagerOptions
  /** Cumulative cost across all subagents (active + completed during this session). */
  private _totalCost = 0

  constructor(options: SubagentManagerOptions = {}) {
    super()
    this.options = options
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  /**
   * Accumulate cost for a subagent and fire a budget-alert event if configured
   * threshold (80% of budgetUsd) is exceeded.
   */
  private _accumulateCost(id: string, delta: number): void {
    if (delta <= 0) return

    const entry = this.subagents.get(id)
    if (entry) {
      entry.totalCost = (entry.totalCost ?? 0) + delta
      updateWorker(id, { totalCost: entry.totalCost })
    }

    this._totalCost += delta

    const budget = this.options.budgetUsd
    if (budget && budget > 0) {
      const threshold = budget * 0.8
      if (this._totalCost >= threshold) {
        this.emit('budget-alert', {
          totalCost: this._totalCost,
          budgetUsd: budget,
          percentUsed: Math.round((this._totalCost / budget) * 100),
        })
      }
    }
  }

  /**
   * Spawn the real agent binary using the bundled runtime resolution.
   * Uses `--mode rpc` for JSON-line RPC protocol.
   */
  private _spawnAgentProcess(opts: {
    cwd?: string
    env?: Record<string, string>
    systemPrompt?: string
    prompt: string
  }): ChildProcess {
    const entry = _resolveAgentPath()
    const launch = _resolveAgentCommand(entry)

    const env: NodeJS.ProcessEnv = {
      ...launch.env,
      ...(opts.env ?? {}),
      // Inject system prompt and initial prompt via environment so the agent
      // picks them up on startup without a separate handshake.
      ...(opts.systemPrompt ? { AGENT_SYSTEM_PROMPT: opts.systemPrompt } : {}),
      AGENT_INITIAL_PROMPT: opts.prompt,
    }

    return spawn(launch.command, launch.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.cwd ?? process.cwd(),
      env,
    })
  }

  // --------------------------------------------------------------------------
  // Core spawn
  // --------------------------------------------------------------------------

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

    // Spawn the real agent binary (or fall back to the placeholder in tests)
    let proc: ChildProcess
    try {
      proc = this._spawnAgentProcess({ systemPrompt, prompt })
    } catch (err: any) {
      console.warn(`[subagent-manager] agent binary not found, falling back to placeholder: ${err.message}`)
      // Fallback for environments where the agent binary is not present (CI, unit tests)
      proc = spawn('sleep', ['3600'], { stdio: ['pipe', 'pipe', 'pipe'] })
    }

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
      totalCost: 0,
    }

    this.subagents.set(id, entry)

    // Register in the worker registry for UI visibility
    registerWorker({
      id,
      parentTurnId,
      agentType,
      label: prompt.slice(0, 120),
      status: 'running',
      startedAt: entry.startedAt,
      totalCost: 0,
    })

    // Attach an AgentBridge if a factory was provided
    if (this.options.createBridge) {
      const bridge = this.options.createBridge()
      bridge.attach(proc)
      entry.bridge = bridge

      // Listen for agent events — handle completion and cost tracking
      const unsubscribe = bridge.onAgentEvent((event: any) => {
        // Budget tracking: accumulate cost from usage events
        if (event?.usage?.cost !== undefined) {
          this._accumulateCost(id, Number(event.usage.cost) || 0)
        }

        if (event.type === 'agent_end') {
          entry.status = 'done'
          entry.endedAt = Date.now()
          updateWorker(id, { status: 'done', endedAt: entry.endedAt })
          unsubscribe()
          this.emit('subagent-done', { id, parentTurnId, agentType })
          this.subagents.delete(id)
        }
      })
    }

    // Parse raw stdout for JSON-line events when no bridge is attached
    // This lets cost tracking work even in bridge-less mode
    if (!this.options.createBridge) {
      let buf = ''
      proc.stdout?.on('data', (chunk: Buffer) => {
        buf += chunk.toString()
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const event = JSON.parse(trimmed)
            if (event?.usage?.cost !== undefined) {
              this._accumulateCost(id, Number(event.usage.cost) || 0)
            }
            if (event?.type === 'agent_end') {
              entry.status = 'done'
              entry.endedAt = Date.now()
              updateWorker(id, { status: 'done', endedAt: entry.endedAt })
              this.emit('subagent-done', { id, parentTurnId, agentType })
              this.subagents.delete(id)
            }
          } catch {
            // Non-JSON line — ignore
          }
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
        updateWorker(id, { status: 'error', endedAt: e.endedAt })
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
      updateWorker(id, { status: 'error', endedAt: e.endedAt })
      this.emit('subagent-error', { id, parentTurnId, agentType, reason: err.message })
      this.subagents.delete(id)
    })

    console.log(`[subagent-manager] spawned subagent ${id} (type=${agentType}, parent=${parentTurnId}, pid=${proc.pid})`)
    return id
  }

  // --------------------------------------------------------------------------
  // Parallel execution
  // --------------------------------------------------------------------------

  /**
   * Run multiple subagents in parallel (max MAX_SUBAGENTS at a time).
   * Returns an array of SubagentSummary in the same order as the input tasks.
   *
   * @param parentTurnId - Parent turn that owns these subagents.
   * @param tasks        - Array of { agentType, prompt } descriptors.
   * @param onProgress   - Optional callback invoked after each task completes.
   */
  async spawnParallel(
    parentTurnId: string,
    tasks: Array<{ agentType: string; prompt: string }>,
    onProgress?: (results: SubagentSummary[]) => void,
  ): Promise<SubagentSummary[]> {
    const results: (SubagentSummary | null)[] = new Array(tasks.length).fill(null)

    // Process tasks in batches of MAX_SUBAGENTS
    let cursor = 0
    while (cursor < tasks.length) {
      const batchEnd = Math.min(cursor + MAX_SUBAGENTS, tasks.length)
      const batch = tasks.slice(cursor, batchEnd)

      await Promise.all(
        batch.map(async (task, batchIdx) => {
          const globalIdx = cursor + batchIdx
          let subagentId: string | null = null
          try {
            subagentId = await this.spawn(parentTurnId, task.agentType, task.prompt)
            // Wait for this subagent to reach a terminal state
            await new Promise<void>((resolve) => {
              const checkDone = (data: any) => {
                if (data.id !== subagentId) return
                this.off('subagent-done', checkDone)
                this.off('subagent-error', checkDone)
                this.off('subagent-aborted', checkDone)
                resolve()
              }
              this.on('subagent-done', checkDone)
              this.on('subagent-error', checkDone)
              this.on('subagent-aborted', checkDone)
            })
            results[globalIdx] = this.get(subagentId) ?? {
              id: subagentId,
              parentTurnId,
              agentType: task.agentType,
              prompt: task.prompt,
              status: 'done',
              startedAt: Date.now(),
              endedAt: Date.now(),
              totalCost: 0,
            }
          } catch (err: any) {
            results[globalIdx] = {
              id: subagentId ?? randomUUID(),
              parentTurnId,
              agentType: task.agentType,
              prompt: task.prompt,
              status: 'error',
              startedAt: Date.now(),
              endedAt: Date.now(),
              totalCost: 0,
            }
            console.error(`[subagent-manager] parallel task ${globalIdx} failed: ${err.message}`)
          }

          if (onProgress) {
            onProgress(results.filter(Boolean) as SubagentSummary[])
          }
        }),
      )

      cursor = batchEnd
    }

    return results.filter(Boolean) as SubagentSummary[]
  }

  // --------------------------------------------------------------------------
  // Chain execution
  // --------------------------------------------------------------------------

  /**
   * Run subagents sequentially, chaining the output of step N into step N+1.
   * Use `{previous}` in `promptTemplate` to interpolate the previous step's
   * final output/summary.
   *
   * @param parentTurnId - Parent turn that owns these subagents.
   * @param steps        - Array of { agentType, promptTemplate } descriptors.
   * @param onProgress   - Optional callback invoked after each step completes.
   */
  async spawnChain(
    parentTurnId: string,
    steps: Array<{ agentType: string; promptTemplate: string }>,
    onProgress?: (stepIndex: number, result: SubagentSummary) => void,
  ): Promise<SubagentSummary[]> {
    const results: SubagentSummary[] = []
    let previousOutput = ''

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      // Replace {previous} placeholder with the previous step's result summary
      const prompt = step.promptTemplate.replace(/\{previous\}/g, previousOutput)

      let subagentId: string | null = null
      let result: SubagentSummary

      try {
        subagentId = await this.spawn(parentTurnId, step.agentType, prompt)

        // Wait for this subagent to reach a terminal state
        await new Promise<void>((resolve) => {
          const checkDone = (data: any) => {
            if (data.id !== subagentId) return
            this.off('subagent-done', checkDone)
            this.off('subagent-error', checkDone)
            this.off('subagent-aborted', checkDone)
            resolve()
          }
          this.on('subagent-done', checkDone)
          this.on('subagent-error', checkDone)
          this.on('subagent-aborted', checkDone)
        })

        result = this.get(subagentId) ?? {
          id: subagentId,
          parentTurnId,
          agentType: step.agentType,
          prompt,
          status: 'done',
          startedAt: Date.now(),
          endedAt: Date.now(),
          totalCost: 0,
        }
      } catch (err: any) {
        result = {
          id: subagentId ?? randomUUID(),
          parentTurnId,
          agentType: step.agentType,
          prompt,
          status: 'error',
          startedAt: Date.now(),
          endedAt: Date.now(),
          totalCost: 0,
        }
        console.error(`[subagent-manager] chain step ${i} failed: ${err.message}`)
      }

      results.push(result)
      // Use the prompt as the "previous output" for chaining context
      // (in production the bridge would capture actual agent output)
      previousOutput = `Step ${i + 1} (${step.agentType}): ${prompt}`

      if (onProgress) {
        onProgress(i, result)
      }

      // Stop the chain on hard errors to avoid cascading failures
      if (result.status === 'error') {
        console.warn(`[subagent-manager] chain stopped at step ${i} due to error`)
        break
      }
    }

    return results
  }

  // --------------------------------------------------------------------------
  // Abort
  // --------------------------------------------------------------------------

  /**
   * Abort a single subagent by ID. Cleans up the process and removes from map.
   */
  async abort(subagentId: string): Promise<void> {
    const entry = this.subagents.get(subagentId)
    if (!entry) return

    const prevStatus = entry.status
    entry.status = 'aborted'
    entry.endedAt = Date.now()
    updateWorker(subagentId, { status: 'aborted', endedAt: entry.endedAt })

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
    clearWorker(subagentId)
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

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

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
      totalCost: s.totalCost ?? 0,
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
      totalCost: e.totalCost ?? 0,
    }
  }

  /** Count of currently active subagents. */
  get activeCount(): number {
    return Array.from(this.subagents.values()).filter(
      (s) => s.status === 'spawning' || s.status === 'running',
    ).length
  }

  /**
   * Total accumulated token cost in USD across all subagents spawned during
   * this session (including completed ones).
   */
  getTotalCost(): number {
    return this._totalCost
  }
}
