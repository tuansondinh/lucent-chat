/**
 * FileViewer — right-side panel that displays file content from agent tool events.
 *
 * Features:
 * - Tab bar showing all open files; middle-click or ✕ to close tabs
 * - Token-based syntax highlighting via Shiki codeToTokens (Phase 6)
 * - Line numbers in a gutter column
 * - Plain-text fallback with line numbers for files ≥ 2000 lines
 * - Large file truncation at ~500 lines with "Show more" toggle
 * - Binary file detection (null bytes / non-UTF-8 characters)
 * - Read-only display with copy-to-clipboard support
 * - In-file search (Cmd+F) with match highlighting and navigation
 * - Breadcrumb navigation showing full path segments
 * - Calls onClose() when last tab is closed
 * - Edit mode toggle (pencil icon) — switches from Shiki read-only to CodeMirror editor
 */

import React, { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react'
import type { ThemedToken } from 'shiki'
import { getPaneStore, type OpenViewerItem, type OpenFile } from '../store/pane-store'
import { getFileTreeStore } from '../store/file-tree-store'
import { getHighlighter } from '../lib/highlighter'
import { cn } from '../lib/utils'
import { X, Copy, Check, FileText, Search, GitBranch, Pencil, Eye, AlertTriangle, WrapText, ZoomIn, ZoomOut } from 'lucide-react'
import type { GitChangeStatus } from '../../../preload'
import { getBridge } from '../lib/bridge'
import { toast } from 'sonner'

// ============================================================================
// Editor preferences — persisted to localStorage
// ============================================================================

const LS_WORD_WRAP_KEY = 'lc_editor_word_wrap'
const LS_FONT_SIZE_KEY = 'lc_editor_font_size'
const EDITOR_FONT_SIZE_DEFAULT = 13
const EDITOR_FONT_SIZE_MIN = 8
const EDITOR_FONT_SIZE_MAX = 32

function readWordWrap(): boolean {
  try { return localStorage.getItem(LS_WORD_WRAP_KEY) === 'true' } catch { return false }
}

function readFontSize(): number {
  try {
    const v = parseInt(localStorage.getItem(LS_FONT_SIZE_KEY) ?? '', 10)
    return Number.isFinite(v) ? Math.max(EDITOR_FONT_SIZE_MIN, Math.min(EDITOR_FONT_SIZE_MAX, v)) : EDITOR_FONT_SIZE_DEFAULT
  } catch { return EDITOR_FONT_SIZE_DEFAULT }
}

function saveWordWrap(v: boolean): void {
  try { localStorage.setItem(LS_WORD_WRAP_KEY, v ? 'true' : 'false') } catch { /* ignore */ }
}

function saveFontSize(v: number): void {
  try { localStorage.setItem(LS_FONT_SIZE_KEY, String(v)) } catch { /* ignore */ }
}

// Lazy-load CodeEditor — only needed when user toggles edit mode
const CodeEditor = lazy(() => import('./CodeEditor').then((m) => ({ default: m.CodeEditor })))

// ============================================================================
// Self-save nonce registry
// A nonce set shared with App.tsx to suppress watcher reloads triggered by
// our own saves. Each save tags a nonce, and the watcher ignores events for
// nonces present in this set.
// ============================================================================

/** Exported so App.tsx can check and clear nonces. */
export const selfSaveNonces = new Set<string>()

/**
 * Generate a save nonce and record it. Automatically expires after 2 seconds
 * to guard against missed file-change events.
 */
export function createSaveNonce(relativePath: string): string {
  const nonce = `${relativePath}:${Date.now()}`
  selfSaveNonces.add(nonce)
  setTimeout(() => selfSaveNonces.delete(nonce), 2_000)
  return nonce
}

/**
 * Check whether a file-change event should be suppressed as a self-save.
 * Clears the nonce if found.
 */
export function consumeSaveNonce(relativePath: string): boolean {
  for (const nonce of selfSaveNonces) {
    if (nonce.startsWith(`${relativePath}:`)) {
      selfSaveNonces.delete(nonce)
      return true
    }
  }
  return false
}

// ============================================================================
// Constants
// ============================================================================

const TRUNCATE_LINES = 500
/** Lines at or above this threshold skip Shiki and render plain text. */
const HIGHLIGHT_LINE_LIMIT = 2000

// ---- Shared code-viewer style constants ----
// Change these once to update both the file viewer and the git diff viewer.

/** Background for all code/diff panels */
const CODE_BG = 'bg-[#1c1f26]'

/** Row wrapper flex layout (same for file view and diff view) */
const CODE_ROW = 'flex items-stretch group/line min-w-full'

/** Row hover — applied when no background colour is active */
const CODE_ROW_HOVER = 'hover:bg-white/5'

/** Gutter column (line numbers) */
const CODE_GUTTER = 'w-[3.5rem] flex-shrink-0 pr-3 text-right text-[12px] font-mono text-[#858585] border-r border-white/5 select-none cursor-default'

/** Inline style for gutter line height (keeps file viewer and diff viewer in sync) */
const CODE_GUTTER_STYLE: React.CSSProperties = { lineHeight: '1.6' }

/** Code content area */
const CODE_CONTENT = 'flex-1 pl-4 whitespace-pre font-mono text-[13px] leading-[1.6] select-text min-w-0'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Detect binary content by checking for null bytes or a high density of
 * non-printable, non-whitespace characters (heuristic for non-UTF-8 data).
 */
function isBinaryContent(content: string): boolean {
  // Null byte is a reliable binary indicator
  if (content.includes('\0')) return true
  // Sample the first 1024 chars — if >10% are non-printable control chars, treat as binary
  const sample = content.slice(0, 1024)
  let nonPrintable = 0
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i)
    // Allow tab (9), newline (10), carriage return (13), printable ASCII (32–126),
    // and all Unicode codepoints > 127 (valid UTF-8 text — em dashes, accents, CJK, etc.)
    if (code !== 9 && code !== 10 && code !== 13 && code < 32) {
      nonPrintable++
    }
  }
  return nonPrintable / sample.length > 0.1
}

