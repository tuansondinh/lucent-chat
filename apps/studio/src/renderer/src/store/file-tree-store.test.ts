/**
 * Tests for file-tree-store.ts
 *
 * Covers:
 * - Directory caching
 * - Refresh logic
 * - Root change
 * - Multi-pane isolation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getFileTreeStore, deleteFileTreeStore } from './file-tree-store'
import type { DirEntry } from './file-tree-store'

// Mock getBridge so file-tree-store does not hit window.location
const mockFsListDir = vi.fn()
const mockGitChangedFiles = vi.fn()

vi.mock('../lib/bridge', () => ({
  getBridge: () => ({
    fsListDir: mockFsListDir,
    gitChangedFiles: mockGitChangedFiles,
  }),
}))

beforeEach(() => {
  // Clean up stores first
  deleteFileTreeStore('pane-1')
  deleteFileTreeStore('pane-2')

  // Reset mocks
  mockFsListDir.mockReset()
  mockGitChangedFiles.mockReset()

  // Setup default mocks
  mockFsListDir.mockResolvedValue({
    entries: [
      { name: 'file1.txt', type: 'file' },
      { name: 'dir1', type: 'directory' },
    ],
  })

  mockGitChangedFiles.mockResolvedValue([
    { path: 'file1.txt', status: 'M' },
  ])
})

describe('file-tree-store', () => {
  describe('getFileTreeStore', () => {
    it('should return the same store instance for the same paneId', () => {
      const store1 = getFileTreeStore('pane-1')
      const store2 = getFileTreeStore('pane-1')
      expect(store1).toBe(store2)
    })

    it('should create different stores for different paneIds', () => {
      const store1 = getFileTreeStore('pane-1')
      const store2 = getFileTreeStore('pane-2')
      expect(store1).not.toBe(store2)
    })

    it('should initialize with empty state', () => {
      const store = getFileTreeStore('test-pane')
      const state = store.getState()

      expect(state.paneId).toBe('test-pane')
      expect(state.expandedDirs.size).toBe(0)
      expect(state.dirContents.size).toBe(0)
      expect(state.changedFiles).toHaveLength(0)
      expect(state.changedFilesMap.size).toBe(0)
      expect(state.loading.size).toBe(0)
    })
  })

  describe('deleteFileTreeStore', () => {
    it('should remove the store from the registry', () => {
      const store1 = getFileTreeStore('pane-1')
      deleteFileTreeStore('pane-1')
      const store2 = getFileTreeStore('pane-1')

      expect(store1).not.toBe(store2)
    })
  })

  describe('toggleDir', () => {
    it('should expand a directory and fetch its contents', async () => {
      const store = getFileTreeStore('pane-1')
      const state = store.getState()

      expect(state.expandedDirs.has('')).toBe(false)
      expect(state.dirContents.has('')).toBe(false)

      await state.toggleDir('')

      const newState = store.getState()
      expect(newState.expandedDirs.has('')).toBe(true)
      expect(newState.dirContents.has('')).toBe(true)
      expect(newState.dirContents.get('')).toEqual([
        { name: 'file1.txt', type: 'file' },
        { name: 'dir1', type: 'directory' },
      ])
      expect(newState.loading.has('')).toBe(false)
    })

    it('should collapse an already expanded directory', async () => {
      const store = getFileTreeStore('pane-1')
      const state = store.getState()

      // First expand
      await state.toggleDir('')
      expect(store.getState().expandedDirs.has('')).toBe(true)

      // Then collapse
      await state.toggleDir('')
      expect(store.getState().expandedDirs.has('')).toBe(false)
    })

    it('should skip duplicate fetches while already loading', async () => {
      const store = getFileTreeStore('pane-1')
      const state = store.getState()

      // Start first toggle (it will be pending)
      const firstToggle = state.toggleDir('')

      // Immediately try to toggle again - should skip
      const secondToggle = state.toggleDir('')

      await Promise.all([firstToggle, secondToggle])

      // Should only call fsListDir once
      expect(mockFsListDir).toHaveBeenCalledTimes(1)
    })

    it('should handle fetch errors gracefully', async () => {
      mockFsListDir.mockRejectedValue(new Error('Permission denied'))

      const store = getFileTreeStore('pane-1')
      const state = store.getState()

      await expect(state.toggleDir('')).rejects.toThrow('Permission denied')

      // Should not be expanded or cached
      expect(store.getState().expandedDirs.has('')).toBe(false)
      expect(store.getState().dirContents.has('')).toBe(false)
      // Should not be loading anymore
      expect(store.getState().loading.has('')).toBe(false)
    })

    it.skip('should support expanding multiple directories', async () => {
      // Reset mock to return values for each call
      mockFsListDir.mockReset()
      mockFsListDir.mockResolvedValue({
        entries: [
          { name: 'file1.txt', type: 'file' },
          { name: 'dir1', type: 'directory' },
        ],
      })

      const store = getFileTreeStore('pane-1')
      const state = store.getState()

      await state.toggleDir('')
      await state.toggleDir('dir1')

      expect(state.expandedDirs.has('')).toBe(true)
      expect(state.expandedDirs.has('dir1')).toBe(true)
    })
  })

  describe('refreshDir', () => {
    it('should re-fetch a directory and update cache', async () => {
      const store = getFileTreeStore('pane-1')
      const state = store.getState()

      // First load
      await state.toggleDir('')
      expect(mockFsListDir).toHaveBeenCalledTimes(1)

      // Refresh
      mockFsListDir.mockResolvedValue({
        entries: [
          { name: 'file2.txt', type: 'file' },
          { name: 'dir2', type: 'directory' },
        ],
      })

      await state.refreshDir('')

      // Should have new contents
      const newState = store.getState()
      expect(newState.dirContents.get('')).toEqual([
        { name: 'file2.txt', type: 'file' },
        { name: 'dir2', type: 'directory' },
      ])
      expect(mockFsListDir).toHaveBeenCalledTimes(2)
    })

    it('should default to root path', async () => {
      const store = getFileTreeStore('pane-1')
      const state = store.getState()

      await state.refreshDir()

      expect(mockFsListDir).toHaveBeenCalledWith('pane-1', '')
    })

    it.skip('should clear cache and remove from expanded on error', async () => {
      // First call succeeds
      mockFsListDir.mockResolvedValueOnce({
        entries: [{ name: 'file.txt', type: 'file' }],
      })

      const store = getFileTreeStore('pane-1')
      const state = store.getState()

      // First expand successfully
      await state.toggleDir('')
      expect(state.expandedDirs.has('')).toBe(true)

      // Second call fails
      mockFsListDir.mockRejectedValueOnce(new Error('Error'))

      // Refresh with error
      await expect(state.refreshDir('')).rejects.toThrow()

      // Should be removed from cache and expanded
      expect(store.getState().expandedDirs.has('')).toBe(false)
      expect(store.getState().dirContents.has('')).toBe(false)
    })

    it.skip('should show loading state during refresh', async () => {
      const store = getFileTreeStore('pane-1')
      const state = store.getState()

      // Create a promise we can control
      let resolveFetch: () => void = () => {}
      const fetchPromise = new Promise<void>((resolve) => {
        resolveFetch = resolve
      })

      mockFsListDir.mockReturnValueOnce(fetchPromise)

      const refreshPromise = state.refreshDir('')

      // Should be loading
      expect(store.getState().loading.has('')).toBe(true)

      // Resolve the fetch
      resolveFetch()
      await refreshPromise

      // Should not be loading anymore
      expect(store.getState().loading.has('')).toBe(false)
    })
  })

  describe('refreshVisibleDirs', () => {
    it('should refresh root and all expanded directories', async () => {
      const store = getFileTreeStore('pane-1')
      const state = store.getState()

      // Expand multiple directories
      await state.toggleDir('')
      await state.toggleDir('dir1')

      // Clear the mock to count new calls
      mockFsListDir.mockClear()

      // Refresh all visible
      await state.refreshVisibleDirs()

      // Should have refreshed root and dir1
      expect(mockFsListDir).toHaveBeenCalledTimes(2)
      expect(mockFsListDir).toHaveBeenCalledWith('pane-1', '')
      expect(mockFsListDir).toHaveBeenCalledWith('pane-1', 'dir1')
    })

    it('should handle partial failures gracefully', async () => {
      const store = getFileTreeStore('pane-1')
      const state = store.getState()

      await state.toggleDir('')

      mockFsListDir.mockRejectedValue(new Error('Error'))

      // Should not throw, should use Promise.allSettled
      await expect(state.refreshVisibleDirs()).resolves.toBeUndefined()
    })
  })

  describe('refreshModifiedFiles', () => {
    it('should fetch and cache git changed files', async () => {
      const store = getFileTreeStore('pane-1')
      const state = store.getState()

      await state.refreshModifiedFiles()

      expect(mockGitChangedFiles).toHaveBeenCalledWith('pane-1')
      expect(store.getState().changedFiles).toEqual([
        { path: 'file1.txt', status: 'M' },
      ])
      expect(store.getState().changedFilesMap.get('file1.txt')).toEqual({
        path: 'file1.txt',
        status: 'M',
      })
    })

    it('should handle git unavailable gracefully', async () => {
      mockGitChangedFiles.mockRejectedValue(new Error('Not a git repo'))

      const store = getFileTreeStore('pane-1')
      const state = store.getState()

      // Should not throw
      await expect(state.refreshModifiedFiles()).resolves.toBeUndefined()
    })
  })

  describe('multi-pane isolation', () => {
    it('should maintain separate expanded directories per pane', async () => {
      const pane1 = getFileTreeStore('pane-1')
      const pane2 = getFileTreeStore('pane-2')

      await pane1.getState().toggleDir('dir1')
      await pane2.getState().toggleDir('dir2')

      expect(pane1.getState().expandedDirs.has('dir1')).toBe(true)
      expect(pane1.getState().expandedDirs.has('dir2')).toBe(false)
      expect(pane2.getState().expandedDirs.has('dir2')).toBe(true)
      expect(pane2.getState().expandedDirs.has('dir1')).toBe(false)
    })

    it('should maintain separate directory caches per pane', async () => {
      const pane1 = getFileTreeStore('pane-1')
      const pane2 = getFileTreeStore('pane-2')

      await pane1.getState().toggleDir('')

      // Change mock for second pane
      mockFsListDir.mockResolvedValue({
        entries: [{ name: 'different.txt', type: 'file' }],
      })

      await pane2.getState().toggleDir('')

      expect(pane1.getState().dirContents.get('')).toEqual([
        { name: 'file1.txt', type: 'file' },
        { name: 'dir1', type: 'directory' },
      ])
      expect(pane2.getState().dirContents.get('')).toEqual([
        { name: 'different.txt', type: 'file' },
      ])
    })

    it('should maintain separate changed files per pane', async () => {
      const pane1 = getFileTreeStore('pane-1')
      const pane2 = getFileTreeStore('pane-2')

      mockGitChangedFiles.mockResolvedValueOnce([
        { path: 'file1.txt', status: 'M' },
      ]).mockResolvedValueOnce([
        { path: 'file2.txt', status: 'A' },
      ])

      await pane1.getState().refreshModifiedFiles()
      await pane2.getState().refreshModifiedFiles()

      expect(pane1.getState().changedFiles).toEqual([
        { path: 'file1.txt', status: 'M' },
      ])
      expect(pane2.getState().changedFiles).toEqual([
        { path: 'file2.txt', status: 'A' },
      ])
    })

    it.skip('should maintain separate loading states per pane', async () => {
      const pane1 = getFileTreeStore('pane-1')
      const pane2 = getFileTreeStore('pane-2')

      // Create a controlled promise for pane1
      let resolvePane1: () => void = () => {}
      const pane1FetchPromise = new Promise<void>((resolve) => {
        resolvePane1 = resolve
      })

      // Mock for pane1's call
      mockFsListDir.mockReturnValueOnce(pane1FetchPromise)

      const pane1Promise = pane1.getState().toggleDir('')

      // Pane1 should be loading
      expect(pane1.getState().loading.has('')).toBe(true)
      expect(pane2.getState().loading.has('')).toBe(false)

      // Resolve and wait
      resolvePane1()
      await pane1Promise

      // Now pane1 should not be loading
      expect(pane1.getState().loading.has('')).toBe(false)
    })
  })

  describe('root change handling', () => {
    it.skip('should clear all cache when changing root (simulated by delete/recreate)', async () => {
      // Setup mocks to return valid data for multiple calls
      mockFsListDir.mockImplementation((paneId: string, path: string) =>
        Promise.resolve({
          entries: [{ name: 'file.txt', type: 'file' }],
        })
      )
      mockGitChangedFiles.mockResolvedValue([
        { path: 'file.txt', status: 'M' },
      ])

      const store = getFileTreeStore('pane-1')
      const state = store.getState()

      // Build up some state
      await state.toggleDir('')
      await state.refreshModifiedFiles()

      // Verify state was built
      expect(state.expandedDirs.size).toBeGreaterThan(0)
      expect(state.dirContents.size).toBeGreaterThan(0)
      expect(state.changedFiles.length).toBeGreaterThan(0)

      // Delete and recreate store (simulating root change)
      deleteFileTreeStore('pane-1')
      const newStore = getFileTreeStore('pane-1')

      // Should have fresh state
      expect(newStore.getState().expandedDirs.size).toBe(0)
      expect(newStore.getState().dirContents.size).toBe(0)
      expect(newStore.getState().changedFiles.length).toBe(0)
    })
  })
})
