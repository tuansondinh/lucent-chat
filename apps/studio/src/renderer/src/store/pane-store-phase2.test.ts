/**
 * Phase 2 tests for pane-store dirty state lifecycle.
 *
 * Tests:
 * - set dirty (draftContent != null, isDirty = true)
 * - save clears dirty (commitSave sets baselineContent = draftContent, draftContent = null)
 * - external reload on clean tab (silently reloads)
 * - external reload blocked on dirty tab (returns 'conflict')
 * - hasDirtyTabs helper
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createPaneChatStore, deletePaneStore } from './pane-store'

describe('pane-store Phase 2 — dirty state lifecycle', () => {
  beforeEach(() => {
    deletePaneStore('test-p2')
  })

  const openTestFile = (store: ReturnType<typeof createPaneChatStore>, path = 'foo.ts', content = 'original') => {
    store.getState().openFile({
      relativePath: path,
      content,
      source: 'user',
      truncated: false,
      isBinary: false,
    })
  }

  it('newly opened file has null draftContent and isDirty=false', () => {
    const store = createPaneChatStore('test-p2')
    openTestFile(store)
    const file = store.getState().openFiles[0]
    expect(file.kind).toBe('file')
    if (file.kind !== 'file') return
    expect(file.baselineContent).toBe('original')
    expect(file.draftContent).toBeNull()
    expect(file.isDirty).toBe(false)
  })

  it('setDraftContent marks tab as dirty', () => {
    const store = createPaneChatStore('test-p2')
    openTestFile(store)
    store.getState().setDraftContent('foo.ts', 'edited content')
    const file = store.getState().openFiles[0]
    if (file.kind !== 'file') return
    expect(file.draftContent).toBe('edited content')
    expect(file.isDirty).toBe(true)
  })

  it('setDraftContent with same content as baseline still sets draftContent', () => {
    const store = createPaneChatStore('test-p2')
    openTestFile(store, 'foo.ts', 'original')
    store.getState().setDraftContent('foo.ts', 'original')
    const file = store.getState().openFiles[0]
    if (file.kind !== 'file') return
    // Even with same content, draftContent is set (editor is the source of truth)
    expect(file.draftContent).toBe('original')
    expect(file.isDirty).toBe(true)
  })

  it('commitSave clears dirty state and updates baselineContent', () => {
    const store = createPaneChatStore('test-p2')
    openTestFile(store)
    store.getState().setDraftContent('foo.ts', 'saved content')
    store.getState().commitSave('foo.ts')
    const file = store.getState().openFiles[0]
    if (file.kind !== 'file') return
    expect(file.draftContent).toBeNull()
    expect(file.baselineContent).toBe('saved content')
    expect(file.isDirty).toBe(false)
  })

  it('commitSave on clean tab is a no-op', () => {
    const store = createPaneChatStore('test-p2')
    openTestFile(store)
    store.getState().commitSave('foo.ts')
    const file = store.getState().openFiles[0]
    if (file.kind !== 'file') return
    expect(file.draftContent).toBeNull()
    expect(file.baselineContent).toBe('original')
  })

  it('externalReload on clean tab reloads content silently', () => {
    const store = createPaneChatStore('test-p2')
    openTestFile(store)
    const result = store.getState().externalReload('foo.ts', 'new disk content')
    expect(result).toBe('reloaded')
    const file = store.getState().openFiles[0]
    if (file.kind !== 'file') return
    expect(file.content).toBe('new disk content')
    expect(file.baselineContent).toBe('new disk content')
    expect(file.draftContent).toBeNull()
  })

  it('externalReload on dirty tab returns conflict and does NOT overwrite', () => {
    const store = createPaneChatStore('test-p2')
    openTestFile(store)
    store.getState().setDraftContent('foo.ts', 'my edits')
    const result = store.getState().externalReload('foo.ts', 'new disk content')
    expect(result).toBe('conflict')
    const file = store.getState().openFiles[0]
    if (file.kind !== 'file') return
    // Content unchanged
    expect(file.draftContent).toBe('my edits')
    expect(file.content).toBe('original')
  })

  it('discardDraft reloads baseline content and clears dirty', () => {
    const store = createPaneChatStore('test-p2')
    openTestFile(store)
    store.getState().setDraftContent('foo.ts', 'unsaved changes')
    store.getState().discardDraft('foo.ts', 'disk content after conflict')
    const file = store.getState().openFiles[0]
    if (file.kind !== 'file') return
    expect(file.draftContent).toBeNull()
    expect(file.content).toBe('disk content after conflict')
    expect(file.baselineContent).toBe('disk content after conflict')
    expect(file.isDirty).toBe(false)
  })

  it('hasDirtyTabs returns false when no tabs are dirty', () => {
    const store = createPaneChatStore('test-p2')
    openTestFile(store, 'a.ts')
    openTestFile(store, 'b.ts')
    expect(store.getState().hasDirtyTabs()).toBe(false)
  })

  it('hasDirtyTabs returns true when at least one tab is dirty', () => {
    const store = createPaneChatStore('test-p2')
    openTestFile(store, 'a.ts')
    openTestFile(store, 'b.ts')
    store.getState().setDraftContent('a.ts', 'changed')
    expect(store.getState().hasDirtyTabs()).toBe(true)
  })

  it('closeFile with dirty tab is allowed (caller must confirm before calling)', () => {
    const store = createPaneChatStore('test-p2')
    openTestFile(store)
    store.getState().setDraftContent('foo.ts', 'unsaved')
    store.getState().closeFile('foo.ts')
    expect(store.getState().openFiles).toHaveLength(0)
  })

  it('setDraftContent on a diff tab is a no-op', () => {
    const store = createPaneChatStore('test-p2')
    store.getState().openDiff({
      relativePath: 'foo.ts',
      diffText: 'diff content',
      status: 'M',
      isBinary: false,
    })
    // Should not throw
    store.getState().setDraftContent('diff:foo.ts', 'something')
    const file = store.getState().openFiles[0]
    expect(file.kind).toBe('diff')
  })
})
