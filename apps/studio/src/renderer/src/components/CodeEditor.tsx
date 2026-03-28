/**
 * CodeEditor — wraps CodeMirror 6 EditorView for in-app file editing.
 *
 * Features:
 * - Dark theme matching app aesthetics (custom theme over one-dark base)
 * - Line numbers, active line highlight, bracket matching, auto-close brackets
 * - Indent guides via indentUnit / indentOnInput
 * - Language auto-detection via getLanguageLoader()
 * - Calls onUpdate(content) when document changes — wired to pane-store draftContent
 * - Read-only mode supported via prop
 * - Suppresses bubbling of Cmd+F so app-level search doesn't conflict with CM6 search
 */

import React, { useEffect, useRef, useCallback } from 'react'
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter, keymap, drawSelection, dropCursor, rectangularSelection, crosshairCursor, placeholder as placeholderExt } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentOnInput, bracketMatching, foldGutter, indentUnit } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { oneDark } from '@codemirror/theme-one-dark'
import { getLanguageLoader } from '../lib/language-map'

// ============================================================================
// Custom theme overlay — tweaks one-dark to match app aesthetic
// ============================================================================

const appTheme = EditorView.theme({
  '&': {
    // Match CODE_BG from FileViewer
    backgroundColor: '#1c1f26',
    color: '#d4d4d4',
    height: '100%',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, "Cascadia Code", "Fira Code", Consolas, "Courier New", monospace',
    fontSize: '13px',
    lineHeight: '1.6',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    overflow: 'auto',
    height: '100%',
  },
  '.cm-gutters': {
    backgroundColor: '#1c1f26',
    color: '#858585',
    borderRight: '1px solid rgba(255,255,255,0.05)',
    minWidth: '3.5rem',
  },
  '.cm-gutterElement': {
    padding: '0 0.75rem 0 0',
    textAlign: 'right',
    fontSize: '12px',
    lineHeight: '1.6',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(255,255,255,0.04)',
    color: '#d4d4d4',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    userSelect: 'none',
  },
  '.cm-cursor': {
    borderLeftColor: '#d4d4d4',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'rgba(100,149,237,0.3) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(100,149,237,0.4)',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(100,149,237,0.25)',
    color: 'inherit',
    fontWeight: 'bold',
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(255,215,0,0.3)',
    outline: '1px solid rgba(255,215,0,0.5)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'rgba(255,140,0,0.4)',
  },
  // Indent guides
  '.cm-indent-markers': {
    '--indent-marker-color': 'rgba(255,255,255,0.07)',
  },
  // Placeholder
  '.cm-placeholder': {
    color: '#858585',
  },
}, { dark: true })

// ============================================================================
// Language compartment — allows hot-swapping language support
// ============================================================================

const languageCompartment = new Compartment()

// ============================================================================
// CodeEditor component
// ============================================================================

export interface CodeEditorProps {
  /** File path used for language detection. */
  filePath: string
  /** Initial content for the editor. */
  initialContent: string
  /** Called whenever the document content changes. */
  onUpdate?: (content: string) => void
  /** Whether the editor is in read-only mode. */
  readOnly?: boolean
  /** Optional className for the container div. */
  className?: string
}

export function CodeEditor({ filePath, initialContent, onUpdate, readOnly = false, className }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onUpdateRef = useRef(onUpdate)
  const readOnlyRef = useRef(readOnly)

  // Keep refs up to date without recreating the editor
  useEffect(() => { onUpdateRef.current = onUpdate }, [onUpdate])
  useEffect(() => { readOnlyRef.current = readOnly }, [readOnly])

  // Create the editor on mount
  useEffect(() => {
    if (!containerRef.current) return

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !readOnlyRef.current && onUpdateRef.current) {
        onUpdateRef.current(update.state.doc.toString())
      }
    })

    const baseExtensions = [
      // Theme
      oneDark,
      appTheme,
      // Core UI
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      gutter(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      crosshairCursor(),
      // Language-aware features
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      foldGutter(),
      indentUnit.of('  '),
      // Search
      highlightSelectionMatches(),
      // Keymaps
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      // History (undo/redo)
      history(),
      // Change listener
      updateListener,
      // Read-only state
      EditorState.readOnly.of(readOnly),
      // Language slot (initially empty, filled async below)
      languageCompartment.of([]),
    ]

    const state = EditorState.create({
      doc: initialContent,
      extensions: baseExtensions,
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = view

    // Load language support asynchronously
    const loader = getLanguageLoader(filePath)
    if (loader) {
      void loader().then((langSupport) => {
        if (viewRef.current === view) {
          view.dispatch({
            effects: languageCompartment.reconfigure(langSupport),
          })
        }
      })
    }

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Note: intentionally only runs on mount. filePath/initialContent changes are
  // handled by the parent (FileViewer) tearing down and remounting CodeEditor
  // when the tab changes, since the editor is per-tab.

  // Suppress Cmd+F at the container level so CM6 search handles it,
  // not the app-level Cmd+F handler in App.tsx.
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.metaKey && e.key === 'f') {
      // Let CM6 handle it — stop propagation to prevent App.tsx from
      // intercepting the event and opening its own search overlay.
      e.stopPropagation()
    }
    if (e.metaKey && e.key === 'h') {
      // Similarly, suppress app shortcuts for Cmd+H (replace)
      e.stopPropagation()
    }
    if (e.metaKey && e.key === 'g') {
      // Cmd+G — go to line, suppress app capture
      e.stopPropagation()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={className}
      onKeyDown={handleKeyDown}
      // Prevent app-level keydown listeners from firing when CM6 is focused
      // by marking the container with a data attribute for detection in App.tsx
      data-codemirror="true"
      style={{ height: '100%', overflow: 'hidden' }}
    />
  )
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * A no-op gutter extension placeholder to reserve the visual space
 * consistently between load states.
 */
function gutter() {
  return []
}
