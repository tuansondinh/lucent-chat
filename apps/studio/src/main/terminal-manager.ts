/**
 * TerminalManager — manages node-pty pseudo-terminal processes.
 *
 * Each terminal is identified by a string id. The manager spawns a pty for
 * each id, forwards output via the provided `onData` callback, and exposes
 * write/resize/destroy helpers for IPC handlers to use.
 */

import { createRequire } from 'node:module'
import type { IPty } from 'node-pty'

/** Callback invoked whenever a terminal produces output. */
type DataCallback = (id: string, data: string) => void

const require = createRequire(import.meta.url)

export class TerminalManager {
  private readonly terminals = new Map<string, IPty>()
  private readonly onData: DataCallback

  constructor(onData: DataCallback) {
    this.onData = onData
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Spawn a new pty process for the given terminal id.
   * If a terminal with that id already exists it is destroyed first.
   */
  create(id: string): void {
    // Destroy any existing terminal with the same id
    this.destroy(id)

    // Load the native module lazily so bundling stays predictable while
    // remaining compatible with the ESM test/runtime environment.
    const pty = require('node-pty') as typeof import('node-pty')

    const shell = process.env.SHELL ?? '/bin/zsh'
    const term = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.env.HOME ?? process.cwd(),
      env: process.env as Record<string, string>,
    })

    term.onData((data: string) => {
      this.onData(id, data)
    })

    term.onExit(() => {
      // Remove from map when the process exits on its own
      this.terminals.delete(id)
    })

    this.terminals.set(id, term)
    console.log(`[terminal] created terminal id=${id} pid=${term.pid}`)
  }

  /**
   * Write raw data (keyboard input) to a terminal's stdin.
   */
  write(id: string, data: string): void {
    let term = this.terminals.get(id)
    if (!term) {
      this.create(id)
      term = this.terminals.get(id)
      if (!term) {
        console.warn(`[terminal] write: failed to create terminal id=${id}`)
        return
      }
    }
    term.write(data)
  }

  /**
   * Resize a terminal's pty.
   */
  resize(id: string, cols: number, rows: number): void {
    let term = this.terminals.get(id)
    if (!term) {
      this.create(id)
      term = this.terminals.get(id)
      if (!term) return
    }
    term.resize(cols, rows)
  }

  /**
   * Kill a specific terminal process.
   */
  destroy(id: string): void {
    const term = this.terminals.get(id)
    if (!term) return
    try {
      term.kill()
    } catch {
      // Process may have already exited
    }
    this.terminals.delete(id)
    console.log(`[terminal] destroyed terminal id=${id}`)
  }

  /**
   * Kill all terminal processes. Called on app shutdown.
   */
  destroyAll(): void {
    for (const id of this.terminals.keys()) {
      this.destroy(id)
    }
  }
}
