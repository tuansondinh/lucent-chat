/**
 * GitService — git operations for the IDE file viewer.
 *
 * All methods use execFile for safety (no shell injection).
 * Read-only helpers return null / empty on failure.
 * Mutating git commands throw concrete error messages for the UI.
 */

import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 4_000

export type GitChangeStatus = 'M' | 'A' | 'D' | 'R' | '??' | 'U'

export interface GitChangedFile {
  path: string
  status: GitChangeStatus
  previousPath?: string
}

export interface GitFileDiff {
  path: string
  status: GitChangeStatus
  previousPath?: string
  isBinary: boolean
  diffText: string | null
}

function getExecErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'Git command failed'
  }

  const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : ''
  if (stderr) return stderr

  const stdout = 'stdout' in error && typeof error.stdout === 'string' ? error.stdout.trim() : ''
  if (stdout) return stdout

  const message = 'message' in error && typeof error.message === 'string' ? error.message.trim() : ''
  return message || 'Git command failed'
}

function normalizeGitPath(rawPath: string): string {
  return rawPath.replace(/\\/g, '/')
}

function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

function projectRelativePath(rootPath: string, repoRoot: string): string {
  const rel = normalizeGitPath(relative(canonicalPath(repoRoot), canonicalPath(rootPath)))
  return rel === '.' ? '' : rel
}

function toRepoRelativePath(rootPath: string, repoRoot: string, inputPath: string): string {
  const normalized = normalizeGitPath(inputPath.trim()).replace(/^\.\/+/, '')
  const projectPrefix = projectRelativePath(rootPath, repoRoot)
  if (!projectPrefix) return normalized
  if (normalized === projectPrefix || normalized.startsWith(`${projectPrefix}/`)) {
    return normalized
  }
  return normalizeGitPath(join(projectPrefix, normalized))
}

function pathWithinProject(repoRelativePath: string, rootPath: string, repoRoot: string): boolean {
  const projectPrefix = projectRelativePath(rootPath, repoRoot)
  if (!projectPrefix) return true
  return repoRelativePath === projectPrefix || repoRelativePath.startsWith(`${projectPrefix}/`)
}

function mapStatusCode(code: string): GitChangeStatus {
  if (code === '??') return '??'
  if (code.includes('U')) return 'U'
  if (code.includes('R') || code === 'RM' || code === 'MR') return 'R'
  if (code.includes('A')) return 'A'
  if (code.includes('D')) return 'D'
  return 'M'
}

function parsePorcelainLine(line: string): GitChangedFile | null {
  if (!line) return null
  const statusCode = line.slice(0, 2)
  const rest = line.slice(3).trim()
  if (!rest) return null

  if (statusCode === '??') {
    return {
      path: normalizeGitPath(rest),
      status: '??',
    }
  }

  const renameIndex = rest.indexOf(' -> ')
  if (renameIndex !== -1) {
    return {
      path: normalizeGitPath(rest.slice(renameIndex + 4)),
      previousPath: normalizeGitPath(rest.slice(0, renameIndex)),
      status: 'R',
    }
  }

  return {
    path: normalizeGitPath(rest),
    status: mapStatusCode(statusCode),
  }
}

async function tryGitCommand(rootPath: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: rootPath,
      timeout: GIT_TIMEOUT_MS,
    })
    return { stdout, stderr, exitCode: 0 }
  } catch (error) {
    const stdout = typeof error === 'object' && error && 'stdout' in error && typeof error.stdout === 'string'
      ? error.stdout
      : ''
    const stderr = typeof error === 'object' && error && 'stderr' in error && typeof error.stderr === 'string'
      ? error.stderr
      : ''
    const exitCode = typeof error === 'object' && error && 'code' in error && typeof error.code === 'number'
      ? error.code
      : 1
    return { stdout, stderr, exitCode }
  }
}

