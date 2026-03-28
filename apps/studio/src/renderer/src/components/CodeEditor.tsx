/**
 * CodeEditor — wraps CodeMirror 6 EditorView for in-app file editing.
 *
 * Features (Phase 1 + Phase 3):
 * - Dark theme matching app aesthetics (custom theme, Tailwind CSS variable–aware)
 * - Line numbers, active line highlight, bracket matching, auto-close brackets
 * - Indent guides via indentUnit / indentOnInput
 * - Language auto-detection via getLanguageLoader()
 * - Calls onUpdate(content) when document changes — wired to pane-store draftContent
 * - Read-only mode supported via prop
 * - Word wrap toggle — controlled via `wordWrap` prop, persisted outside by parent
 * - Font size control — controlled via `fontSize` prop, persisted outside by parent
 * - VS Code keybindings: Cmd+D (select next occurrence), Cmd+Shift+K (delete line),
 *   Cmd+/ (toggle comment), Alt+Up/Down (move line) — already in defaultKeymap/searchKeymap
 * - CodeMirror built-in search panel (Cmd+F), replace (Cmd+H opens search panel),
 *   go-to-line (Cmd+G)
 * - Suppresses bubbling of Cmd+F/H/G so app-level shortcuts don't conflict with CM6
 */

import React, { useEffect, useRef, useCallback } from 'react'
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  toggleComment,
  moveLineUp,
  moveLineDown,
  deleteLine,
} from '@codemirror/commands'
import { indentOnInput, bracketMatching, foldGutter, indentUnit } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import {
  searchKeymap,
  highlightSelectionMatches,
  openSearchPanel,
  gotoLine,
  selectNextOccurrence,
} from '@codemirror/search'
import { oneDark } from '@codemirror/theme-one-dark'
import { getLanguageLoader } from '../lib/language-map'

// ============================================================================
// Custom theme overlay — tweaks one-dark to match app aesthetic,
// using the same color tokens as FileViewer.tsx (CODE_BG = #1c1f26)
// ============================================================================

const appTheme = EditorView.theme({
  '&': {
    // Match CODE_BG from FileViewer
    backgroundColor: '#1c1f26',
    color: '#d4d4d4',
    height: '100%',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, "Cascadia Code", "Fira Code", Consolas, "Courier New", monospace',
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
  // Search panel — styled to match app aesthetic
  '.cm-search': {
    backgroundColor: '#1c1f26',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    padding: '6px 8px',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    alignItems: 'center',
  },
  '.cm-textfield': {
    backgroundColor: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '3px',
    color: '#d4d4d4',
    fontSize: '12px',
    padding: '2px 6px',
    outline: 'none',
  },
  '.cm-textfield:focus': {
    borderColor: 'rgba(100,149,237,0.6)',
  },
  '.cm-button': {
    backgroundColor: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '3px',
    color: '#d4d4d4',
    fontSize: '11px',
    padding: '2px 8px',
    cursor: 'pointer',
  },
  '.cm-button:hover': {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  'label.cm-search-label': {
    color: '#858585',
    fontSize: '11px',
  },
}, { dark: true })

// ============================================================================
// Compartments — allow hot-swapping individual features
// ============================================================================

const languageCompartment = new Compartment()
const wordWrapCompartment = new Compartment()
const fontSizeCompartment = new Compartment()

// ============================================================================
// VS Code-style keymap additions
//
// Most are already in defaultKeymap (Alt+Up/Down, Shift-Mod-K, Mod-/) and
// searchKeymap (Mod-D). We add explicit Mod-G for go-to-line and Mod-H for
// opening the replace panel (same search panel — CM6 doesn't separate them).
// ============================================================================

const vscodeExtraKeymap = [
  // Cmd+G → go to line (CM6 search panel go-to-line)
  { key: 'Mod-g', run: gotoLine, preventDefault: true },
  // Cmd+H → open search panel (same as Cmd+F — CM6 search panel includes replace)
  { key: 'Mod-h', run: openSearchPanel, scope: 'editor search-panel' as const, preventDefault: true },
  // Explicit Cmd+D → select next occurrence (also in searchKeymap, but explicit here for clarity)
  { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
  // Explicit Cmd+/ → toggle comment (also in defaultKeymap)
  { key: 'Mod-/', run: toggleComment },
  // Explicit Alt+Up / Alt+Down → move line (also in defaultKeymap)
  { key: 'Alt-ArrowUp', run: moveLineUp },
  { key: 'Alt-ArrowDown', run: moveLineDown },
  // Explicit Cmd+Shift+K → delete line (also in defaultKeymap as Shift-Mod-k)
  { key: 'Shift-Mod-k', run: deleteLine },
]

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
  /** Whether word wrap is enabled. Persisted to localStorage by parent. */
  wordWrap?: boolean
  /** Editor font size in px. Persisted to localStorage by parent. */
  fontSize?: number
  /** Optional className for the container div. */
  className?: string
}

export function CodeEditor({
  filePath,
  initialContent,
  onUpdate,
  readOnly = false,
  wordWrap = false,
  fontSize = 13,
  className,
}: CodeEditorProps) {
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
      // Search + selection highlighting
      highlightSelectionMatches(),
      // Keymaps — order matters (most specific first)
      keymap.of([
        ...closeBracketsKeymap,
        ...vscodeExtraKeymap,   // Phase 3: VS Code extras (Cmd+G, Cmd+H, explicit VS Code bindings)
        ...defaultKeymap,        // includes Alt+Up/Down, Shift-Mod-K, Mod-/, Mod-Enter, etc.
        ...searchKeymap,         // includes Mod-F, Mod-D, Mod-Alt-G
        ...historyKeymap,
        indentWithTab,
      ]),
      // History (undo/redo)
      history(),
      // Change listener
      updateListener,
      // Read-only state
      EditorState.readOnly.of(readOnly),
      // Word wrap compartment (hot-swappable)
      wordWrapCompartment.of(wordWrap ? EditorView.lineWrapping : []),
      // Font size compartment (hot-swappable)
      fontSizeCompartment.of(EditorView.theme({ '&': { fontSize: `${fontSize}px` } })),
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

  // Hot-swap word wrap when prop changes
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: wordWrapCompartment.reconfigure(wordWrap ? EditorView.lineWrapping : []),
    })
  }, [wordWrap])

  // Hot-swap font size when prop changes
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: fontSizeCompartment.reconfigure(
        EditorView.theme({ '&': { fontSize: `${fontSize}px` } })
      ),
    })
  }, [fontSize])

  // Suppress Cmd+F/H/G at the container level so CM6 handles them,
  // not the app-level handlers in App.tsx or FileViewer.
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey) {
      const key = e.key.toLowerCase()
      if (key === 'f' || key === 'h' || key === 'g') {
        // Let CM6 handle it — stop propagation to prevent app-level capture
        e.stopPropagation()
      }
      if (key === 's') {
        // Allow Cmd+S to propagate to FileViewer's save handler
        // (don't suppress — FileViewer listens for it on window)
      }
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
