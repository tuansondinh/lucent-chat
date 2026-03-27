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

type VoiceSidecarState = 'unavailable' | 'stopped' | 'starting' | 'ready' | 'error'

interface VoiceServiceStatus {
  available: boolean
  state: VoiceSidecarState
  port: number | null
  reason?: string
}

export class VoiceService extends EventEmitter {
  private proc: ChildProcess | null = null
  private port: number | null = null
  private state: VoiceSidecarState = 'stopped'
  private pythonCmd: string | null = null
  private audioServicePath: string | null = null
  private voiceBridgePath: string | null = null
  private startupTimeoutMs = 60_000
  private intentionalStop = false
  private restartTimer: NodeJS.Timeout | null = null

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
      return { available: false, reason: 'audio_service.py not found — ensure studio/audio-service/ exists' }
    }
    this.audioServicePath = servicePath

    // Resolve voice-bridge package path (for sys.path injection)
    const defaultVbPath = path.join(root, '..', 'voice-bridge')
    this.voiceBridgePath = existsSync(defaultVbPath) ? path.resolve(defaultVbPath) : null

    // Try python runtimes in order
    const candidates = ['uv', 'python3', 'python']
    for (const cmd of candidates) {
      try {
        const version = await runCommand(cmd, cmd === 'uv' ? ['python', '--version'] : ['--version'])
        if (version) {
          // Check voice_bridge importable
          const importArgs = cmd === 'uv'
            ? ['run', 'python', '-c', 'import voice_bridge; print("OK")']
            : ['-c', 'import voice_bridge; print("OK")']

          const env: Record<string, string> = { ...(process.env as Record<string, string>) }
          if (this.voiceBridgePath) env.VOICE_BRIDGE_PATH = this.voiceBridgePath

          const result = await runCommandWithEnv(cmd, importArgs, env)
          if (result.includes('OK')) {
            this.pythonCmd = cmd
            this.state = 'stopped'
            return { available: true }
          } else {
            return {
              available: false,
              reason: 'voice_bridge package not importable — run: pip install -e <voice-bridge-path>',
            }
          }
        }
      } catch {
        // try next
      }
    }

    this.state = 'unavailable'
    return { available: false, reason: 'Python not found — install Python 3.12+ and try again' }
  }

  /** Start the audio service sidecar. Resolves with port when ready. */
  async start(): Promise<{ port: number }> {
    if (this.state === 'ready' && this.port !== null) {
      return { port: this.port }
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
    this.emitStatus()

    return new Promise((resolve, reject) => {
      const env: NodeJS.ProcessEnv = { ...process.env }
      if (this.voiceBridgePath) env.VOICE_BRIDGE_PATH = this.voiceBridgePath!

      // Spawn: for 'uv' use ['run', 'python', servicePath], otherwise [servicePath]
      let cmd: string
      let args: string[]
      if (this.pythonCmd === 'uv') {
        cmd = 'uv'
        args = ['run', 'python', this.audioServicePath!]
      } else {
        cmd = this.pythonCmd!
        args = [this.audioServicePath!]
      }

      const proc = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
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
        reject(new Error('Voice sidecar startup timeout (60s) — model loading may have failed'))
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
            this.state = 'ready'
            this.emitStatus()
            resolve({ port })
          } else if (trimmed.startsWith('VOICE_SERVICE_ERROR ')) {
            clearTimeout(timeout)
            const msg = trimmed.slice('VOICE_SERVICE_ERROR '.length)
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
        this.proc = null

        if (!this.intentionalStop) {
          console.warn(`[voice-service] sidecar exited unexpectedly (code=${code}, signal=${signal})`)
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
  }

  /** Stop the sidecar gracefully. */
  async stop(): Promise<void> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.intentionalStop = true
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
    this.state = 'stopped'
    this.emitStatus()
  }

  /** Get the current voice service status snapshot. */
  getStatus(): VoiceServiceStatus {
    return {
      available: this.state !== 'unavailable',
      state: this.state,
      port: this.port,
    }
  }

  private emitStatus(): void {
    this.emit('status', this.getStatus())
  }
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
