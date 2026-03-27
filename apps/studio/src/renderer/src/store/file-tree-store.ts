/**
 * file-tree-store — per-pane file tree state factory.
 *
 * Tracks expanded directories, cached directory listings, git-modified files,
 * and in-flight loading state for a single pane's explorer panel.
 *
 * Pattern mirrors pane-store.ts: module-level Map registry with
 * getFileTreeStore / deleteFileTreeStore factory functions.
 */

import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { GitChangedFile } from '../../../preload'

// ============================================================================
// Types
// ============================================================================

export interface DirEntry {
  name: string
  type: 'file' | 'directory'
}

interface FileTreeState {
  paneId: string
  /** Relative paths of directories that are currently expanded. */
  expandedDirs: Set<string>
  /** Cached directory listings keyed by relative path. */
  dirContents: Map<string, DirEntry[]>
  /** Files with uncommitted changes plus status metadata. */
  changedFiles: GitChangedFile[]
  /** Fast lookup for changed files by relative path. */
  changedFilesMap: Map<string, GitChangedFile>
  /** Relative paths of directories currently being fetched. */
  loading: Set<string>

  /** Toggle a directory open/closed, fetching its contents if expanding. */
  toggleDir: (relativePath: string) => Promise<void>
  /** Re-fetch a directory (defaults to root ''). Clears cache for that path. */
  refreshDir: (relativePath?: string) => Promise<void>
  /** Re-fetch root plus all currently expanded directories. */
  refreshVisibleDirs: () => Promise<void>
  /** Re-fetch git-modified files list. */
  refreshModifiedFiles: () => Promise<void>
}

export type FileTreeStore = UseBoundStore<StoreApi<FileTreeState>>

// ============================================================================
// Store factory
// ============================================================================

function createFileTreeStore(paneId: string): FileTreeStore {
  return create<FileTreeState>((set, get) => ({
    paneId,
    expandedDirs: new Set<string>(),
    dirContents: new Map<string, DirEntry[]>(),
    changedFiles: [],
    changedFilesMap: new Map<string, GitChangedFile>(),
    loading: new Set<string>(),

    toggleDir: async (relativePath: string) => {
      const { expandedDirs, loading } = get()

      // Collapse if already expanded
      if (expandedDirs.has(relativePath)) {
        const next = new Set(expandedDirs)
        next.delete(relativePath)
        set({ expandedDirs: next })
        return
      }

      // Already loading — skip duplicate fetch
      if (loading.has(relativePath)) return

      // Start loading
      set((s) => {
        const next = new Set(s.loading)
        next.add(relativePath)
        return { loading: next }
      })

      try {
        const result = await window.bridge.fsListDir(paneId, relativePath)
        const entries: DirEntry[] = result.entries

        set((s) => {
          const nextDirContents = new Map(s.dirContents)
          nextDirContents.set(relativePath, entries)

          const nextExpanded = new Set(s.expandedDirs)
          nextExpanded.add(relativePath)

          const nextLoading = new Set(s.loading)
          nextLoading.delete(relativePath)

          return {
            dirContents: nextDirContents,
            expandedDirs: nextExpanded,
            loading: nextLoading,
          }
        })
      } catch (err) {
        // Remove from loading even on error
        set((s) => {
          const next = new Set(s.loading)
          next.delete(relativePath)
          return { loading: next }
        })
        throw err
      }
    },

    refreshDir: async (relativePath = '') => {
      // Re-fetch in the background while preserving existing content to avoid UI flicker.
      set((s) => {
        const nextLoading = new Set(s.loading)
        nextLoading.add(relativePath)

        return { loading: nextLoading }
      })

      try {
        const result = await window.bridge.fsListDir(paneId, relativePath)
        const entries: DirEntry[] = result.entries

        set((s) => {
          const nextDirContents = new Map(s.dirContents)
          nextDirContents.set(relativePath, entries)

          const nextLoading = new Set(s.loading)
          nextLoading.delete(relativePath)

          return { dirContents: nextDirContents, loading: nextLoading }
        })
      } catch (err) {
        set((s) => {
          const nextDirContents = new Map(s.dirContents)
          nextDirContents.delete(relativePath)

          const nextExpanded = new Set(s.expandedDirs)
          nextExpanded.delete(relativePath)

          const next = new Set(s.loading)
          next.delete(relativePath)
          return {
            dirContents: nextDirContents,
            expandedDirs: nextExpanded,
            loading: next,
          }
        })
        throw err
      }
    },

    refreshVisibleDirs: async () => {
      const expandedDirs = Array.from(get().expandedDirs)
      const targets = ['']

      for (const relativePath of expandedDirs) {
        if (relativePath !== '') targets.push(relativePath)
      }

      await Promise.allSettled(
        targets.map((relativePath) => get().refreshDir(relativePath)),
      )
    },

    refreshModifiedFiles: async () => {
      try {
        const files = await window.bridge.gitChangedFiles(paneId)
        set({
          changedFiles: files,
          changedFilesMap: new Map(files.map((file) => [file.path, file])),
        })
      } catch {
        // Git may not be available — silently ignore
      }
    },
  }))
}

// ============================================================================
// Module-level registry
// ============================================================================

const fileTreeStores = new Map<string, FileTreeStore>()

export function getFileTreeStore(paneId: string): FileTreeStore {
  if (!fileTreeStores.has(paneId)) {
    fileTreeStores.set(paneId, createFileTreeStore(paneId))
  }
  return fileTreeStores.get(paneId)!
}

export function deleteFileTreeStore(paneId: string): void {
  fileTreeStores.delete(paneId)
}
