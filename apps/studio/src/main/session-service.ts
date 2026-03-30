/**
 * SessionService — owns all session operations: listing, switching, deleting,
 * renaming, and tracking the active session.
 */

import { readdir, stat, unlink, readFile, writeFile, mkdir, realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename, extname, isAbsolute, relative, dirname, resolve } from 'node:path'
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
  project?: SessionProjectState | null
}

interface SessionServicePaths {
  activeSessionFile: string
  sessionsBase: string
  perProjectSessionFile: string
}

export interface SessionProjectState {
  projectRoot: string
  sessionPath: string
  sessionName?: string
  firstPrompt?: string
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
  private readonly resolvedPaths = resolveSessionPaths()
  /** Path to the file that persists the active session ID across launches. */
  private readonly activeSessionFile = this.resolvedPaths.activeSessionFile
  private readonly sessionsBase = this.resolvedPaths.sessionsBase
  private readonly perProjectSessionFile = this.resolvedPaths.perProjectSessionFile

  /** In-memory cache of the current active session path. */
  private activeSessionId: string | null = null

  /** Serializes concurrent writes to the per-project session map file. */
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private agentBridge: AgentBridge) {}

  // =========================================================================
  // Session listing
  // =========================================================================

  /**
   * List all sessions on disk, sorted newest-first.
   * Reads from the active runtime sessions directory (and subdirectories).
   */
  async listSessions(): Promise<SessionInfo[]> {
    const results: SessionInfo[] = []
    const projectMap = await this.readPerProjectSessionMap()
    const projectBySessionPath = new Map<string, SessionProjectState>()
    for (const entry of Object.values(projectMap)) {
      if (entry?.sessionPath) {
        projectBySessionPath.set(entry.sessionPath, entry)
      }
    }

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
            const project = projectBySessionPath.get(fullPath) ?? null

            // Read session name from first line of JSONL (the session header record)
            let name = basename(entry.name, '.jsonl')
            try {
              const raw = await readFile(fullPath, 'utf8')
              const firstNewline = raw.indexOf('\n')
              const firstLine = (firstNewline === -1 ? raw : raw.slice(0, firstNewline)).trim()
              if (firstLine) {
                const header = JSON.parse(firstLine)
                if (header?.name && typeof header.name === 'string') {
                  name = header.name
                } else if (project?.sessionName) {
                  name = project.sessionName
                } else if (project?.firstPrompt) {
                  name = project.firstPrompt
                } else if (header?.timestamp && typeof header.timestamp === 'string') {
                  // Fall back to a human-readable timestamp
                  name = new Date(header.timestamp).toLocaleString()
                }
              } else if (project?.sessionName) {
                name = project.sessionName
              } else if (project?.firstPrompt) {
                name = project.firstPrompt
              }
            } catch {
              if (project?.sessionName) {
                name = project.sessionName
              } else if (project?.firstPrompt) {
                name = project.firstPrompt
              }
              // Otherwise use filename stem if parsing fails
            }
            results.push({
              path: fullPath,
              name,
              modified: info.mtimeMs,
              project,
            })
          } catch {
            // Skip files we can't stat
          }
        }
      }
    }

    await walk(this.sessionsBase)
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
    const activeSessionId = await this.resolveActiveSessionPath()
    if (activeSessionId === validatedPath) {
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
    mkdir(dirname(this.activeSessionFile), { recursive: true })
      .then(() => writeFile(this.activeSessionFile, id, 'utf8'))
      .catch((err: Error) => {
        console.warn('[session-service] failed to persist active session:', err.message)
      })
  }

  setProjectSession(projectRoot: string, sessionPath: string, metadata?: { sessionName?: string | null; firstPrompt?: string | null }): void {
    const normalizedProjectRoot = normalizeProjectRoot(projectRoot)
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await mkdir(dirname(this.perProjectSessionFile), { recursive: true })
        const map = await this.readPerProjectSessionMap()
        map[normalizedProjectRoot] = {
          projectRoot: normalizedProjectRoot,
          sessionPath,
          ...(metadata?.sessionName ? { sessionName: metadata.sessionName } : {}),
          ...(metadata?.firstPrompt ? { firstPrompt: metadata.firstPrompt } : {}),
        }
        await writeFile(this.perProjectSessionFile, JSON.stringify(map, null, 2), 'utf8')
      } catch (err) {
        console.warn('[session-service] failed to persist per-project session:', (err as Error).message)
      }
    })
  }

  async getProjectSession(projectRoot: string): Promise<string | null> {
    await this.writeQueue
    const normalizedProjectRoot = normalizeProjectRoot(projectRoot)
    const map = await this.readPerProjectSessionMap()
    const entry = map[normalizedProjectRoot]
    if (!entry) return null
    return typeof entry.sessionPath === 'string' && entry.sessionPath.length > 0 ? entry.sessionPath : null
  }

  async getProjectSessionState(projectRoot: string): Promise<SessionProjectState | null> {
    await this.writeQueue
    const normalizedProjectRoot = normalizeProjectRoot(projectRoot)
    const map = await this.readPerProjectSessionMap()
    return map[normalizedProjectRoot] ?? null
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

  /**
   * Refresh the active session ID from the live agent state.
   * Safe to call after a turn completes or after the agent restarts.
   */
  async syncActiveSessionFromAgent(): Promise<string | null> {
    try {
      const state = await this.agentBridge.getState()
      const sessionFile = typeof state.sessionFile === 'string' ? state.sessionFile : null
      if (sessionFile) {
        this.setActiveSessionId(sessionFile)
      }
      return sessionFile
    } catch {
      return this.activeSessionId
    }
  }

  async syncProjectSessionFromAgent(projectRoot: string, firstPrompt?: string): Promise<string | null> {
    try {
      const state = await this.agentBridge.getState()
      const sessionFile = typeof state.sessionFile === 'string' ? state.sessionFile : null
      if (sessionFile) {
        this.setActiveSessionId(sessionFile)
        const sessionName = typeof state?.sessionName === 'string' && state.sessionName.length > 0
          ? state.sessionName
          : undefined
        this.setProjectSession(projectRoot, sessionFile, { sessionName, firstPrompt })
      }
      return sessionFile
    } catch {
      return this.activeSessionId
    }
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
    if (extname(targetPath) !== '.jsonl') {
      throw new Error('Invalid session path')
    }

    const realBase = await realpath(this.sessionsBase)
    const realTarget = await realpath(targetPath)
    const rel = relative(realBase, realTarget)

    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('Invalid session path')
    }

    return realTarget
  }

  private async readPerProjectSessionMap(): Promise<Record<string, SessionProjectState>> {
    try {
      const raw = await readFile(this.perProjectSessionFile, 'utf8')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {}
      }
      return Object.fromEntries(
        Object.entries(parsed).flatMap(([key, value]) => {
          if (typeof key !== 'string' || !key) return []
          if (typeof value === 'string' && value.length > 0) {
            return [[key, { projectRoot: key, sessionPath: value } satisfies SessionProjectState]]
          }
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return []
          }

          const entry = value as Record<string, unknown>
          if (typeof entry.sessionPath !== 'string' || entry.sessionPath.length === 0) {
            return []
          }

          const normalized: SessionProjectState = {
            projectRoot: typeof entry.projectRoot === 'string' && entry.projectRoot.length > 0 ? entry.projectRoot : key,
            sessionPath: entry.sessionPath,
          }

          if (typeof entry.sessionName === 'string' && entry.sessionName.length > 0) {
            normalized.sessionName = entry.sessionName
          }
          if (typeof entry.firstPrompt === 'string' && entry.firstPrompt.length > 0) {
            normalized.firstPrompt = entry.firstPrompt
          }

          return [[key, normalized]]
        })
      )
    } catch {
      return {}
    }
  }

  private async resolveActiveSessionPath(): Promise<string | null> {
    if (!this.activeSessionId) return null
    try {
      return await this.validateSessionPath(this.activeSessionId)
    } catch {
      return this.activeSessionId
    }
  }
}

function resolveSessionPaths(): SessionServicePaths {
  const home = homedir()
  const candidates = [
    process.env.LUCENT_CODING_AGENT_DIR,
    process.env.LUCENT_CONFIG_DIR ? join(process.env.LUCENT_CONFIG_DIR, 'agent') : undefined,
    join(home, '.lucent', 'agent'),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)

  // Use the first available config, defaulting to ~/.lucent/agent
  const agentBase = candidates[0] ?? join(home, '.lucent', 'agent')
  return {
    activeSessionFile: join(dirname(agentBase), 'active-session'),
    sessionsBase: join(agentBase, 'sessions'),
    perProjectSessionFile: join(dirname(agentBase), 'last-session-by-project.json'),
  }
}

function normalizeProjectRoot(projectRoot: string): string {
  return resolve(projectRoot)
}
