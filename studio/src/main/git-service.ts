/**
 * GitService — git operations for the IDE file viewer.
 *
 * All methods use execFile for safety (no shell injection).
 * All failures are caught and return null / empty — never throw.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// ============================================================================
// GitService
// ============================================================================

export class GitService {
  /**
   * Resolve the git project root for a given start path.
   * Falls back to `startPath` if not in a git repository.
   */
  async getProjectRoot(startPath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['rev-parse', '--show-toplevel'],
        { cwd: startPath, timeout: 2000 },
      )
      return stdout.trim()
    } catch {
      return startPath
    }
  }

  /**
   * Get the current branch name for `rootPath`.
   * - Returns null if not a git repo or any failure occurs
   * - Returns short commit hash if in detached HEAD state
   */
  async getBranch(rootPath: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        { cwd: rootPath, timeout: 2000 },
      )
      const branch = stdout.trim()

      // Detached HEAD — return short hash instead
      if (branch === 'HEAD') {
        try {
          const { stdout: hashOut } = await execFileAsync(
            'git',
            ['rev-parse', '--short', 'HEAD'],
            { cwd: rootPath, timeout: 2000 },
          )
          return hashOut.trim() || null
        } catch {
          return null
        }
      }

      return branch || null
    } catch {
      return null
    }
  }

  /**
   * Get a list of modified/untracked file paths relative to `rootPath`.
   * Uses `git status --porcelain` and strips the 2-char status prefix.
   * Returns empty array on any failure.
   */
  async getModifiedFiles(rootPath: string): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['status', '--porcelain'],
        { cwd: rootPath, timeout: 2000 },
      )
      if (!stdout.trim()) return []

      const files: string[] = []
      for (const line of stdout.split('\n')) {
        if (!line) continue
        // Format: "XY filename" — strip first 3 chars (status + space)
        const filePath = line.slice(3).trim()
        if (filePath) {
          // Handle renamed files: "old -> new" format
          const arrowIdx = filePath.indexOf(' -> ')
          if (arrowIdx !== -1) {
            files.push(filePath.slice(arrowIdx + 4))
          } else {
            files.push(filePath)
          }
        }
      }
      return files
    } catch {
      return []
    }
  }
}
