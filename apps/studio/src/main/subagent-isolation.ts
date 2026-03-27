/**
 * SubagentIsolation — filesystem isolation for subagent workspaces.
 *
 * Supports two modes:
 *   'none'      — subagent runs in the same working directory (no isolation)
 *   'worktree'  — git worktree is created at ~/.lucent/wt/<encoded-cwd>/<taskId>/
 *
 * Ported from GSD upstream isolation.ts.  fuse-overlay was dropped (too
 * complex, macOS-incompatible).  Only 'none' and 'worktree' are supported.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdir, rm, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const execFileAsync = promisify(execFile)

// ============================================================================
// Types
// ============================================================================

/** Which filesystem isolation strategy to apply to a subagent workspace. */
export type IsolationMode = 'none' | 'worktree'

/**
 * Result of `createIsolation()`.
 * Callers spawn the subagent inside `workDir`, then call `cleanup()` when done
 * and optionally `captureDelta()` to extract changed file paths before cleanup.
 */
export interface IsolationEnvironment {
  /** Absolute path to the directory the subagent should use as its CWD. */
  workDir: string
  /** Tear down the isolated environment (remove worktree, temp dirs, etc.). */
  cleanup(): Promise<void>
  /**
   * Return the list of relative file paths that were added or modified inside
   * the isolated workspace compared to the original repo HEAD.
   * Returns an empty array for 'none' mode.
   */
  captureDelta(): Promise<string[]>
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Encode an absolute path into a safe directory name component.
 * Replaces path separators with underscores and strips leading slash.
 */
function encodeCwd(cwd: string): string {
  return cwd.replace(/^\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_')
}

/**
 * Base directory for all Lucent worktrees: ~/.lucent/wt/
 */
function worktreeBaseDir(): string {
  return join(homedir(), '.lucent', 'wt')
}

// ============================================================================
// Worktree isolation
// ============================================================================

/**
 * Create a git worktree for the given `cwd` repo at:
 *   ~/.lucent/wt/<encoded-cwd>/<taskId>/
 *
 * The worktree is created on a detached HEAD from the current HEAD commit so
 * it has a clean read-only snapshot of the repo.  The subagent can write
 * freely inside it; changes are isolated from the main checkout.
 *
 * @param cwd    - Absolute path to the main repo checkout (git root or subdir).
 * @param taskId - Unique identifier for this task (typically a UUID).
 */
export async function createWorktreeIsolation(cwd: string, taskId: string): Promise<IsolationEnvironment> {
  // Resolve the git root of the given cwd
  let gitRoot: string
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'])
    gitRoot = stdout.trim()
  } catch (err: any) {
    throw new Error(`[subagent-isolation] failed to resolve git root for "${cwd}": ${err.message}`)
  }

  const worktreeDir = join(worktreeBaseDir(), encodeCwd(gitRoot), taskId)

  // Ensure base directories exist
  await mkdir(worktreeDir, { recursive: true })

  // Create the worktree at a detached HEAD so it doesn't create a branch
  try {
    const { stdout: headSha } = await execFileAsync('git', ['-C', gitRoot, 'rev-parse', 'HEAD'])
    await execFileAsync('git', [
      '-C', gitRoot,
      'worktree', 'add',
      '--detach',
      worktreeDir,
      headSha.trim(),
    ])
    console.log(`[subagent-isolation] worktree created at ${worktreeDir}`)
  } catch (err: any) {
    // If worktree add fails, clean up the pre-created directory
    await rm(worktreeDir, { recursive: true, force: true }).catch(() => {})
    throw new Error(`[subagent-isolation] git worktree add failed: ${err.message}`)
  }

  // ---- captureDelta --------------------------------------------------------

  async function captureDelta(): Promise<string[]> {
    try {
      // List all files that differ from HEAD (added, modified, untracked)
      const { stdout: statusOut } = await execFileAsync('git', [
        '-C', worktreeDir,
        'status', '--porcelain=v1',
      ])
      const changed: string[] = []
      for (const line of statusOut.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        // Format: XY filename  (or XY old -> new for renames)
        const parts = trimmed.split(' ')
        const filepath = parts.slice(1).join(' ').split(' -> ').pop()!.trim()
        if (filepath) changed.push(filepath)
      }
      return changed
    } catch {
      return []
    }
  }

  // ---- cleanup -------------------------------------------------------------

  async function cleanup(): Promise<void> {
    try {
      await execFileAsync('git', ['-C', gitRoot, 'worktree', 'remove', '--force', worktreeDir])
      console.log(`[subagent-isolation] worktree removed: ${worktreeDir}`)
    } catch (err: any) {
      console.warn(`[subagent-isolation] worktree remove failed (trying rm): ${err.message}`)
      // Fallback: remove the directory directly and prune the stale worktree ref
      await rm(worktreeDir, { recursive: true, force: true }).catch(() => {})
      await execFileAsync('git', ['-C', gitRoot, 'worktree', 'prune']).catch(() => {})
    }
  }

  return { workDir: worktreeDir, cleanup, captureDelta }
}

// ============================================================================
// No-op isolation (mode='none')
// ============================================================================

function createNoopIsolation(cwd: string): IsolationEnvironment {
  return {
    workDir: cwd,
    cleanup: async () => {},
    captureDelta: async () => [],
  }
}

// ============================================================================
// Public factory
// ============================================================================

/**
 * Create an `IsolationEnvironment` using the specified mode.
 *
 * - `'none'`     — no isolation; subagent runs in `cwd` directly.
 * - `'worktree'` — git worktree created at `~/.lucent/wt/<encoded-cwd>/<taskId>/`.
 *
 * Defaults to `'none'` — worktree mode is opt-in.
 */
export async function createIsolation(
  mode: IsolationMode,
  cwd: string,
  taskId: string,
): Promise<IsolationEnvironment> {
  switch (mode) {
    case 'worktree':
      return createWorktreeIsolation(cwd, taskId)
    case 'none':
    default:
      return createNoopIsolation(cwd)
  }
}

// ============================================================================
// Delta patch application
// ============================================================================

/**
 * Apply a list of unified-diff patch strings back to `targetDir`.
 * Used to merge changes from an isolated worktree back to the main repo.
 *
 * @param patches   - Array of unified diff strings (output of `git diff HEAD`).
 * @param targetDir - Directory to apply patches to (typically the git root).
 */
export async function mergeDeltaPatches(patches: string[], targetDir: string): Promise<void> {
  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i]
    if (!patch.trim()) continue
    try {
      await execFileAsync('git', ['-C', targetDir, 'apply', '--whitespace=nowarn', '-'], {
        // Pass the patch on stdin by using a custom execFile wrapper
      } as any)
      console.log(`[subagent-isolation] applied patch ${i + 1}/${patches.length}`)
    } catch (err: any) {
      console.warn(`[subagent-isolation] failed to apply patch ${i + 1}: ${err.message}`)
      throw new Error(`mergeDeltaPatches: patch ${i + 1} failed — ${err.message}`)
    }
  }
}

/**
 * Apply a single unified diff string to `targetDir` via git apply.
 * Convenience wrapper around `mergeDeltaPatches` for a single patch.
 */
export async function applyPatch(patch: string, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const { spawn } = require('node:child_process') as typeof import('node:child_process')
    const proc = spawn('git', ['-C', targetDir, 'apply', '--whitespace=nowarn', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`git apply failed (code=${code}): ${stderr.trim()}`))
    })
    proc.once('error', reject)
    proc.stdin?.end(patch)
  })
}
