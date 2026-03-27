/**
 * FileViewer — right-side panel that displays file content from agent tool events.
 *
 * Features:
 * - Syntax highlighted via the shared Shiki highlighter singleton
 * - Language detection from file extension
 * - Large file truncation at ~500 lines with "Show more" toggle
 * - Binary file detection (null bytes / non-UTF-8 characters)
 * - Read-only display with copy-to-clipboard support
 * - Close button and empty state
 */

import { useState, useEffect, useCallback } from 'react'
import { useChatStore } from '../store/chat'
import type { ViewedFile } from '../store/chat'
import { getHighlighter } from '../lib/highlighter'
import { cn } from '../lib/utils'
import { X, Copy, Check, FileText, Eye, PenLine } from 'lucide-react'

// ============================================================================
// Constants
// ============================================================================

const TRUNCATE_LINES = 500

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
// HighlightedCode — async syntax highlighted code view
// ============================================================================

interface HighlightedCodeProps {
  code: string
  language: string
}

function HighlightedCode({ code, language }: HighlightedCodeProps) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const doHighlight = async () => {
      try {
        const hl = await getHighlighter()
        const result = hl.codeToHtml(code, {
          lang: language || 'text',
          theme: 'github-dark-default',
        })
        if (!cancelled) setHtml(result)
      } catch {
        // Unknown language or error — fall back to plain text display
        if (!cancelled) setHtml(null)
      }
    }

    void doHighlight()
    return () => { cancelled = true }
  }, [code, language])

  if (html) {
    return (
      <div
        className="text-[12.5px] leading-[1.6] [&_pre]:p-4 [&_pre]:m-0 [&_pre]:bg-transparent! [&_code]:bg-transparent! min-w-0"
        // Safe: Shiki output is sanitized HTML with no user-controlled URLs
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  return (
    <pre className="p-4 text-[12.5px] leading-[1.6] text-text-primary font-mono bg-[#0d1117] min-w-0 whitespace-pre">
      <code>{code}</code>
    </pre>
  )
}

// ============================================================================
// FileViewer
// ============================================================================

export interface FileViewerProps {
  onClose: () => void
}

export function FileViewer({ onClose }: FileViewerProps) {
  const viewedFile = useChatStore((s) => s.viewedFile)
  const [showAll, setShowAll] = useState(false)

  // Reset "show all" when file changes
  useEffect(() => {
    setShowAll(false)
  }, [viewedFile?.path])

  // ---- Empty state ----
  if (!viewedFile) {
    return (
      <div className="flex flex-col h-full bg-bg-secondary border-l border-border">
        <FileViewerHeader path={null} tool={null} onClose={onClose} fullContent="" />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center px-6">
          <FileText className="size-8 text-text-tertiary opacity-40" />
          <p className="text-sm text-text-tertiary">
            No file selected
          </p>
          <p className="text-xs text-text-tertiary/60 max-w-[200px] leading-relaxed">
            File activity will appear here when the agent reads or writes files.
          </p>
        </div>
      </div>
    )
  }

  const { path, content, tool } = viewedFile

  // ---- Binary detection ----
  if (isBinaryContent(content)) {
    return (
      <div className="flex flex-col h-full bg-bg-secondary border-l border-border">
        <FileViewerHeader path={path} tool={tool} onClose={onClose} fullContent={content} />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center px-6">
          <FileText className="size-8 text-text-tertiary opacity-40" />
          <p className="text-sm text-text-tertiary">Binary file — preview unavailable</p>
          <p className="text-xs font-mono text-text-tertiary/60 mt-1 break-all">{path}</p>
        </div>
      </div>
    )
  }

  // ---- Line truncation ----
  const lines = content.split('\n')
  const isTruncated = !showAll && lines.length > TRUNCATE_LINES
  const displayContent = isTruncated ? lines.slice(0, TRUNCATE_LINES).join('\n') : content
  const language = extensionToLanguage(path)

  return (
    <div className="flex flex-col h-full bg-bg-secondary border-l border-border min-w-0">
      <FileViewerHeader path={path} tool={tool} onClose={onClose} fullContent={content} />

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
// FileViewerHeader
// ============================================================================

interface FileViewerHeaderProps {
  path: string | null
  tool: 'read' | 'write' | null
  onClose: () => void
  fullContent: string
}

function FileViewerHeader({ path, tool, onClose, fullContent }: FileViewerHeaderProps) {
  const fileName = path ? path.replace(/\\/g, '/').split('/').pop() ?? path : null
  const shortPath = path ? shortenPath(path) : null

  return (
    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-bg-tertiary flex-shrink-0 min-w-0">
      {/* Tool badge */}
      {tool === 'read' ? (
        <Eye className="size-3.5 text-blue-400 flex-shrink-0" aria-label="Read" />
      ) : tool === 'write' ? (
        <PenLine className="size-3.5 text-amber-400 flex-shrink-0" aria-label="Write" />
      ) : (
        <FileText className="size-3.5 text-text-tertiary flex-shrink-0" />
      )}

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
