/**
 * SessionService — owns all session operations: listing, switching, deleting,
 * renaming, and tracking the active session.
 */

import { readdir, stat, unlink, readFile, writeFile, mkdir, realpath } from 'node:fs/promises'
import { join, basename, extname, isAbsolute, relative } from 'node:path'
import { homedir } from 'node:os'
import type { AgentBridge } from './agent-bridge.js'
import type { Orchestrator } from './orchestrator.js'

// ============================================================================
// Types
// ============================================================================

export interface SessionInfo {
  path: string
  name: string
  modified: number  // timestamp ms
}

export interface FormattedMessage {
  role: 'user' | 'assistant'
  text: string
  timestamp: number
}

// ============================================================================
// SessionService
// ============================================================================

export class SessionService {
  /** Path to the file that persists the active session ID across launches. */
  private readonly activeSessionFile = join(homedir(), '.lucent', 'active-session')
  private readonly sessionsBase = join(homedir(), '.lucent', 'agent', 'sessions')

  /** In-memory cache of the current active session path. */
  private activeSessionId: string | null = null

  constructor(private agentBridge: AgentBridge) {}

  // =========================================================================
  // Session listing
  // =========================================================================

  /**
   * List all sessions on disk, sorted newest-first.
   * Reads from ~/.lucent/agent/sessions/ (and subdirectories).
   */
  async listSessions(): Promise<SessionInfo[]> {
    const sessionsBase = join(homedir(), '.lucent', 'agent', 'sessions')
    const results: SessionInfo[] = []

    async function walk(dir: string): Promise<void> {
      let entries: Awaited<ReturnType<typeof readdir>>
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(fullPath)
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          try {
            const info = await stat(fullPath)
            // Read session name from first line of JSONL (the session header record)
            let name = basename(entry.name, '.jsonl')
            try {
              const raw = await readFile(fullPath, 'utf8')
              const firstLine = raw.slice(0, raw.indexOf('\n')).trim()
              if (firstLine) {
                const header = JSON.parse(firstLine)
                if (header?.name && typeof header.name === 'string') {
                  name = header.name
                } else if (header?.timestamp && typeof header.timestamp === 'string') {
                  // Fall back to a human-readable timestamp
                  name = new Date(header.timestamp).toLocaleString()
                }
              }
            } catch {
              // Use filename stem if parsing fails
            }
            results.push({ path: fullPath, name, modified: info.mtimeMs })
          } catch {
            // Skip files we can't stat
          }
        }
      }
    }

    await walk(sessionsBase)
    // Sort newest first
    results.sort((a, b) => b.modified - a.modified)
    return results
  }

  // =========================================================================
  // Session deletion
  // =========================================================================

  /**
   * Delete a session file from disk.
   * Rejects if the requested path is the currently active session.
   */
  async deleteSession(path: string): Promise<void> {
    const validatedPath = await this.validateSessionPath(path)
    if (this.activeSessionId === validatedPath) {
      throw new Error('Cannot delete the active session — switch to another session first.')
    }
    await unlink(validatedPath)
  }

  // =========================================================================
  // Session renaming
  // =========================================================================

  /**
   * Rename the current session via the agent RPC.
   */
  async renameSession(name: string): Promise<void> {
    await this.agentBridge.setSessionName(name)
  }

  // =========================================================================
  // Session switching
  // =========================================================================

  /**
   * Switch to a different saved session.
   * 1. Aborts the current turn if generating.
   * 2. Delegates to agentBridge.switchSession(path).
   * 3. Updates the active session ID.
   */
  async switchSession(
    path: string,
    orchestrator: Orchestrator
  ): Promise<{ cancelled: boolean }> {
    const validatedPath = await this.validateSessionPath(path)
    // Abort current turn if in progress
    const currentTurn = orchestrator.getCurrentTurn()
    if (currentTurn && currentTurn.state === 'generating') {
      await orchestrator.abortCurrentTurn()
    }

    const result = await this.agentBridge.switchSession(validatedPath)
    if (!result.cancelled) {
      this.setActiveSessionId(validatedPath)
    }
    return result
  }

  // =========================================================================
  // Message history
  // =========================================================================

  /**
   * Get the message history for the current session, formatted for the renderer.
   */
  async getMessages(): Promise<FormattedMessage[]> {
    try {
      const raw = await this.agentBridge.getMessages()
      return this.formatMessages(raw)
    } catch {
      return []
    }
  }

  // =========================================================================
  // Active session tracking
  // =========================================================================

  getActiveSessionId(): string | null {
    return this.activeSessionId
  }

  setActiveSessionId(id: string): void {
    this.activeSessionId = id
    // Persist asynchronously — best-effort, no throw on failure
    const dir = join(homedir(), '.lucent')
    mkdir(dir, { recursive: true })
      .then(() => writeFile(this.activeSessionFile, id, 'utf8'))
      .catch((err: Error) => {
        console.warn('[session-service] failed to persist active session:', err.message)
      })
  }

  /**
   * Load the persisted active session ID from disk (call once at startup).
   */
  async loadActiveSessionId(): Promise<string | null> {
    try {
      const raw = await readFile(this.activeSessionFile, 'utf8')
      const id = raw.trim()
      if (id) {
        this.activeSessionId = id
        return id
      }
    } catch {
      // File may not exist yet — that's fine
    }
    return null
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  /**
   * Format raw agent messages into the renderer-friendly FormattedMessage shape.
   * Supports both string content and content-block arrays from the Anthropic SDK.
   */
  private formatMessages(raw: any[]): FormattedMessage[] {
    const result: FormattedMessage[] = []

    for (const msg of raw) {
      const role: string = msg.role ?? ''
      if (role !== 'user' && role !== 'assistant') continue

      // Extract text from content (string or block array)
      let text = ''
      if (typeof msg.content === 'string') {
        text = msg.content
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            text += block.text
          }
        }
      }

      if (!text) continue

      result.push({
        role: role as 'user' | 'assistant',
        text,
        timestamp: msg.timestamp ?? msg.created_at ?? Date.now(),
      })
    }

    return result
  }

  private async validateSessionPath(targetPath: string): Promise<string> {
    const realBase = await realpath(this.sessionsBase)
    const realTarget = await realpath(targetPath)
    const rel = relative(realBase, realTarget)

    if (rel.startsWith('..') || isAbsolute(rel) || extname(realTarget) !== '.jsonl') {
      throw new Error('Invalid session path')
    }

    return realTarget
  }
}