/**
 * Map a file extension to a Shiki language identifier.
 * Falls back to 'text' for unknown extensions.
 */
function extensionToLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    c: 'c',
    cc: 'cpp',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    sh: 'shell',
    bash: 'bash',
    zsh: 'shell',
    json: 'json',
    jsonc: 'jsonc',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    sql: 'sql',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    md: 'markdown',
    mdx: 'markdown',
    diff: 'diff',
    patch: 'diff',
    dockerfile: 'dockerfile',
    graphql: 'graphql',
    gql: 'graphql',
    xml: 'xml',
    swift: 'swift',
    kt: 'kotlin',
    rb: 'ruby',
    php: 'php',
  }
  return map[ext] ?? 'text'
}

interface ParsedDiffLine {
  kind: 'meta' | 'hunk' | 'context' | 'add' | 'remove'
  text: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

function parseDiffHunkHeader(line: string): { oldStart: number; newStart: number } | null {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
  if (!match) return null
  return {
    oldStart: Number(match[1]),
    newStart: Number(match[2]),
  }
}

function parseUnifiedDiff(diffText: string | null): ParsedDiffLine[] {
  if (!diffText) return []

  const lines = diffText.split('\n')
  const parsed: ParsedDiffLine[] = []
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const header = parseDiffHunkHeader(line)
      if (header) {
        oldLine = header.oldStart
        newLine = header.newStart
      }
      parsed.push({ kind: 'hunk', text: line, oldLineNumber: null, newLineNumber: null })
      continue
    }

    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('rename from ') ||
      line.startsWith('rename to ') ||
      line.startsWith('new file mode ') ||
      line.startsWith('deleted file mode ')
    ) {
      parsed.push({ kind: 'meta', text: line, oldLineNumber: null, newLineNumber: null })
      continue
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      parsed.push({ kind: 'add', text: line, oldLineNumber: null, newLineNumber: newLine })
      newLine += 1
      continue
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      parsed.push({ kind: 'remove', text: line, oldLineNumber: oldLine, newLineNumber: null })
      oldLine += 1
      continue
    }

    parsed.push({ kind: 'context', text: line, oldLineNumber: oldLine, newLineNumber: newLine })
    oldLine += 1
    newLine += 1
  }

  return parsed
}

function getDiffStatusBadgeClass(status: GitChangeStatus): string {
  switch (status) {
    case 'A':
    case '??':
      return 'bg-emerald-500/15 text-emerald-300'
    case 'D':
      return 'bg-red-500/15 text-red-300'
    case 'R':
      return 'bg-sky-500/15 text-sky-300'
    case 'U':
      return 'bg-amber-400/15 text-amber-200'
    default:
      return 'bg-amber-500/15 text-amber-300'
  }
}

// ============================================================================
// CopyButton (reused pattern from ChatMessage)
// ============================================================================

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard unavailable — silently ignore
    }
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className={cn(
        'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
        'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover',
        className,
      )}
      title="Copy file contents"
      aria-label="Copy file contents to clipboard"
    >
      {copied ? (
        <>
          <Check className="size-3 text-green-400" />
          <span className="text-green-400">Copied</span>
        </>
      ) : (
        <>
          <Copy className="size-3" />
          <span>Copy</span>
        </>
      )}
    </button>
  )
}

// ============================================================================
// HighlightedCode — token-based syntax highlighted code with line numbers
// ============================================================================

interface HighlightedCodeProps {
  code: string
  language: string
  matchLineIndices: Set<number>
  activeMatchLineIndex: number | null
}

