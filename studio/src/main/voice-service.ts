/**
 * VoiceService — manages the Python audio service sidecar process.
 *
 * Lifecycle:
 *   1. probe()  — detects Python runtime and voice_bridge package availability
 *   2. start()  — spawns audio_service.py, resolves with port when ready
 *   3. stop()   — gracefully terminates the sidecar
 *
 * Emits 'status' event whenever state changes, so callers can push updates
 * to the renderer without polling.
 */

import path from 'node:path'
import { ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'

type VoiceSidecarState = 'unavailable' | 'stopped' | 'starting' | 'ready' | 'error'

interface VoiceServiceStatus {
  available: boolean
  state: VoiceSidecarState
  port: number | null
  token: string | null
  reason?: string
}

export class VoiceService extends EventEmitter {
  private proc: ChildProcess | null = null
  private port: number | null = null
  private state: VoiceSidecarState = 'stopped'
  private reason: string | undefined
  private startPromise: Promise<{ port: number; token: string }> | null = null
  private pythonCmd: string | null = null
  private audioServicePath: string | null = null
  private voiceBridgePath: string | null = null
  private startupTimeoutMs = 300_000
  private intentionalStop = false
  private restartTimer: NodeJS.Timeout | null = null
  private authToken: string | null = null

  constructor(private resolveProjectRoot: () => string) {
    super()
  }

  /** Probe Python availability and voice_bridge package. Returns true if voice is usable. */
  async probe(): Promise<{ available: boolean; reason?: string }> {
    // Resolve audio service path
    const root = this.resolveProjectRoot()
    const servicePath = path.join(root, 'studio', 'audio-service', 'audio_service.py')
    if (!existsSync(servicePath)) {
      this.state = 'unavailable'
      this.reason = 'audio_service.py not found — ensure studio/audio-service/ exists'
      this.emitStatus()
      return { available: false, reason: this.reason }
    }
    this.audioServicePath = servicePath

    // Resolve voice-bridge package path (for sys.path injection)
    const defaultVbPath = path.join(root, '..', 'voice-bridge')
    this.voiceBridgePath = existsSync(defaultVbPath) ? path.resolve(defaultVbPath) : null

    // Try python runtimes in order
    const candidates = ['uv', 'python3', 'python']
    for (const cmd of candidates) {
      try {
        const version = await runCommand(cmd, this.getVersionArgs(cmd))
        if (version) {
          // Check the actual audio-service import surface, not just voice_bridge.
          const importArgs = cmd === 'uv'
            ? this.getUvPythonArgs(['-c', 'import numpy, uvicorn, fastapi, voice_bridge; print("OK")'])
            : ['-c', 'import numpy, uvicorn, fastapi, voice_bridge; print("OK")']

          const env: Record<string, string> = { ...(process.env as Record<string, string>) }
          if (this.voiceBridgePath) env.VOICE_BRIDGE_PATH = this.voiceBridgePath

          const result = await runCommandWithEnv(cmd, importArgs, env, this.getPythonWorkingDirectory(cmd))
          if (result.includes('OK')) {
            this.pythonCmd = cmd
            this.state = 'stopped'
            this.reason = undefined
            this.emitStatus()
            return { available: true }
          } else {
            this.state = 'unavailable'
            this.reason = 'Voice Python dependencies are missing — install numpy, uvicorn, fastapi, and voice_bridge'
            this.emitStatus()
            return {
              available: false,
              reason: this.reason,
            }
          }
        }
      } catch (error) {
        this.reason = normalizeProbeError(error)
        // try next
      }
    }

    this.state = 'unavailable'
    if (!this.reason) {
      this.reason = 'Python not found — install Python 3.12+ and try again'
    }
    this.emitStatus()
    return { available: false, reason: this.reason }
  }

  /** Start the audio service sidecar. Resolves with port when ready. */
  async start(): Promise<{ port: number; token: string }> {
    if (this.state === 'ready' && this.port !== null) {
      if (!this.authToken) {
        throw new Error('Voice sidecar token missing')
      }
      return { port: this.port, token: this.authToken }
    }
    if (this.startPromise) {
      return this.startPromise
    }
    if (this.state === 'unavailable') {
      throw new Error('Voice sidecar unavailable — run probe() first')
    }
    if (!this.pythonCmd || !this.audioServicePath) {
      // Try probe first
      const probe = await this.probe()
      if (!probe.available) throw new Error(probe.reason ?? 'Voice unavailable')
    }

    this.intentionalStop = false
    this.state = 'starting'
    this.reason = undefined
    this.emitStatus()

    this.startPromise = new Promise((resolve, reject) => {
      const env: NodeJS.ProcessEnv = { ...process.env }
      if (this.voiceBridgePath) env.VOICE_BRIDGE_PATH = this.voiceBridgePath!
      const authToken = randomBytes(32).toString('hex')
      env.VOICE_SERVICE_TOKEN = authToken
      this.authToken = authToken

      // Spawn: for 'uv' use ['run', 'python', servicePath], otherwise [servicePath]
      let cmd: string
      let args: string[]
      if (this.pythonCmd === 'uv') {
        cmd = 'uv'
        args = this.getUvPythonArgs([this.audioServicePath!])
      } else {
        cmd = this.pythonCmd!
        args = [this.audioServicePath!]
      }

      const proc = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        cwd: this.getPythonWorkingDirectory(cmd),
      })

      this.proc = proc

      // Forward stderr to console with prefix
      proc.stderr?.on('data', (chunk: Buffer) => {
        const lines = chunk.toString('utf8').split('\n')
        for (const line of lines) {
          if (line.trim()) console.log('[voice-sidecar]', line)
        }
      })

      let stdoutBuf = ''
      const timeout = setTimeout(() => {
        this.reason = 'Voice sidecar startup timeout (5 min) — model loading may have failed'
        this.startPromise = null
        reject(new Error(this.reason))
        this.state = 'error'
        this.emitStatus()
        proc.kill('SIGKILL')
      }, this.startupTimeoutMs)

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString('utf8')
        const lines = stdoutBuf.split('\n')
        stdoutBuf = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith('VOICE_SERVICE_READY port=')) {
            const port = parseInt(trimmed.split('=')[1], 10)
            clearTimeout(timeout)
            this.port = port
            this.startPromise = null
            this.state = 'ready'
            this.emitStatus()
            resolve({ port, token: authToken })
          } else if (trimmed.startsWith('VOICE_SERVICE_ERROR ')) {
            clearTimeout(timeout)
            const msg = trimmed.slice('VOICE_SERVICE_ERROR '.length)
            this.reason = msg
            this.startPromise = null
            this.state = 'error'
            this.emitStatus()
            reject(new Error(`Voice sidecar error: ${msg}`))
          }
        }
      })

      proc.once('exit', (code, signal) => {
        clearTimeout(timeout)
        const wasReady = this.state === 'ready'
        this.port = null
        this.authToken = null
        this.proc = null
        this.startPromise = null

        if (!this.intentionalStop) {
          console.warn(`[voice-service] sidecar exited unexpectedly (code=${code}, signal=${signal})`)
          if (!this.reason) {
            this.reason = `Voice sidecar exited unexpectedly (code=${code}, signal=${signal})`
          }
          this.state = 'error'
          this.emitStatus()
          if (wasReady) {
            // Schedule restart after 2s backoff
            this.restartTimer = setTimeout(() => {
              this.start().catch((err: Error) => {
                console.error('[voice-service] restart failed:', err.message)
              })
            }, 2_000)
          }
        } else {
          this.state = 'stopped'
          this.emitStatus()
        }
      })
    })

    return this.startPromise
  }

  /** Stop the sidecar gracefully. */
  async stop(): Promise<void> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.intentionalStop = true
    this.startPromise = null
    if (!this.proc) return
    this.proc.kill('SIGTERM')
    // Give 3s to exit gracefully then SIGKILL
    await new Promise<void>((resolve) => {
      const killer = setTimeout(() => {
        this.proc?.kill('SIGKILL')
        resolve()
      }, 3_000)
      this.proc!.once('exit', () => {
        clearTimeout(killer)
        resolve()
      })
    })
    this.port = null
    this.authToken = null
    this.state = 'stopped'
    this.reason = undefined
    this.emitStatus()
  }

  /** Get the current voice service status snapshot. */
  getStatus(): VoiceServiceStatus {
    return {
      available: this.state !== 'unavailable' && this.reason === undefined,
      state: this.state,
      port: this.port,
      token: this.authToken,
      reason: this.reason,
    }
  }

  private emitStatus(): void {
    this.emit('status', this.getStatus())
  }

  private getVersionArgs(cmd: string): string[] {
    return cmd === 'uv' ? ['--version'] : ['--version']
  }

  private getUvPythonArgs(pythonArgs: string[]): string[] {
    const args = ['run']
    if (this.voiceBridgePath) {
      args.push('--project', this.voiceBridgePath)
    }
    args.push('python', ...pythonArgs)
    return args
  }

  private getPythonWorkingDirectory(cmd: string): string | undefined {
    if (cmd === 'uv' && this.voiceBridgePath) {
      return this.voiceBridgePath
    }
    return undefined
  }
}

function normalizeProbeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes("No module named 'numpy'")) {
    return 'Python dependency missing: numpy'
  }
  if (message.includes("No module named 'uvicorn'")) {
    return 'Python dependency missing: uvicorn'
  }
  if (message.includes("No module named 'fastapi'")) {
    return 'Python dependency missing: fastapi'
  }
  if (message.includes("No module named 'voice_bridge'")) {
    return 'Python dependency missing: voice_bridge'
  }
  return message
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a command and return stdout (trimmed). Rejects on non-zero exit. */
function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5_000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout.trim())
    })
  })
}

/** Run a command with a custom env and return stdout (trimmed). */
function runCommandWithEnv(cmd: string, args: string[], env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10_000, env }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout.trim())
    })
  })
}
