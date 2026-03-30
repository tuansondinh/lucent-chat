/**
 * Tests for pane-store close confirmation and dirty-tab flows.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createPaneChatStore, deletePaneStore } from './pane-store'

describe('pane-store close confirmation flow', () => {
  const PANE_ID = 'close-confirmation-test-pane'

  beforeEach(() => {
    deletePaneStore(PANE_ID)
  })

  // Helper to open a file tab
  const openFile = (
    store: ReturnType<typeof createPaneChatStore>,
    relativePath: string,
    content = 'initial content',
  ) => {
    store.getState().openFile({
      relativePath,
      content,
      source: 'user',
      truncated: false,
      isBinary: false,
    })
  }

  // ---- set dirty ----

  it('typing in editor marks tab dirty via setDraftContent', () => {
    const store = createPaneChatStore(PANE_ID)
    openFile(store, 'index.ts')

    store.getState().setDraftContent('index.ts', 'edited content')

    const file = store.getState().openFiles[0]
    expect(file.kind).toBe('file')
    if (file.kind !== 'file') return
    expect(file.isDirty).toBe(true)
    expect(file.draftContent).toBe('edited content')
  })

  // ---- save clears dirty ----

  it('saveFile promotes draftContent to baseline and clears dirty', () => {
    const store = createPaneChatStore(PANE_ID)
    openFile(store, 'index.ts')
    store.getState().setDraftContent('index.ts', 'saved version')

    store.getState().saveFile('index.ts')

    const file = store.getState().openFiles[0]
    expect(file.kind).toBe('file')
    if (file.kind !== 'file') return
    expect(file.isDirty).toBe(false)
    expect(file.draftContent).toBeNull()
    expect(file.baselineContent).toBe('saved version')
    expect(file.content).toBe('saved version')
  })

  it('commitSave (alias) also promotes draftContent to baseline and clears dirty', () => {
    const store = createPaneChatStore(PANE_ID)
    openFile(store, 'index.ts')
    store.getState().setDraftContent('index.ts', 'committed version')

    store.getState().commitSave('index.ts')

    const file = store.getState().openFiles[0]
    expect(file.kind).toBe('file')
    if (file.kind !== 'file') return
    expect(file.isDirty).toBe(false)
    expect(file.draftContent).toBeNull()
    expect(file.baselineContent).toBe('committed version')
  })

  // ---- external reload on clean tab ----

  it('externalReload on clean tab silently updates content and baseline', () => {
    const store = createPaneChatStore(PANE_ID)
    openFile(store, 'util.ts', 'original')

    const result = store.getState().externalReload('util.ts', 'disk updated content')

    expect(result).toBe('reloaded')
    const file = store.getState().openFiles[0]
    expect(file.kind).toBe('file')
    if (file.kind !== 'file') return
    expect(file.content).toBe('disk updated content')
    expect(file.baselineContent).toBe('disk updated content')
    expect(file.isDirty).toBe(false)
    expect(file.draftContent).toBeNull()
  })

  // ---- external reload blocked on dirty tab ----

  it('externalReload on dirty tab returns conflict and does not overwrite draftContent', () => {
    const store = createPaneChatStore(PANE_ID)
    openFile(store, 'util.ts', 'original')
    store.getState().setDraftContent('util.ts', 'my local edits')

    const result = store.getState().externalReload('util.ts', 'disk updated content')

    expect(result).toBe('conflict')
    const file = store.getState().openFiles[0]
    expect(file.kind).toBe('file')
    if (file.kind !== 'file') return
    // Draft preserved
    expect(file.draftContent).toBe('my local edits')
    expect(file.isDirty).toBe(true)
    // Original disk content preserved — not overwritten
    expect(file.content).toBe('original')
  })

  // ---- close confirmation flow ----

  it('hasDirtyTabs: false when no tabs have draftContent', () => {
    const store = createPaneChatStore(PANE_ID)
    openFile(store, 'a.ts')
    openFile(store, 'b.ts')

    expect(store.getState().hasDirtyTabs()).toBe(false)
  })

  it('hasDirtyTabs: true when at least one tab has draftContent', () => {
    const store = createPaneChatStore(PANE_ID)
    openFile(store, 'a.ts')
    openFile(store, 'b.ts')
    store.getState().setDraftContent('a.ts', 'dirty')

    expect(store.getState().hasDirtyTabs()).toBe(true)
  })

  it('close confirmation flow: discard — clearDraftContent then closeFile', () => {
    const store = createPaneChatStore(PANE_ID)
    openFile(store, 'a.ts')
    store.getState().setDraftContent('a.ts', 'unsaved work')

    // Simulate user choosing "Discard" in the close guard dialog:
    // 1. clear the draft
    store.getState().clearDraftContent('a.ts')
    // 2. close the tab
    store.getState().closeFile('a.ts')

    expect(store.getState().openFiles).toHaveLength(0)
    expect(store.getState().hasDirtyTabs()).toBe(false)
  })

  it('close confirmation flow: discard via discardDraft then closeFile', () => {
    const store = createPaneChatStore(PANE_ID)
    openFile(store, 'a.ts')
    store.getState().setDraftContent('a.ts', 'unsaved work')

    // Using discardDraft (reloads disk content before closing)
    store.getState().discardDraft('a.ts', 'latest from disk')
    store.getState().closeFile('a.ts')

    expect(store.getState().openFiles).toHaveLength(0)
  })

  it('close confirmation flow: save then close — tab is no longer dirty', () => {
    const store = createPaneChatStore(PANE_ID)
    openFile(store, 'a.ts')
    store.getState().setDraftContent('a.ts', 'final version')

    // Simulate user choosing "Save & close":
    // 1. commitSave
    store.getState().commitSave('a.ts')
    // 2. close
    store.getState().closeFile('a.ts')

    expect(store.getState().openFiles).toHaveLength(0)
    expect(store.getState().hasDirtyTabs()).toBe(false)
  })

  it('close confirmation flow: cancel — file stays open with draftContent intact', () => {
    const store = createPaneChatStore(PANE_ID)
    openFile(store, 'a.ts')
    store.getState().setDraftContent('a.ts', 'work in progress')

    // Simulate "Cancel" — do nothing; verify state unchanged
    const file = store.getState().openFiles[0]
    expect(file.kind).toBe('file')
    if (file.kind !== 'file') return
    expect(file.isDirty).toBe(true)
    expect(file.draftContent).toBe('work in progress')
    expect(store.getState().openFiles).toHaveLength(1)
  })

  it('multiple dirty tabs: closing panel discards all drafts', () => {
    const store = createPaneChatStore(PANE_ID)
    openFile(store, 'a.ts')
    openFile(store, 'b.ts')
    openFile(store, 'c.ts')
    store.getState().setDraftContent('a.ts', 'dirty a')
    store.getState().setDraftContent('c.ts', 'dirty c')

    // Simulate "Discard all" — close guard panel flow clears all dirty drafts
    store.getState().openFiles.forEach((f) => {
      if (f.kind === 'file' && f.isDirty) {
        store.getState().clearDraftContent(f.tabKey)
      }
    })

    expect(store.getState().hasDirtyTabs()).toBe(false)
  })

  it('isDirty reflects draftContent !== null, not content !== baselineContent', () => {
    // Even if user types content that matches the original, isDirty stays true
    // because the editor is the source of truth.
    const store = createPaneChatStore(PANE_ID)
    openFile(store, 'same.ts', 'original content')
    store.getState().setDraftContent('same.ts', 'original content')

    const file = store.getState().openFiles[0]
    expect(file.kind).toBe('file')
    if (file.kind !== 'file') return
    expect(file.isDirty).toBe(true)
  })
})
