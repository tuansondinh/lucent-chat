/**
 * FileService — secure filesystem operations for the IDE file viewer.
 *
 * All methods validate that paths stay within the declared rootPath, preventing
 * path traversal attacks and symlink escapes.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

// ============================================================================
// Types
// ============================================================================

export interface DirEntry {
  name: string
  type: 'file' | 'directory'
}

export interface ListDirectoryResult {
  entries: DirEntry[]
  truncated: boolean
}

export interface ReadFileResult {
  content: string
  size: number
  truncated: boolean
  isBinary: boolean
}

// ============================================================================
// Constants
// ============================================================================

const IGNORE_NAMES = new Set([
  '.git',
  'node_modules',
  '.DS_Store',
  '.next',
  'dist',
  'build',
  '.turbo',
])

const MAX_ENTRIES = 500
const MAX_FILE_BYTES = 1 * 1024 * 1024 // 1 MB
const BINARY_SAMPLE_SIZE = 1024
const BINARY_THRESHOLD = 0.1

// ============================================================================
// FileService
// ============================================================================

export class FileService {
  /**
   * List directory entries at `relativePath` within `rootPath`.
   * - Ignores common large/irrelevant directories
   * - Resolves symlinks and checks they stay within root
   * - Sorts: directories first, then case-insensitive alpha
   * - Caps at 500 entries
   */
  async listDirectory(rootPath: string, relativePath: string): Promise<ListDirectoryResult> {
    const rootReal = await fs.realpath(rootPath)
    const targetAbs = path.resolve(rootReal, relativePath)

    // Validate the target stays within root (without resolving symlinks yet,
    // since it may not exist — we'll re-check after readdir for each entry)
    const rel = path.relative(rootReal, targetAbs)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('Path traversal detected')
    }

    const dirents = await fs.readdir(targetAbs, { withFileTypes: true })

    const entries: DirEntry[] = []

    for (const dirent of dirents) {
      if (IGNORE_NAMES.has(dirent.name)) continue

      let entryType: 'file' | 'directory'

      if (dirent.isSymbolicLink()) {
        // Resolve symlink and check it stays within root
        try {
          const linkTarget = path.join(targetAbs, dirent.name)
          const resolvedTarget = await fs.realpath(linkTarget)
          const relResolved = path.relative(rootReal, resolvedTarget)
          // If symlink escapes root, omit silently
          if (relResolved.startsWith('..') || path.isAbsolute(relResolved)) continue
          const stat = await fs.stat(resolvedTarget)
          entryType = stat.isDirectory() ? 'directory' : 'file'
        } catch {
          // Broken symlink or resolve error — skip silently
          continue
        }
      } else if (dirent.isDirectory()) {
        entryType = 'directory'
      } else if (dirent.isFile()) {
        entryType = 'file'
      } else {
        // Skip special files (pipes, devices, etc.)
        continue
      }

      entries.push({ name: dirent.name, type: entryType })
    }

    // Sort: dirs first, then case-insensitive alpha
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    })

    if (entries.length > MAX_ENTRIES) {
      return { entries: entries.slice(0, MAX_ENTRIES), truncated: true }
    }

    return { entries, truncated: false }
  }

  /**
   * Read a file at `relativePath` within `rootPath`.
   *
   * Security steps:
   * 1. Resolve rootPath to its real path
   * 2. Compute candidate path
   * 3. Resolve candidate to its real path (catches symlink escapes)
   * 4. Verify candidate's real path is still under root's real path
   * 5. Open + read with bounded 1MB buffer (not fs.readFile which loads all)
   */
  async readFile(rootPath: string, relativePath: string): Promise<ReadFileResult> {
    // Step 1: resolve root
    const rootReal = await fs.realpath(rootPath)

    // Step 2: compute candidate
    const candidate = path.resolve(rootReal, relativePath)

    // Step 3: resolve candidate (catches symlink escapes)
    let candidateReal: string
    try {
      candidateReal = await fs.realpath(candidate)
    } catch {
      throw new Error(`File not found: ${relativePath}`)
    }

    // Step 4: verify still inside root
    const rel = path.relative(rootReal, candidateReal)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('Path traversal detected')
    }

    // Step 5: open file and read with bounded buffer
    let fd: fs.FileHandle | null = null
    try {
      fd = await fs.open(candidateReal, 'r')
      const stat = await fd.stat()
      const size = stat.size

      const readSize = Math.min(size, MAX_FILE_BYTES)
      const buffer = Buffer.allocUnsafe(readSize)

      const { bytesRead } = await fd.read(buffer, 0, readSize, 0)
      const actualBuffer = buffer.subarray(0, bytesRead)

      // Binary detection on first BINARY_SAMPLE_SIZE bytes
      const sample = actualBuffer.subarray(0, BINARY_SAMPLE_SIZE)
      if (isBinaryBuffer(sample)) {
        return {
          content: '',
          size,
          truncated: false,
          isBinary: true,
        }
      }

      const content = actualBuffer.toString('utf8')
      const truncated = size > MAX_FILE_BYTES

      return { content, size, truncated, isBinary: false }
    } finally {
      await fd?.close()
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Detect if a buffer contains binary data by checking for null bytes or
 * a high proportion of non-printable characters.
 */
function isBinaryBuffer(buf: Buffer): boolean {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) return true
  }
  let nonPrintable = 0
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]
    // Allow tab (9), newline (10), carriage return (13), printable ASCII (32-126), extended (128+)
    if (b !== 9 && b !== 10 && b !== 13 && b < 32 && b !== 27) {
      nonPrintable++
    }
  }
  return buf.length > 0 && nonPrintable / buf.length > BINARY_THRESHOLD
}