function HighlightedCode({ code, language, matchLineIndices, activeMatchLineIndex }: HighlightedCodeProps) {
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null)
  const lines = code.split('\n')
  const isLarge = lines.length >= HIGHLIGHT_LINE_LIMIT
  const activeLineRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (isLarge) {
      // Skip Shiki for large files
      setTokens(null)
      return
    }

    let cancelled = false

    const doTokenize = async () => {
      try {
        const hl = await getHighlighter()
        const result = hl.codeToTokens(code, {
          lang: language || 'text',
          theme: 'dark-plus',
        })
        if (!cancelled) setTokens(result.tokens)
      } catch {
        // Unknown language or Shiki error — fall back to plain text rendering
        if (!cancelled) setTokens(null)
      }
    }

    setTokens(null)
    void doTokenize()
    return () => { cancelled = true }
  }, [code, language, isLarge])

  // Scroll active match line into view when it changes
  useEffect(() => {
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeMatchLineIndex])

  /** Returns the ref to attach if this line is the active match. */
  const getLineRef = (i: number) => (activeMatchLineIndex === i ? activeLineRef : null)

  /** Background class for a line row based on match state. */
  const lineRowClass = (i: number): string => {
    if (activeMatchLineIndex === i) return 'bg-yellow-500/30'
    if (matchLineIndices.has(i)) return 'bg-yellow-500/15'
    return ''
  }

  return (
    <div className={cn('overflow-x-auto', CODE_BG)}>
      {/* Large file banner */}
      {isLarge && (
        <div className="px-4 py-1.5 text-[11px] text-amber-400/80 bg-amber-400/5 border-b border-amber-400/10 font-mono">
          File too large for syntax highlighting — showing plain text
        </div>
      )}
      {/* eslint-disable-next-line react/forbid-dom-props */}
      <div style={{ minWidth: '100%', width: 'max-content' }}>
        {isLarge
        ? /* Plain text with line numbers for large files */
          lines.map((lineText, i) => (
            <div
              key={i}
              ref={getLineRef(i)}
              className={cn(CODE_ROW, lineRowClass(i), !lineRowClass(i) && CODE_ROW_HOVER)}
            >
              <div className={CODE_GUTTER} style={CODE_GUTTER_STYLE}>
                {i + 1}
              </div>
              <div className={cn(CODE_CONTENT, 'text-[#d4d4d4]')}>
                {lineText || '\u00a0'}
              </div>
            </div>
          ))
        : tokens !== null
          ? /* Tokenized rendering */
            tokens.map((lineTokens, i) => (
              <div
                key={i}
                ref={getLineRef(i)}
                className={cn(CODE_ROW, lineRowClass(i), !lineRowClass(i) && CODE_ROW_HOVER)}
              >
                {/* Gutter */}
                <div className={CODE_GUTTER} style={CODE_GUTTER_STYLE}>
                  {i + 1}
                </div>
                {/* Code tokens */}
                <div className={CODE_CONTENT}>
                  {lineTokens.length === 0
                    ? '\n'
                    : lineTokens.map((token, j) => (
                      <span
                        key={j}
                        style={{
                          color: token.color,
                          fontStyle: token.fontStyle != null && (token.fontStyle & 1) ? 'italic' : undefined,
                          fontWeight: token.fontStyle != null && (token.fontStyle & 2) ? 'bold' : undefined,
                          textDecoration: token.fontStyle != null && (token.fontStyle & 4) ? 'underline' : undefined,
                        }}
                      >
                        {token.content}
                      </span>
                    ))
                  }
                </div>
              </div>
            ))
          : /* Loading state — render plain text while Shiki initializes */
            lines.map((lineText, i) => (
              <div
                key={i}
                ref={getLineRef(i)}
                className={cn(CODE_ROW, lineRowClass(i), !lineRowClass(i) && CODE_ROW_HOVER)}
              >
                <div className={CODE_GUTTER} style={CODE_GUTTER_STYLE}>
                  {i + 1}
                </div>
                <div className={cn(CODE_CONTENT, 'text-[#d4d4d4]')}>
                  {lineText || '\u00a0'}
                </div>
              </div>
            ))
        }
      </div>
    </div>
  )
}

// ============================================================================
// FileBreadcrumb — path segments with clickable directory parts
// ============================================================================

interface FileBreadcrumbProps {
  relativePath: string
  onSegmentClick: (dirPath: string) => void
}

