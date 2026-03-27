/**
 * ProcessManager — manages child processes (agent, future sidecar) with
 * readiness states, exponential-backoff restart, and graceful shutdown.
 */

import { EventEmitter } from 'node:events'
import { type ChildProcess, spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export type ProcessState = 'stopped' | 'starting' | 'ready' | 'degraded' | 'crashed'

interface ManagedProcess {
  name: string
  proc: ChildProcess | null
  state: ProcessState
  backoffMs: number
  restartTimer: ReturnType<typeof setTimeout> | null
  intentionalKill: boolean
  /** Extra env vars to pass on spawn and automatic restarts. */
  extraEnv?: Record<string, string>
  /** Working directory to use for spawn and automatic restarts. */
  cwd?: string
}

const BACKOFF_INITIAL_MS = 1_000
const BACKOFF_MAX_MS = 30_000
const KILL_GRACE_MS = 3_000

/** Path to the agent entry point (built dist). */
function resolveAgentPath(): string {
  // Packaged mode: use the bundled entrypoint.js from the @gsd/pi-coding-agent bundle.
  // The bundle places entrypoint.js at runtime/dist/entrypoint.js (alongside all
  // compiled JS) so relative imports resolve correctly.
  const bundledEntry = join(process.resourcesPath, 'runtime', 'dist', 'entrypoint.js')
  if (existsSync(bundledEntry)) {
    return bundledEntry
  }

  // Dev mode: __dirname is apps/studio/dist/main (after electron-vite build).
  // Going up 4 levels: dist/main → dist → studio → apps → voice-bridge-desktop (project root).
  const projectRoot = join(__dirname, '..', '..', '..', '..')
  return join(projectRoot, 'dist', 'loader.js')
}

function resolveAgentCommand(entry: string): {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
} {
  if (entry.startsWith(join(process.resourcesPath, 'runtime'))) {
    // Packaged mode: use the bundled standalone Node binary.
    // No ELECTRON_RUN_AS_NODE — the bundled node is a plain Node binary, not Electron.
    const bundledNode = join(process.resourcesPath, 'runtime', 'node')
    return {
      command: bundledNode,
      args: [entry, '--mode', 'rpc'],
      env: { ...process.env },
    }
  }

  // Dev mode: use system node binary.
  return {
    command: 'node',
    args: [entry, '--mode', 'rpc'],
    env: process.env,
  }
}

export class ProcessManager extends EventEmitter {
  private processes = new Map<string, ManagedProcess>()

  constructor() {
    super()
    this.processes.set('agent', {
      name: 'agent',
      proc: null,
      state: 'stopped',
      backoffMs: BACKOFF_INITIAL_MS,
      restartTimer: null,
      intentionalKill: false,
    })
    this.processes.set('sidecar', {
      name: 'sidecar',
      proc: null,
      state: 'stopped',
      backoffMs: BACKOFF_INITIAL_MS,
      restartTimer: null,
      intentionalKill: false,
    })
  }

  /** Spawn the Pi SDK agent in RPC mode.
   * @param extraEnv — Additional environment variables to pass to the agent process.
   */
  spawnAgent(cwd?: string, extraEnv?: Record<string, string>): void {
    const entry = resolveAgentPath()
    const launch = resolveAgentCommand(entry)
    console.log(`[process-manager] spawning agent: ${launch.command} ${launch.args.join(' ')}`)

    const managed = this.processes.get('agent')!
    managed.intentionalKill = false
    if (cwd !== undefined) {
      managed.cwd = cwd
    }
    // Persist extraEnv so automatic restarts use the same environment
    if (extraEnv !== undefined) {
      managed.extraEnv = extraEnv
    }

    const proc = spawn(launch.command, launch.args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      detached: true,
      cwd: managed.cwd ?? process.cwd(),
      env: { ...launch.env, ...managed.extraEnv },
    })

    managed.proc = proc
    this.setState('agent', 'starting')

    proc.on('spawn', () => {
      console.log(`[process-manager] agent spawned (pid=${proc.pid})`)
    })

    proc.on('error', (err) => {
      console.error(`[process-manager] agent process error: ${err.message}`)
      this.setState('agent', 'crashed')
      managed.proc = null
      if (!managed.intentionalKill) {
        this.scheduleRestart('agent')
      }
    })

    proc.on('exit', (code, signal) => {
      console.log(`[process-manager] agent exited (code=${code}, signal=${signal})`)
      managed.proc = null
      if (!managed.intentionalKill) {
        this.setState('agent', 'crashed')
        this.scheduleRestart('agent')
      } else {
        this.setState('agent', 'stopped')
      }
    })
  }

  /** Spawn a voice sidecar process and register it under the 'sidecar' key. */
  spawnSidecar(cmd: string, args: string[], env?: Record<string, string>): ChildProcess {
    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env,
      detached: false,
    })
    const managed = this.processes.get('sidecar')!
    managed.proc = proc
    return proc
  }

  /** Get the sidecar ChildProcess (may be null if not running). */
  getSidecarProcess(): ChildProcess | null {
    return this.processes.get('sidecar')?.proc ?? null
  }

  /** Update a process state and emit events. */
  setState(name: string, state: ProcessState): void {
    const managed = this.processes.get(name)
    if (!managed) return
    managed.state = state
    console.log(`[process-manager] ${name} state → ${state}`)
    this.emit('state-change', name, state)
    this.emit('health', this.getStates())
    if (state === 'ready') {
      // Reset backoff on successful start
      managed.backoffMs = BACKOFF_INITIAL_MS
      this.emit('restarted', name)
    }
  }

  /** Get the agent ChildProcess (may be null if not running). */
  getAgentProcess(): ChildProcess | null {
    return this.processes.get('agent')?.proc ?? null
  }

  /** Get a snapshot of all process states. */
  getStates(): Record<string, ProcessState> {
    const result: Record<string, ProcessState> = {}
    for (const [name, managed] of this.processes) {
      result[name] = managed.state
    }
    return result
  }

  /** Kill a named process gracefully (SIGTERM → 3s → SIGKILL). */
  async killProcess(name: string): Promise<void> {
    const managed = this.processes.get(name)
    if (!managed?.proc) return

    managed.intentionalKill = true

    // Cancel any pending restart timer so it cannot fire after we kill the process
    if (managed.restartTimer) {
      clearTimeout(managed.restartTimer)
      managed.restartTimer = null
    }

    const proc = managed.proc

    return new Promise<void>((resolve) => {
      const forceKillTimer = setTimeout(() => {
        if (proc.exitCode === null) {
          console.log(`[process-manager] force-killing ${name} (SIGKILL)`)
          proc.kill('SIGKILL')
        }
        resolve()
      }, KILL_GRACE_MS)

      proc.once('exit', () => {
        clearTimeout(forceKillTimer)
        resolve()
      })

      proc.kill('SIGTERM')
    })
  }

  /** Kill an entire process group by pid (for tool subprocess cleanup). */
  async killProcessGroup(pid: number): Promise<void> {
    try {
      process.kill(-pid, 'SIGTERM')
      await new Promise((resolve) => setTimeout(resolve, KILL_GRACE_MS))
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        // Group already gone
      }
    } catch (err: any) {
      console.warn(`[process-manager] killProcessGroup(${pid}) failed: ${err.message}`)
    }
  }

  /** Restart a process with exponential backoff. */
  private scheduleRestart(name: string): void {
    const managed = this.processes.get(name)
    if (!managed) return

    if (managed.restartTimer) {
      clearTimeout(managed.restartTimer)
    }

    const delay = managed.backoffMs
    console.log(`[process-manager] restarting ${name} in ${delay}ms`)

    managed.restartTimer = setTimeout(() => {
      managed.restartTimer = null
      // Guard: if the process was intentionally killed while we were waiting, abort
      if (managed.intentionalKill) return
      // Double the backoff for next time, capped at max
      managed.backoffMs = Math.min(managed.backoffMs * 2, BACKOFF_MAX_MS)
      if (name === 'agent') {
        this.spawnAgent(managed.cwd)
        this.emit('agent-restarting')
      }
    }, delay)
  }

  /**
   * Spawn an arbitrary named child process (for subagents, etc.).
   * Unlike the 'agent'/'sidecar' slots, named processes do NOT auto-restart.
   * Returns the ChildProcess so the caller can attach stdio listeners.
   */
  spawnNamedProcess(
    name: string,
    cmd: string,
    args: string[],
    opts: { cwd?: string; env?: Record<string, string> } = {},
  ): import('node:child_process').ChildProcess {
    // Kill any existing process with this name first
    if (this.processes.has(name)) {
      void this.killNamed(name)
    }

    const proc = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.cwd ?? process.cwd(),
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    })

    const managed: ManagedProcess = {
      name,
      proc,
      state: 'starting',
      backoffMs: BACKOFF_INITIAL_MS,
      restartTimer: null,
      intentionalKill: false,
      cwd: opts.cwd,
      extraEnv: opts.env,
    }
    this.processes.set(name, managed)

    proc.on('spawn', () => {
      console.log(`[process-manager] named process "${name}" spawned (pid=${proc.pid})`)
      this.setState(name, 'ready')
    })

    proc.on('error', (err) => {
      console.error(`[process-manager] named process "${name}" error: ${err.message}`)
      this.setState(name, 'crashed')
      managed.proc = null
      this.emit('named-process-error', name, err)
    })

    proc.on('exit', (code, signal) => {
      console.log(`[process-manager] named process "${name}" exited (code=${code}, signal=${signal})`)
      managed.proc = null
      if (!managed.intentionalKill) {
        this.setState(name, 'crashed')
        this.emit('named-process-exit', name, code, signal)
      } else {
        this.setState(name, 'stopped')
        this.processes.delete(name)
      }
    })

    return proc
  }

  /** Kill a dynamically spawned named process and remove it from the map. */
  async killNamed(name: string): Promise<void> {
    const managed = this.processes.get(name)
    if (!managed) return
    managed.intentionalKill = true
    await this.killProcess(name)
    this.processes.delete(name)
  }

  /** Get the ChildProcess for a named process, or null if not running. */
  getNamedProcess(name: string): import('node:child_process').ChildProcess | null {
    // Only return for dynamically spawned named processes (not 'agent'/'sidecar')
    if (name === 'agent' || name === 'sidecar') return null
    return this.processes.get(name)?.proc ?? null
  }

  /** Gracefully shut down all managed processes. */
  async shutdownAll(): Promise<void> {
    console.log('[process-manager] shutting down all processes')
    const kills = Array.from(this.processes.keys()).map((name) => this.killProcess(name))
    await Promise.all(kills)
    console.log('[process-manager] all processes stopped')
  }
}
