/**
 * Tests for Phase 8 editor additions to pane-store.ts
 *
 * Covers dirty state lifecycle:
 * - set dirty (draftContent != null)
 * - save clears dirty (draftContent = null, baselineContent updated)
 * - external reload on clean tab replaces content
 * - external reload blocked on dirty tab (draftContent preserved)
 * - close confirmation flow (isDirty derived correctly)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createPaneChatStore, deletePaneStore } from './pane-store'

describe('pane-store editor dirty state', () => {
  beforeEach(() => {
    deletePaneStore('editor-test-pane')
  })

  it('initial state: baselineContent and draftContent are null, isDirty is false', () => {
    const store = createPaneChatStore('editor-test-pane')
    store.getState().openFile({
      relativePath: 'src/main.ts',
      content: 'const x = 1',
      source: 'user',
      truncated: false,
      isBinary: false,
    })
    const file = store.getState().openFiles.find((f) => f.relativePath === 'src/main.ts')
    expect(file?.kind).toBe('file')
    if (file?.kind !== 'file') return
    expect(file.baselineContent).toBe('const x = 1')
    expect(file.draftContent).toBeNull()
    expect(file.isDirty).toBe(false)
  })

  it('setDraftContent marks tab as dirty', () => {
    const store = createPaneChatStore('editor-test-pane')
    store.getState().openFile({
      relativePath: 'src/main.ts',
      content: 'const x = 1',
      source: 'user',
      truncated: false,
      isBinary: false,
    })
    store.getState().setDraftContent('src/main.ts', 'const x = 2')
    const file = store.getState().openFiles.find((f) => f.relativePath === 'src/main.ts')
    expect(file?.kind).toBe('file')
    if (file?.kind !== 'file') return
    expect(file.draftContent).toBe('const x = 2')
    expect(file.isDirty).toBe(true)
  })

  it('clearDraftContent clears dirty state', () => {
    const store = createPaneChatStore('editor-test-pane')
    store.getState().openFile({
      relativePath: 'src/main.ts',
      content: 'const x = 1',
      source: 'user',
      truncated: false,
      isBinary: false,
    })
    store.getState().setDraftContent('src/main.ts', 'const x = 2')
    store.getState().clearDraftContent('src/main.ts')
    const file = store.getState().openFiles.find((f) => f.relativePath === 'src/main.ts')
    expect(file?.kind).toBe('file')
    if (file?.kind !== 'file') return
    expect(file.draftContent).toBeNull()
    expect(file.isDirty).toBe(false)
  })

  it('save: sets baselineContent = draftContent and clears draftContent', () => {
    const store = createPaneChatStore('editor-test-pane')
    store.getState().openFile({
      relativePath: 'src/main.ts',
      content: 'const x = 1',
      source: 'user',
      truncated: false,
      isBinary: false,
    })
    store.getState().setDraftContent('src/main.ts', 'const x = 2')
    store.getState().saveFile('src/main.ts')
    const file = store.getState().openFiles.find((f) => f.relativePath === 'src/main.ts')
    expect(file?.kind).toBe('file')
    if (file?.kind !== 'file') return
    expect(file.baselineContent).toBe('const x = 2')
    expect(file.draftContent).toBeNull()
    expect(file.isDirty).toBe(false)
  })

  it('save on clean tab (no draftContent) is a no-op', () => {
    const store = createPaneChatStore('editor-test-pane')
    store.getState().openFile({
      relativePath: 'src/main.ts',
      content: 'const x = 1',
      source: 'user',
      truncated: false,
      isBinary: false,
    })
    store.getState().saveFile('src/main.ts')
    const file = store.getState().openFiles.find((f) => f.relativePath === 'src/main.ts')
    expect(file?.kind).toBe('file')
    if (file?.kind !== 'file') return
    expect(file.baselineContent).toBe('const x = 1')
    expect(file.draftContent).toBeNull()
    expect(file.isDirty).toBe(false)
  })

  it('external reload on clean tab updates content and baseline', () => {
    const store = createPaneChatStore('editor-test-pane')
    store.getState().openFile({
      relativePath: 'src/main.ts',
      content: 'original content',
      source: 'user',
      truncated: false,
      isBinary: false,
    })
    // External reload: re-open with new content (clean tab)
    store.getState().openFile({
      relativePath: 'src/main.ts',
      content: 'externally changed',
      source: 'user',
      truncated: false,
      isBinary: false,
    })
    const file = store.getState().openFiles.find((f) => f.relativePath === 'src/main.ts')
    expect(file?.kind).toBe('file')
    if (file?.kind !== 'file') return
    expect(file.content).toBe('externally changed')
    expect(file.baselineContent).toBe('externally changed')
    expect(file.draftContent).toBeNull()
    expect(file.isDirty).toBe(false)
  })

  it('external reload on dirty tab preserves draftContent (no overwrite)', () => {
    const store = createPaneChatStore('editor-test-pane')
    store.getState().openFile({
      relativePath: 'src/main.ts',
      content: 'original content',
      source: 'user',
      truncated: false,
      isBinary: false,
    })
    store.getState().setDraftContent('src/main.ts', 'my unsaved edits')
    // External update: re-open triggers an update, but dirty tab should NOT lose draftContent
    store.getState().openFile({
      relativePath: 'src/main.ts',
      content: 'externally changed',
      source: 'user',
      truncated: false,
      isBinary: false,
    })
    const file = store.getState().openFiles.find((f) => f.relativePath === 'src/main.ts')
    expect(file?.kind).toBe('file')
    if (file?.kind !== 'file') return
    // draftContent preserved — user's unsaved edits not lost
    expect(file.draftContent).toBe('my unsaved edits')
    expect(file.isDirty).toBe(true)
    // content and baselineContent updated to reflect disk state
    expect(file.content).toBe('externally changed')
  })

  it('isDirty is false for diff tabs (no editor)', () => {
    const store = createPaneChatStore('editor-test-pane')
    store.getState().openDiff({
      relativePath: 'src/main.ts',
      diffText: '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new',
      status: 'M',
      isBinary: false,
    })
    const diff = store.getState().openFiles.find((f) => f.kind === 'diff')
    expect(diff?.kind).toBe('diff')
    // Diff tabs have no isDirty concept — accessing it returns undefined/false
    expect((diff as any).isDirty).toBeFalsy()
  })

  it('setDraftContent on non-existent tab is a no-op', () => {
    const store = createPaneChatStore('editor-test-pane')
    // Should not throw
    expect(() => store.getState().setDraftContent('nonexistent.ts', 'content')).not.toThrow()
  })

  it('multiple tabs track dirty state independently', () => {
    const store = createPaneChatStore('editor-test-pane')
    store.getState().openFile({
      relativePath: 'file1.ts',
      content: 'file1 original',
      source: 'user',
      truncated: false,
      isBinary: false,
    })
    store.getState().openFile({
      relativePath: 'file2.ts',
      content: 'file2 original',
      source: 'user',
      truncated: false,
      isBinary: false,
    })
    store.getState().setDraftContent('file1.ts', 'file1 edited')

    const file1 = store.getState().openFiles.find((f) => f.relativePath === 'file1.ts')
    const file2 = store.getState().openFiles.find((f) => f.relativePath === 'file2.ts')
    expect(file1?.kind === 'file' && file1.isDirty).toBe(true)
    expect(file2?.kind === 'file' && file2.isDirty).toBe(false)
  })
})