function FileBreadcrumb({ relativePath, onSegmentClick }: FileBreadcrumbProps) {
  const parts = relativePath.replace(/\\/g, '/').split('/')
  return (
    <div className="flex items-center gap-1 min-w-0 overflow-hidden">
      {parts.map((part, i) => {
        const isLast = i === parts.length - 1
        const segmentPath = parts.slice(0, i + 1).join('/')
        return (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-text-tertiary/50 flex-shrink-0">›</span>}
            {isLast ? (
              <span className="text-xs font-semibold text-text-primary truncate">{part}</span>
            ) : (
              <button
                onClick={() => onSegmentClick(segmentPath)}
                className="text-xs text-text-tertiary hover:text-text-secondary transition-colors flex-shrink-0"
              >
                {part}
              </button>
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ============================================================================
// FileViewer
// ============================================================================

export interface FileViewerProps {
  paneId: string
  onClose: () => void
}

export function FileViewer({ paneId, onClose }: FileViewerProps) {
  const openFiles = getPaneStore(paneId)((s) => s.openFiles)
  const activeFilePath = getPaneStore(paneId)((s) => s.activeFilePath)
  const closeFile = getPaneStore(paneId)((s) => s.closeFile)
  const setActiveFile = getPaneStore(paneId)((s) => s.setActiveFile)
  const setDraftContent = getPaneStore(paneId)((s) => s.setDraftContent)
  const commitSave = getPaneStore(paneId)((s) => s.commitSave)
  const discardDraft = getPaneStore(paneId)((s) => s.discardDraft)
  const hasDirtyTabs = getPaneStore(paneId)((s) => s.hasDirtyTabs)
  const changedFilesMap = getFileTreeStore(paneId)((s) => s.changedFilesMap)
  const bridge = getBridge()

  const [showAll, setShowAll] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // ---- Unsaved changes close guard dialog ----
  const [closeGuard, setCloseGuard] = useState<{
    tabKey: string
    relativePath: string
    /** 'tab' = closing a single tab, 'panel' = closing the whole file viewer */
    reason: 'tab' | 'panel'
  } | null>(null)

  // ---- Edit mode state (per-tab, reset when switching tabs) ----
  const [editMode, setEditMode] = useState(false)

  // ---- Editor preferences (persisted to localStorage) ----
  const [wordWrap, setWordWrap] = useState<boolean>(() => readWordWrap())
  const [fontSize, setFontSize] = useState<number>(() => readFontSize())

  const handleWordWrapToggle = useCallback(() => {
    setWordWrap((v) => {
      saveWordWrap(!v)
      return !v
    })
  }, [])

  const handleFontSizeIncrease = useCallback(() => {
    setFontSize((v) => {
      const next = Math.min(v + 1, EDITOR_FONT_SIZE_MAX)
      saveFontSize(next)
      return next
    })
  }, [])

  const handleFontSizeDecrease = useCallback(() => {
    setFontSize((v) => {
      const next = Math.max(v - 1, EDITOR_FONT_SIZE_MIN)
      saveFontSize(next)
      return next
    })
  }, [])

  // ---- Search state ----
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false)
  const [searchMatchIndex, setSearchMatchIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Track previous openFiles.length to detect transition to 0
  const prevOpenFilesLengthRef = useRef(openFiles.length)

  // Reset "show all" AND edit mode when active file changes
  useEffect(() => {
    setShowAll(false)
    setEditMode(false)
  }, [activeFilePath])

  // Reset search when active file changes
  useEffect(() => {
    setSearchQuery('')
    setSearchMatchIndex(0)
  }, [activeFilePath])

  // Close FileViewer panel when all tabs are closed
  useEffect(() => {
    if (prevOpenFilesLengthRef.current > 0 && openFiles.length === 0) {
      onClose()
    }
    prevOpenFilesLengthRef.current = openFiles.length
  }, [openFiles.length, onClose])

  // Cmd+F — open search within FileViewer container (only in view mode;
  // in edit mode CM6 handles it via the container's onKeyDown suppression)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If focus is inside a CodeMirror editor, let it handle Cmd+F
      const targetEl = e.target instanceof HTMLElement ? e.target : null
      if (targetEl?.closest('[data-codemirror="true"]')) return
      if (e.metaKey && e.key === 'f') {
        e.preventDefault()
        setSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 0)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Focus search input when search opens
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 0)
    }
  }, [searchOpen])

  // ---- Save handler ----
  const handleSave = useCallback(async (tabKey: string) => {
    const store = getPaneStore(paneId).getState()
    const file = store.openFiles.find((f) => f.tabKey === tabKey)
    if (!file || file.kind !== 'file' || !file.isDirty || file.draftContent === null) return

    setIsSaving(true)
    try {
      // Tag this save so the file watcher can ignore the resulting change event
      createSaveNonce(file.relativePath)

      await bridge.fsWriteFile(paneId, file.relativePath, file.draftContent)
      commitSave(tabKey)
      toast.success(`Saved ${file.relativePath.split('/').pop() ?? file.relativePath}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('EACCES') || msg.includes('permission denied')) {
        toast.error(`Permission denied — cannot write ${file.relativePath}`)
      } else if (msg.includes('ENOSPC') || msg.includes('disk full') || msg.includes('no space')) {
        toast.error('Disk full — save failed')
      } else if (msg.includes('ENOENT') || msg.includes('no such file')) {
        toast.error(`File no longer exists: ${file.relativePath}`)
      } else {
        toast.error(`Save failed: ${msg}`)
      }
    } finally {
      setIsSaving(false)
    }
  }, [paneId, bridge, commitSave])

  // ---- Guarded tab close (shows dialog if tab is dirty) ----
  const handleCloseTab = useCallback((tabKey: string) => {
    const store = getPaneStore(paneId).getState()
    const file = store.openFiles.find((f) => f.tabKey === tabKey)
    if (file?.kind === 'file' && file.isDirty) {
      setCloseGuard({ tabKey, relativePath: file.relativePath, reason: 'tab' })
    } else {
      closeFile(tabKey)
    }
  }, [paneId, closeFile])

  // ---- Guarded panel close (shows dialog if any tab is dirty) ----
  const handlePanelClose = useCallback(() => {
    const store = getPaneStore(paneId).getState()
    const firstDirty = store.openFiles.find((f) => f.kind === 'file' && f.isDirty)
    if (firstDirty) {
      setCloseGuard({ tabKey: firstDirty.tabKey, relativePath: firstDirty.relativePath, reason: 'panel' })
    } else {
      onClose()
    }
  }, [paneId, onClose])

  // ---- Cmd+S / Ctrl+S save shortcut ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when no active file
      if (!activeFilePath) return
      const isSaveKey = (e.metaKey || e.ctrlKey) && e.key === 's'
      if (!isSaveKey) return
      e.preventDefault()
      void handleSave(activeFilePath)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeFilePath, handleSave])

  // ---- Cmd+= / Cmd+- / Cmd+0 font size shortcuts (only when in edit mode) ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only active when in edit mode
      if (!editMode) return
      if (!(e.metaKey || e.ctrlKey)) return

      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        handleFontSizeIncrease()
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        handleFontSizeDecrease()
      } else if (e.key === '0') {
        e.preventDefault()
        setFontSize(EDITOR_FONT_SIZE_DEFAULT)
        saveFontSize(EDITOR_FONT_SIZE_DEFAULT)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editMode, handleFontSizeIncrease, handleFontSizeDecrease])

  // ---- Window beforeunload guard (dirty tabs) ----
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasDirtyTabs()) {
        e.preventDefault()
        // Modern browsers show a generic message; the returnValue sets it for older ones
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?'
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasDirtyTabs])

  const activeFile = openFiles.find((f) => f.tabKey === activeFilePath) ?? null

  // Compute display content before early returns — hooks must not be conditional
  const isRegularTextFile = Boolean(
    activeFile &&
    activeFile.kind !== 'diff' &&
    !activeFile.isBinary &&
    !isBinaryContent((activeFile as OpenFile).content),
  )
  const rawContent = (isRegularTextFile && activeFile && activeFile.kind === 'file') ? activeFile.content : ''
  const contentLines = rawContent.split('\n')
  const isTruncated = !showAll && contentLines.length > TRUNCATE_LINES
  const displayContent = isTruncated ? contentLines.slice(0, TRUNCATE_LINES).join('\n') : rawContent
  const language = activeFile && activeFile.kind !== 'diff' ? extensionToLanguage(activeFile.relativePath) : 'text'

  // ---- Edit capability check ----
  // Edit is disabled for: binary files, diff views, and truncated files
  // (truncated = content cap hit — editing a partial buffer is unsafe)
  const editDisabledReason: string | null = (() => {
    if (!activeFile || activeFile.kind === 'diff') return 'Editing is not available for diff views'
    if (!isRegularTextFile) return 'Editing is not available for binary files'
    if (activeFile.truncated) return 'Editing is disabled because this file is too large (content was truncated)'
    return null
  })()
  const canEdit = editDisabledReason === null

  // Get the editable content: prefer draftContent if available, else content
  const editorContent = (() => {
    if (!activeFile || activeFile.kind !== 'file') return rawContent
    return activeFile.draftContent ?? activeFile.content
  })()

  // ---- Search match computation (must be before early returns — Rules of Hooks) ----
  const matchLines = useMemo((): number[] => {
    if (!searchQuery || !isRegularTextFile) return []
    const q = searchCaseSensitive ? searchQuery : searchQuery.toLowerCase()
    return displayContent.split('\n')
      .map((line: string, i: number): number => {
        const l = searchCaseSensitive ? line : line.toLowerCase()
        return l.includes(q) ? i : -1
      })
      .filter((i: number): i is number => i !== -1)
  }, [searchQuery, searchCaseSensitive, displayContent, isRegularTextFile])

  const matchLineIndices = useMemo(() => new Set<number>(matchLines), [matchLines])
  const activeMatchLineIndex = matchLines.length > 0 ? (matchLines[searchMatchIndex] ?? null) : null

  // ---- Empty state ----
  if (!activeFile) {
    return (
      <div className="flex h-full w-full flex-1 flex-col bg-bg-secondary border-l border-border min-w-0">
        <FileViewerHeader
          path={null}
          paneId={paneId}
          onClose={handlePanelClose}
          onSearchOpen={() => setSearchOpen(true)}
          fullContent=""
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center px-6">
          <FileText className="size-8 text-text-tertiary opacity-40" />
          <p className="text-sm text-text-tertiary">
            No file selected
          </p>
          <p className="text-xs text-text-tertiary/60 max-w-[200px] leading-relaxed">
            Open a file from the Explorer to view it here.
          </p>
        </div>
      </div>
    )
  }

  if (activeFile.kind === 'diff') {
    const diffLines = parseUnifiedDiff(activeFile.diffText)
    const fullContent = activeFile.diffText ?? ''

    return (
      <div className="flex h-full w-full flex-1 flex-col bg-bg-secondary border-l border-border min-w-0">
        <FileViewerHeader
          path={activeFile.relativePath}
          paneId={paneId}
          mode="diff"
          onClose={handlePanelClose}
          onSearchOpen={() => {}}
          fullContent={fullContent}
          diffStatus={activeFile.status}
          previousPath={activeFile.previousPath}
        />

        <TabStrip
          openFiles={openFiles}
          activeFilePath={activeFilePath}
          changedFilesMap={changedFilesMap}
          closeFile={handleCloseTab}
          setActiveFile={setActiveFile}
        />

        <div className={cn('flex-1 overflow-auto min-h-0', CODE_BG)}>
          {activeFile.isBinary ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <GitBranch className="size-8 text-text-tertiary opacity-40" />
              <p className="text-sm text-text-tertiary">Binary diff preview unavailable</p>
            </div>
          ) : diffLines.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <GitBranch className="size-8 text-text-tertiary opacity-40" />
              <p className="text-sm text-text-tertiary">No textual diff to display</p>
            </div>
          ) : (
            <UnifiedDiffView lines={diffLines} />
          )}
        </div>
      </div>
    )
  }

  // By this point activeFile.kind is always 'file' (diff was handled above)
  const activeFileAsFile = activeFile as OpenFile
  const { relativePath, content, isBinary } = activeFileAsFile

  // ---- Binary detection ----
  if (!isRegularTextFile) {
    return (
      <div className="flex h-full w-full flex-1 flex-col bg-bg-secondary border-l border-border min-w-0">
        <FileViewerHeader
          path={relativePath}
          paneId={paneId}
          onClose={handlePanelClose}
          onSearchOpen={() => setSearchOpen(true)}
          fullContent=""
        />
        <TabStrip
          openFiles={openFiles}
          activeFilePath={activeFilePath}
          changedFilesMap={changedFilesMap}
          closeFile={handleCloseTab}
          setActiveFile={setActiveFile}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center px-6">
          <FileText className="size-8 text-text-tertiary opacity-40" />
          <p className="text-sm text-text-tertiary">Binary file — preview unavailable</p>
          <p className="text-xs font-mono text-text-tertiary/60 mt-1 break-all">{relativePath}</p>
        </div>
      </div>
    )
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && matchLines.length > 0) {
      e.preventDefault()
      if (e.shiftKey) {
        setSearchMatchIndex((i) => (i - 1 + matchLines.length) % matchLines.length)
      } else {
        setSearchMatchIndex((i) => (i + 1) % matchLines.length)
      }
    }
    if (e.key === 'Escape') {
      setSearchOpen(false)
      setSearchQuery('')
    }
  }

  const handleEditorUpdate = useCallback((content: string) => {
    if (activeFilePath) {
      setDraftContent(activeFilePath, content)
    }
  }, [activeFilePath, setDraftContent])

  return (
    <>
    {/* Unsaved changes close guard dialog */}
    {closeGuard && (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label="Unsaved changes"
      >
        <div className="bg-bg-secondary border border-border rounded-lg shadow-2xl p-6 max-w-md w-full mx-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 size-8 rounded-full bg-amber-500/15 flex items-center justify-center">
              <AlertTriangle className="size-4 text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Unsaved changes</h2>
              <p className="text-xs text-text-tertiary mt-0.5 truncate max-w-xs">
                {closeGuard.relativePath.split('/').pop()}
              </p>
            </div>
          </div>
          <p className="text-xs text-text-secondary mb-6">
            {closeGuard.reason === 'panel'
              ? 'You have unsaved changes. Closing the file viewer will discard your edits.'
              : 'This file has unsaved changes. Do you want to save before closing?'}
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setCloseGuard(null)}
              className="px-3 py-1.5 text-xs text-text-secondary border border-border rounded hover:bg-bg-hover transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                // Discard and proceed
                const store = getPaneStore(paneId).getState()
                if (closeGuard.reason === 'tab') {
                  store.clearDraftContent(closeGuard.tabKey)
                  store.closeFile(closeGuard.tabKey)
                } else {
                  // Close panel — discard all dirty tabs first
                  store.openFiles.forEach((f) => {
                    if (f.kind === 'file' && f.isDirty) store.clearDraftContent(f.tabKey)
                  })
                  onClose()
                }
                setCloseGuard(null)
              }}
              className="px-3 py-1.5 text-xs text-text-secondary border border-border rounded hover:bg-bg-hover transition-colors"
            >
              Discard
            </button>
            {closeGuard.reason === 'tab' && (
              <button
                onClick={async () => {
                  await handleSave(closeGuard.tabKey)
                  getPaneStore(paneId).getState().closeFile(closeGuard.tabKey)
                  setCloseGuard(null)
                }}
                className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/80 transition-colors"
              >
                Save & close
              </button>
            )}
          </div>
        </div>
      </div>
    )}
    <div className="flex h-full w-full flex-1 flex-col bg-bg-secondary border-l border-border min-w-0">
      <FileViewerHeader
        path={relativePath}
        paneId={paneId}
        onClose={handlePanelClose}
        onSearchOpen={() => { setSearchOpen(true) }}
        fullContent={editMode ? (activeFileAsFile.draftContent ?? content) : content}
        editMode={editMode}
        canEdit={canEdit}
        editDisabledReason={editDisabledReason}
        onEditToggle={() => setEditMode((v) => !v)}
        wordWrap={wordWrap}
        onWordWrapToggle={handleWordWrapToggle}
        fontSize={fontSize}
        onFontSizeIncrease={handleFontSizeIncrease}
        onFontSizeDecrease={handleFontSizeDecrease}
      />

      {/* Tab strip */}
      <TabStrip
        openFiles={openFiles}
        activeFilePath={activeFilePath}
        changedFilesMap={changedFilesMap}
        closeFile={handleCloseTab}
        setActiveFile={setActiveFile}
      />

      {/* Edit mode: CodeMirror editor */}
      {editMode && canEdit && activeFile?.kind === 'file' ? (
        <div className={cn('flex-1 min-h-0', CODE_BG)}>
          <Suspense fallback={
            <div className={cn('flex-1 h-full flex items-center justify-center', CODE_BG)}>
              <span className="text-xs text-text-tertiary">Loading editor...</span>
            </div>
          }>
            <CodeEditor
              key={activeFilePath ?? ''}
              filePath={relativePath}
              initialContent={editorContent}
              onUpdate={handleEditorUpdate}
              wordWrap={wordWrap}
              fontSize={fontSize}
              className="h-full"
            />
          </Suspense>
        </div>
      ) : (
        <>
          {/* Search bar — only shown in view mode */}
          {searchOpen && (
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 bg-bg-secondary flex-shrink-0">
              <Search className="size-3 text-text-tertiary flex-shrink-0" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setSearchMatchIndex(0) }}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search..."
                className="flex-1 bg-transparent text-[12px] text-text-primary placeholder:text-text-tertiary outline-none"
              />
              {/* Match count */}
              <span className="text-[11px] text-text-tertiary flex-shrink-0">
                {matchLines.length > 0
                  ? `${searchMatchIndex + 1} / ${matchLines.length}`
                  : searchQuery
                    ? '0 results'
                    : ''}
              </span>
              {/* Case sensitive toggle */}
              <button
                onClick={() => setSearchCaseSensitive((v) => !v)}
                className={cn(
                  'text-[11px] px-1 rounded',
                  searchCaseSensitive ? 'text-accent bg-accent/10' : 'text-text-tertiary',
                )}
                title="Case sensitive"
              >
                Aa
              </button>
              {/* Close */}
              <button
                onClick={() => { setSearchOpen(false); setSearchQuery('') }}
                className="text-text-tertiary hover:text-text-primary"
              >
                <X className="size-3" />
              </button>
            </div>
          )}

          {/* Scrollable code area */}
          <div className={cn('flex-1 overflow-auto min-h-0', CODE_BG)}>
            <HighlightedCode
              code={displayContent}
              language={language}
              matchLineIndices={matchLineIndices}
              activeMatchLineIndex={activeMatchLineIndex}
            />

            {/* Truncation notice */}
            {isTruncated && (
              <div className="flex items-center justify-center py-3 px-4 border-t border-border/30 bg-bg-secondary/80">
                <span className="text-xs text-text-tertiary mr-3">
                  Showing first {TRUNCATE_LINES} of {contentLines.length} lines
                </span>
                <button
                  onClick={() => setShowAll(true)}
                  className="text-xs text-accent hover:text-accent-hover underline underline-offset-2 transition-colors"
                >
                  Show all {contentLines.length} lines
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
    </>
  )
}

// ============================================================================
// TabStrip
// ============================================================================

interface TabStripProps {
  openFiles: OpenViewerItem[]
  activeFilePath: string | null
  changedFilesMap: Map<string, { status: GitChangeStatus }>
  closeFile: (tabKey: string) => void
  setActiveFile: (tabKey: string) => void
}

function TabStrip({ openFiles, activeFilePath, changedFilesMap, closeFile, setActiveFile }: TabStripProps) {
  if (openFiles.length === 0) return null

  return (
    <div className={cn('flex overflow-x-auto border-b border-border/60 flex-shrink-0 scrollbar-none', CODE_BG)}>
      {openFiles.map((file) => {
        const fileName = file.relativePath.split('/').pop() ?? file.relativePath
        const isActive = file.tabKey === activeFilePath
        const fileChange = changedFilesMap.get(file.relativePath)
        const isGitModified = Boolean(fileChange)
        // Show an editor-dirty dot when the file has unsaved edits in the editor
        const isEditorDirty = file.kind === 'file' && file.isDirty
        return (
          <div
            key={file.tabKey}
            role="tab"
            aria-selected={isActive}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 text-xs flex-shrink-0 cursor-pointer border-r border-border/30',
              'transition-colors max-w-[160px]',
              isActive
                ? 'bg-bg-secondary text-text-primary border-t-2 border-t-accent border-b-0'
                : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover',
            ].join(' ')}
            onClick={() => setActiveFile(file.tabKey)}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeFile(file.tabKey) } }}
            title={file.relativePath + (isEditorDirty ? ' (unsaved changes)' : '')}
          >
            {/* Git modification dot */}
            {isGitModified && (
              <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', fileChange?.status === 'D' ? 'bg-red-400' : fileChange?.status === 'A' || fileChange?.status === '??' ? 'bg-emerald-400' : fileChange?.status === 'R' ? 'bg-sky-400' : 'bg-amber-400')} />
            )}
            {/* Editor unsaved changes dot */}
            {isEditorDirty && !isGitModified && (
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" aria-label="unsaved changes" />
            )}
            {file.kind === 'diff' && <GitBranch className="size-3 text-text-tertiary flex-shrink-0" />}
            <span className="truncate">{fileName}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeFile(file.tabKey) }}
              className="size-3.5 flex-shrink-0 flex items-center justify-center rounded hover:bg-white/10 text-text-tertiary hover:text-text-primary"
              aria-label={`Close ${fileName}`}
            >
              <X className="size-2.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ============================================================================
// FileViewerHeader
// ============================================================================

interface FileViewerHeaderProps {
  path: string | null
  paneId: string
  mode?: 'file' | 'diff'
  onClose: () => void
  onSearchOpen: () => void
  fullContent: string
  diffStatus?: GitChangeStatus
  previousPath?: string
  /** Whether the editor is currently in edit mode. */
  editMode?: boolean
  /** Whether edit mode can be activated for this file. */
  canEdit?: boolean
  /** Explanation of why edit is unavailable (shown as tooltip). */
  editDisabledReason?: string | null
  /** Callback to toggle edit/view mode. */
  onEditToggle?: () => void
  /** Whether word wrap is currently enabled (shown only in edit mode). */
  wordWrap?: boolean
  /** Callback to toggle word wrap. */
  onWordWrapToggle?: () => void
  /** Current editor font size (shown only in edit mode). */
  fontSize?: number
  /** Callback to increase font size. */
  onFontSizeIncrease?: () => void
  /** Callback to decrease font size. */
  onFontSizeDecrease?: () => void
}

function FileViewerHeader({
  path,
  paneId,
  mode = 'file',
  onClose,
  onSearchOpen,
  fullContent,
  diffStatus,
  previousPath,
  editMode = false,
  canEdit = false,
  editDisabledReason = null,
  onEditToggle,
  wordWrap = false,
  onWordWrapToggle,
  fontSize = EDITOR_FONT_SIZE_DEFAULT,
  onFontSizeIncrease,
  onFontSizeDecrease,
}: FileViewerHeaderProps) {
  const handleSegmentClick = useCallback((segmentPath: string) => {
    void getFileTreeStore(paneId).getState().toggleDir(segmentPath)
  }, [paneId])

  return (
    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-bg-tertiary flex-shrink-0 min-w-0">
      {/* File icon */}
      {mode === 'diff' ? (
        <GitBranch className="size-3.5 text-text-tertiary flex-shrink-0" />
      ) : (
        <FileText className="size-3.5 text-text-tertiary flex-shrink-0" />
      )}

      {/* Breadcrumb or placeholder */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {path ? (
          <div className="flex min-w-0 items-center gap-2">
            <FileBreadcrumb relativePath={path} onSegmentClick={handleSegmentClick} />
            {mode === 'diff' && diffStatus && (
              <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold flex-shrink-0', getDiffStatusBadgeClass(diffStatus))}>
                {diffStatus}
              </span>
            )}
            {mode === 'diff' && previousPath && (
              <span className="truncate text-[10px] text-text-tertiary">
                from {previousPath}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-text-tertiary">File Viewer</span>
        )}
      </div>

      {/* Edit mode toggle button — only shown for regular files */}
      {path && mode === 'file' && (
        <button
          onClick={canEdit ? onEditToggle : undefined}
          disabled={!canEdit}
          title={
            editDisabledReason
              ? editDisabledReason
              : editMode
                ? 'Switch to read-only view (view mode)'
                : 'Edit file (edit mode)'
          }
          className={cn(
            'flex items-center justify-center size-5 rounded transition-colors flex-shrink-0',
            canEdit
              ? editMode
                ? 'text-accent bg-accent/10 hover:bg-accent/20'
                : 'text-text-tertiary hover:text-text-primary hover:bg-bg-hover'
              : 'text-text-tertiary/30 cursor-not-allowed',
          )}
          aria-label={editMode ? 'Switch to view mode' : 'Edit file'}
          aria-pressed={editMode}
        >
          {editMode ? <Eye className="size-3.5" /> : <Pencil className="size-3.5" />}
        </button>
      )}

      {/* Editor toolbar — only shown in edit mode */}
      {path && mode === 'file' && editMode && (
        <>
          {/* Word wrap toggle */}
          <button
            onClick={onWordWrapToggle}
            title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
            className={cn(
              'flex items-center justify-center size-5 rounded transition-colors flex-shrink-0',
              wordWrap
                ? 'text-accent bg-accent/10 hover:bg-accent/20'
                : 'text-text-tertiary hover:text-text-primary hover:bg-bg-hover',
            )}
            aria-label={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
            aria-pressed={wordWrap}
          >
            <WrapText className="size-3.5" />
          </button>

          {/* Font size controls */}
          <div className="flex items-center gap-0.5 flex-shrink-0" title={`Font size: ${fontSize}px (⌘= / ⌘-)`}>
            <button
              onClick={onFontSizeDecrease}
              disabled={fontSize <= EDITOR_FONT_SIZE_MIN}
              title={`Decrease font size (⌘-)`}
              className="flex items-center justify-center size-5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Decrease font size"
            >
              <ZoomOut className="size-3.5" />
            </button>
            <span className="text-[10px] text-text-tertiary tabular-nums w-6 text-center select-none">
              {fontSize}
            </span>
            <button
              onClick={onFontSizeIncrease}
              disabled={fontSize >= EDITOR_FONT_SIZE_MAX}
              title={`Increase font size (⌘=)`}
              className="flex items-center justify-center size-5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Increase font size"
            >
              <ZoomIn className="size-3.5" />
            </button>
          </div>
        </>
      )}

      {/* Search button — only in view mode */}
      {path && mode === 'file' && !editMode && (
        <button
          onClick={onSearchOpen}
          title="Search in file (⌘F)"
          className="flex items-center justify-center size-5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors flex-shrink-0"
          aria-label="Search in file"
        >
          <Search className="size-3.5" />
        </button>
      )}

      {/* Copy button */}
      {fullContent && <CopyButton text={fullContent} />}

      {/* Close button */}
      <button
        onClick={onClose}
        className="flex items-center justify-center size-5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors flex-shrink-0 ml-1"
        title="Close file viewer"
        aria-label="Close file viewer"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

function UnifiedDiffView({ lines }: { lines: ParsedDiffLine[] }) {
  return (
    <div className={cn('overflow-x-auto', CODE_BG)}>
      {/* eslint-disable-next-line react/forbid-dom-props */}
      <div style={{ minWidth: '100%', width: 'max-content' }}>
        {lines.map((line, index) => {
        const hasRowBg = line.kind === 'add' || line.kind === 'remove' || line.kind === 'hunk' || line.kind === 'meta'
        return (
          <div
            key={`${index}-${line.text}`}
            className={cn(
              CODE_ROW,
              line.kind === 'add' && 'bg-emerald-500/10',
              line.kind === 'remove' && 'bg-red-500/10',
              line.kind === 'hunk' && 'bg-sky-500/10',
              line.kind === 'meta' && 'bg-white/5',
              !hasRowBg && CODE_ROW_HOVER,
            )}
          >
            {/* Old line number */}
            <div className={CODE_GUTTER} style={CODE_GUTTER_STYLE}>
              {line.oldLineNumber ?? ''}
            </div>
            {/* New line number */}
            <div className={CODE_GUTTER} style={CODE_GUTTER_STYLE}>
              {line.newLineNumber ?? ''}
            </div>
            {/* Content */}
            <div className={cn(
              CODE_CONTENT,
              line.kind === 'add' && 'text-emerald-100',
              line.kind === 'remove' && 'text-red-100',
              line.kind === 'hunk' && 'text-sky-200',
              line.kind === 'meta' && 'text-text-tertiary',
              (line.kind === 'context') && 'text-[#d4d4d4]',
            )}>
              {line.text || ' '}
            </div>
          </div>
        )
      })}
      </div>
    </div>
  )
}
