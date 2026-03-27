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
 * - Calls onClose() when last tab is closed
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { ThemedToken } from 'shiki'
import { getPaneStore } from '../store/pane-store'
import { getFileTreeStore } from '../store/file-tree-store'
import { getHighlighter } from '../lib/highlighter'
import { cn } from '../lib/utils'
import { X, Copy, Check, FileText } from 'lucide-react'

// ============================================================================
// Constants
// ============================================================================

const TRUNCATE_LINES = 500
/** Lines at or above this threshold skip Shiki and render plain text. */
const HIGHLIGHT_LINE_LIMIT = 2000

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
    // Allow tab (9), newline (10), carriage return (13), and printable range (32–126)
    if (code !== 9 && code !== 10 && code !== 13 && (code < 32 || code > 126)) {
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

/**
 * Shorten a long file path for display in the header.
 * Shows the last 2–3 path segments if the full path is long.
 */
function shortenPath(path: string, maxLength = 60): string {
  if (path.length <= maxLength) return path
  const parts = path.replace(/\\/g, '/').split('/')
  // Always show at least last 2 segments
  let shortened = parts.slice(-2).join('/')
  let i = parts.length - 3
  while (i >= 0 && ('.../' + parts.slice(i).join('/')).length <= maxLength) {
    shortened = parts.slice(i).join('/')
    i--
  }
  return '.../' + shortened
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
}

function HighlightedCode({ code, language }: HighlightedCodeProps) {
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null)
  const lines = code.split('\n')
  const isLarge = lines.length >= HIGHLIGHT_LINE_LIMIT

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
          theme: 'github-dark-default',
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

  return (
    <div className="overflow-x-auto bg-[#0d1117]">
      {/* Large file banner */}
      {isLarge && (
        <div className="px-4 py-1.5 text-[11px] text-amber-400/80 bg-amber-400/5 border-b border-amber-400/10 font-mono">
          File too large for syntax highlighting — showing plain text
        </div>
      )}

      {isLarge
        ? /* Plain text with line numbers for large files */
          lines.map((lineText, i) => (
            <div key={i} className="flex items-stretch hover:bg-white/5 group/line">
              <div
                className="w-[3.5rem] flex-shrink-0 pr-3 text-right text-[12px] font-mono text-[#636e7b] border-r border-white/5 select-none cursor-default"
                style={{ lineHeight: '1.6' }}
              >
                {i + 1}
              </div>
              <div className="flex-1 pl-4 whitespace-pre font-mono text-[13px] leading-[1.6] select-text min-w-0 text-[#e6edf3]">
                {lineText || '\u00a0'}
              </div>
            </div>
          ))
        : tokens !== null
          ? /* Tokenized rendering */
            tokens.map((lineTokens, i) => (
              <div key={i} className="flex items-stretch hover:bg-white/5 group/line">
                {/* Gutter */}
                <div
                  className="w-[3.5rem] flex-shrink-0 pr-3 text-right text-[12px] font-mono text-[#636e7b] border-r border-white/5 select-none cursor-default"
                  style={{ lineHeight: '1.6' }}
                >
                  {i + 1}
                </div>
                {/* Code tokens */}
                <div className="flex-1 pl-4 whitespace-pre font-mono text-[13px] leading-[1.6] select-text min-w-0">
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
          : /* Loading state — render nothing while Shiki initializes */
            null
      }
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
  const modifiedFiles = getFileTreeStore(paneId)((s) => s.modifiedFiles)

  const [showAll, setShowAll] = useState(false)

  // Track previous openFiles.length to detect transition to 0
  const prevOpenFilesLengthRef = useRef(openFiles.length)

  // Reset "show all" when active file changes
  useEffect(() => {
    setShowAll(false)
  }, [activeFilePath])

  // Close FileViewer panel when all tabs are closed
  useEffect(() => {
    if (prevOpenFilesLengthRef.current > 0 && openFiles.length === 0) {
      onClose()
    }
    prevOpenFilesLengthRef.current = openFiles.length
  }, [openFiles.length, onClose])

  const activeFile = openFiles.find((f) => f.relativePath === activeFilePath) ?? null

  // ---- Empty state ----
  if (!activeFile) {
    return (
      <div className="flex flex-col h-full bg-bg-secondary border-l border-border">
        <FileViewerHeader path={null} onClose={onClose} fullContent="" />
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

  const { relativePath, content, isBinary } = activeFile

  // ---- Binary detection ----
  if (isBinary || isBinaryContent(content)) {
    return (
      <div className="flex flex-col h-full bg-bg-secondary border-l border-border">
        <FileViewerHeader path={relativePath} onClose={onClose} fullContent="" />
        <TabStrip
          openFiles={openFiles}
          activeFilePath={activeFilePath}
          modifiedFiles={modifiedFiles}
          closeFile={closeFile}
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

  // ---- Line truncation ----
  const lines = content.split('\n')
  const isTruncated = !showAll && lines.length > TRUNCATE_LINES
  const displayContent = isTruncated ? lines.slice(0, TRUNCATE_LINES).join('\n') : content
  const language = extensionToLanguage(relativePath)

  return (
    <div className="flex flex-col h-full bg-bg-secondary border-l border-border min-w-0">
      <FileViewerHeader path={relativePath} onClose={onClose} fullContent={content} />

      {/* Tab strip */}
      <TabStrip
        openFiles={openFiles}
        activeFilePath={activeFilePath}
        modifiedFiles={modifiedFiles}
        closeFile={closeFile}
        setActiveFile={setActiveFile}
      />

      {/* Scrollable code area */}
      <div className="flex-1 overflow-auto min-h-0 bg-[#0d1117]">
        <HighlightedCode code={displayContent} language={language} />

        {/* Truncation notice */}
        {isTruncated && (
          <div className="flex items-center justify-center py-3 px-4 border-t border-border/30 bg-bg-secondary/80">
            <span className="text-xs text-text-tertiary mr-3">
              Showing first {TRUNCATE_LINES} of {lines.length} lines
            </span>
            <button
              onClick={() => setShowAll(true)}
              className="text-xs text-accent hover:text-accent-hover underline underline-offset-2 transition-colors"
            >
              Show all {lines.length} lines
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// TabStrip
// ============================================================================

interface TabStripProps {
  openFiles: Array<{ relativePath: string }>
  activeFilePath: string | null
  modifiedFiles: Set<string>
  closeFile: (relativePath: string) => void
  setActiveFile: (relativePath: string) => void
}

function TabStrip({ openFiles, activeFilePath, modifiedFiles, closeFile, setActiveFile }: TabStripProps) {
  if (openFiles.length === 0) return null

  return (
    <div className="flex overflow-x-auto border-b border-border/60 bg-[#0d1117] flex-shrink-0 scrollbar-none">
      {openFiles.map((file) => {
        const fileName = file.relativePath.split('/').pop() ?? file.relativePath
        const isActive = file.relativePath === activeFilePath
        const isModified = modifiedFiles.has(file.relativePath)
        return (
          <div
            key={file.relativePath}
            role="tab"
            aria-selected={isActive}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 text-xs flex-shrink-0 cursor-pointer border-r border-border/30',
              'transition-colors max-w-[160px]',
              isActive
                ? 'bg-bg-secondary text-text-primary border-t-2 border-t-accent border-b-0'
                : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover',
            ].join(' ')}
            onClick={() => setActiveFile(file.relativePath)}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeFile(file.relativePath) } }}
            title={file.relativePath}
          >
            {isModified && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
            )}
            <span className="truncate">{fileName}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeFile(file.relativePath) }}
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
  onClose: () => void
  fullContent: string
}

function FileViewerHeader({ path, onClose, fullContent }: FileViewerHeaderProps) {
  const fileName = path ? path.replace(/\\/g, '/').split('/').pop() ?? path : null
  const shortPath = path ? shortenPath(path) : null

  return (
    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-bg-tertiary flex-shrink-0 min-w-0">
      {/* File icon */}
      <FileText className="size-3.5 text-text-tertiary flex-shrink-0" />

      {/* File path */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {fileName ? (
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold text-text-primary truncate leading-tight">
              {fileName}
            </span>
            {shortPath && shortPath !== fileName && (
              <span className="text-[10px] text-text-tertiary truncate leading-tight mt-0.5" title={path ?? ''}>
                {shortPath}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-text-tertiary">File Viewer</span>
        )}
      </div>

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