async function buildFallbackTrackedDiff(rootPath: string, file: GitChangedFile): Promise<{ diffText: string | null; isBinary: boolean }> {
  const tempDir = await mkdtemp(join(tmpdir(), 'lucent-diff-'))
  const oldFilePath = join(tempDir, 'old')
  try {
    const oldBlob = await tryGitCommand(rootPath, ['show', `HEAD:${file.previousPath ?? file.path}`])
    if (oldBlob.exitCode !== 0) {
      return { diffText: null, isBinary: false }
    }

    await writeFile(oldFilePath, oldBlob.stdout, 'utf8')

    const diffArgs = file.status === 'D'
      ? ['diff', '--no-index', '--', oldFilePath, '/dev/null']
      : ['diff', '--no-index', '--', oldFilePath, join(rootPath, file.path)]
    const result = await tryGitCommand(rootPath, diffArgs)
    const combined = `${result.stdout}\n${result.stderr}`
    return {
      diffText: result.stdout.trim().length > 0 ? result.stdout : null,
      isBinary: /GIT binary patch|Binary files .* differ/.test(combined),
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

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
        { cwd: startPath, timeout: GIT_TIMEOUT_MS },
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
        { cwd: rootPath, timeout: GIT_TIMEOUT_MS },
      )
      const branch = stdout.trim()

      // Detached HEAD — return short hash instead
      if (branch === 'HEAD') {
        try {
          const { stdout: hashOut } = await execFileAsync(
            'git',
            ['rev-parse', '--short', 'HEAD'],
            { cwd: rootPath, timeout: GIT_TIMEOUT_MS },
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
   * List local branches for `rootPath`.
   * - Returns empty list and null current branch on any failure
   * - Includes the current branch even if detached or otherwise absent
   */
  async listBranches(rootPath: string): Promise<{ current: string | null; branches: string[] }> {
    const current = await this.getBranch(rootPath)

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['for-each-ref', '--format=%(refname:short)', 'refs/heads'],
        { cwd: rootPath, timeout: GIT_TIMEOUT_MS },
      )

      const uniqueBranches = new Set(
        stdout
          .split('\n')
          .map((branch) => branch.trim())
          .filter(Boolean),
      )

      if (current) {
        uniqueBranches.add(current)
      }

      return {
        current,
        branches: Array.from(uniqueBranches).sort((a, b) => a.localeCompare(b)),
      }
    } catch {
      return {
        current,
        branches: current ? [current] : [],
      }
    }
  }

  /**
   * Switch to a local branch for `rootPath`.
   * - Returns the resulting branch on success
   * - Throws with the underlying git error message on failure
   */
  async checkoutBranch(rootPath: string, branch: string): Promise<string | null> {
    const trimmedBranch = branch.trim()
    if (!trimmedBranch) {
      throw new Error('Branch name is required')
    }

    try {
      await execFileAsync(
        'git',
        ['switch', '--', trimmedBranch],
        { cwd: rootPath, timeout: 10_000 },
      )
    } catch (switchError) {
      try {
        await execFileAsync(
        'git',
        ['checkout', '--', trimmedBranch],
          { cwd: rootPath, timeout: 10_000 },
        )
      } catch (checkoutError) {
        const checkoutMessage = getExecErrorMessage(checkoutError)
        const switchMessage = getExecErrorMessage(switchError)
        throw new Error(checkoutMessage && checkoutMessage !== switchMessage ? checkoutMessage : switchMessage)
      }
    }

    const nextBranch = await this.getBranch(rootPath)
    if (!nextBranch) {
      throw new Error(`Switched branches, but could not resolve the current branch for ${trimmedBranch}`)
    }
    return nextBranch
  }

  /**
   * Get changed files relative to `rootPath`.
   * Uses porcelain output so the renderer can show status-aware UI.
   * Returns empty array on any failure.
   */
  async getChangedFiles(rootPath: string): Promise<GitChangedFile[]> {
    try {
      const repoRoot = await this.getProjectRoot(rootPath)
      const { stdout } = await execFileAsync(
        'git',
        ['status', '--porcelain=v1', '--untracked-files=all'],
        { cwd: repoRoot, timeout: GIT_TIMEOUT_MS },
      )
      if (!stdout.trim()) return []

      return stdout
        .split('\n')
        .map((line) => parsePorcelainLine(line))
        .filter((file) => file === null || pathWithinProject(file.path, rootPath, repoRoot))
        .filter((file): file is GitChangedFile => file !== null)
    } catch {
      return []
    }
  }

  /**
   * Get a list of modified/untracked file paths relative to `rootPath`.
   * Returns empty array on any failure.
   */
  async getModifiedFiles(rootPath: string): Promise<string[]> {
    const files = await this.getChangedFiles(rootPath)
    return files.map((file) => file.path)
  }

  /**
   * Load a unified diff against HEAD for a single file.
   * Untracked files are diffed against /dev/null.
   */
  async getFileDiff(rootPath: string, relativePath: string): Promise<GitFileDiff | null> {
    const repoRoot = await this.getProjectRoot(rootPath)
    const normalizedPath = toRepoRelativePath(rootPath, repoRoot, relativePath)
    if (!normalizedPath) return null

    const changedFiles = await this.getChangedFiles(rootPath)
    const match = changedFiles.find((file) => file.path === normalizedPath)
    const inferredMatch: GitChangedFile = match ?? {
      path: normalizedPath,
      status: 'M',
    }

    const diffArgs = inferredMatch.status === '??'
      ? ['diff', '--no-index', '--', '/dev/null', normalizedPath]
      : ['diff', '--find-renames', 'HEAD', '--', normalizedPath]
    const result = await tryGitCommand(repoRoot, diffArgs)
    const combined = `${result.stdout}\n${result.stderr}`
    let diffText = result.stdout.trim().length > 0 ? result.stdout : null
    let isBinary = /GIT binary patch|Binary files .* differ/.test(combined)

    if (!diffText && !isBinary && inferredMatch.status !== '??') {
      const worktreeResult = await tryGitCommand(repoRoot, ['diff', '--', normalizedPath])
      diffText = worktreeResult.stdout.trim().length > 0 ? worktreeResult.stdout : diffText
      isBinary = isBinary || /GIT binary patch|Binary files .* differ/.test(`${worktreeResult.stdout}\n${worktreeResult.stderr}`)
    }

    if (!diffText && !isBinary && inferredMatch.status !== '??') {
      const fallback = await buildFallbackTrackedDiff(repoRoot, inferredMatch)
      diffText = fallback.diffText
      isBinary = fallback.isBinary
    }

    if (diffText || isBinary) {
      return {
        path: inferredMatch.path,
        status: inferredMatch.status,
        previousPath: inferredMatch.previousPath,
        diffText,
        isBinary,
      }
    }

    return null
  }
}
