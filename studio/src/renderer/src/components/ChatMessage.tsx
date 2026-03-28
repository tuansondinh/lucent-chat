/**
 * ChatMessage — renders a single message bubble with rich markdown support.
 *
 * Features:
 * - react-markdown + remark-gfm for full markdown rendering
 * - Shiki syntax highlighting for code blocks
 * - Copy button per message and per code block
 * - Streaming cursor animation
 * - Tool call display with collapsible details
 * - Thinking block (collapsible, collapsed when done)
 * - Error message styling
 * - Chronological content blocks (thinking → tool → text order preserved)
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import type { ChatMessage as ChatMsg, ContentBlock, SubItem } from '../store/chat'
import { getMessageText } from '../store/chat'
import { getHighlighter } from '../lib/highlighter'
import { cn } from '../lib/utils'
import {
  ChevronRight,
  ChevronDown,
  Check,
  X,
  Loader2,
  Copy,
  AlertCircle,
  Brain,
} from 'lucide-react'

// ============================================================================
// Types
// ============================================================================

interface Props {
  message: ChatMsg
  projectRoot: string
  onOpenFileReference?: (relativePath: string) => Promise<void> | void
}

function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href)
  } catch {
    return href
  }
}

function stripFileReferenceSuffix(path: string): string {
  return path.replace(/:\d+(?::\d+)?$/, '')
}

function resolveFileReferenceHref(href: string, projectRoot: string): string | null {
  const decodedHref = decodeHref(href)
  const [withoutQuery] = decodedHref.split('?')
  const [pathOnly] = withoutQuery.split('#')
  if (!pathOnly) return null

  if (pathOnly.startsWith('http://') || pathOnly.startsWith('https://')) {
    return null
  }

  let candidate = pathOnly
  if (candidate.startsWith('file://')) {
    candidate = candidate.slice('file://'.length)
  }

  candidate = stripFileReferenceSuffix(candidate).replace(/\\/g, '/')
  const normalizedRoot = projectRoot.replace(/\\/g, '/').replace(/\/$/, '')

  if (!candidate) return null
  if (!candidate.startsWith('/')) {
    return candidate.replace(/^\.\/+/, '')
  }
  if (!normalizedRoot) return null
  if (candidate === normalizedRoot) return ''
  if (!candidate.startsWith(`${normalizedRoot}/`)) return null
  return candidate.slice(normalizedRoot.length + 1)
}

// ============================================================================
// Streaming cursor
// ============================================================================

function StreamingCursor() {
  return (
    <span
      className="ml-0.5 inline-block w-[2px] h-[1em] bg-accent animate-pulse align-middle"
      aria-hidden="true"
    />
  )
}

// ============================================================================
// Copy button
// ============================================================================

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success('Copied to clipboard')
    } catch {
      // clipboard unavailable — silently ignore
    }
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className={cn(
        'flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors',
        'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover',
        className,
      )}
      title="Copy"
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <Check className="size-3 text-green-400" />
      ) : (
        <Copy className="size-3" />
      )}
    </button>
  )
}

// ============================================================================
// Code block with Shiki highlighting
// ============================================================================

interface CodeBlockProps {
  code: string
  language: string
  isStreaming?: boolean
}

function CodeBlock({ code, language, isStreaming }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    // Don't highlight very short or empty strings or during active streaming
    // to avoid constant re-highlights; debounce by not highlighting mid-stream
    // for blocks that are clearly incomplete (no closing ```)
    const doHighlight = async () => {
      try {
        const hl = await getHighlighter()
        const result = hl.codeToHtml(code, {
          lang: language || 'text',
          theme: 'github-dark-default',
        })
        if (!cancelled) setHtml(result)
      } catch {
        // Unknown language or error — fall back to plain text
        if (!cancelled) setHtml(null)
      }
    }

    void doHighlight()
    return () => { cancelled = true }
  }, [code, language])

  const displayLang = language || 'text'

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-border">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-bg-tertiary border-b border-border">
        <span className="text-[11px] font-mono text-text-tertiary uppercase tracking-wide">
          {displayLang}
        </span>
        <CopyButton text={code} />
      </div>

      {/* Code content */}
      {html ? (
        <div
          className="overflow-x-auto text-[13px] leading-6 [&_pre]:p-4 [&_pre]:m-0 [&_pre]:bg-transparent! [&_code]:bg-transparent!"
          // Safe: Shiki output is sanitized HTML with no user-controlled URLs
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto p-4 text-[13px] leading-6 text-text-primary font-mono bg-[#0d1117]">
          <code>{code}</code>
        </pre>
      )}

      {isStreaming && (
        <div className="px-4 pb-2">
          <StreamingCursor />
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Thinking block — collapsible, collapsed by default when done
// ============================================================================

type ThinkingBlockData = Extract<ContentBlock, { type: 'thinking' }>

function ThinkingBlock({ block }: { block: ThinkingBlockData }) {
  // Expanded while streaming, collapsed once done
  const [expanded, setExpanded] = useState(block.isStreaming)

  // Collapse when streaming ends
  useEffect(() => {
    if (!block.isStreaming) {
      setExpanded(false)
    }
  }, [block.isStreaming])

  return (
    <div className="mb-2 rounded-md overflow-hidden border border-border/40">
      <button
        className={cn(
          'flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-left transition-colors',
          'bg-bg-tertiary/60 hover:bg-bg-tertiary',
          'text-text-tertiary',
        )}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <Brain className="size-3 flex-shrink-0 text-accent/60" />
        <span className="flex-1 font-mono">
          {block.isStreaming ? 'Thinking...' : 'Thought'}
        </span>
        {block.isStreaming && (
          <Loader2 className="size-3 animate-spin text-accent/60 flex-shrink-0" />
        )}
        {!block.isStreaming && (
          expanded
            ? <ChevronDown className="size-3 flex-shrink-0" />
            : <ChevronRight className="size-3 flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/30 px-3 py-2 bg-bg-primary/40 max-h-60 overflow-y-auto">
          <pre className="whitespace-pre-wrap break-words text-[11px] leading-5 text-text-tertiary font-mono">
            {block.text}
            {block.isStreaming && <StreamingCursor />}
          </pre>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Tool call item — now accepts a tool_use ContentBlock
// ============================================================================

type ToolUseBlock = Extract<ContentBlock, { type: 'tool_use' }>

/** Maximum number of sub-activity items to show at once. */
const MAX_SUB_ITEMS = 8

/**
 * Returns a short arg summary string (max 40 chars) for a sub-item tool call.
 * Handles common keys: command (Bash), file_path (Read/Edit/Write), path, query.
 * Falls back to the first string value found in args, or empty string if none.
 */
function formatSubItemArgs(name: string, args?: Record<string, any>): string {
  if (!args) return ''
  // Priority key list based on common tool patterns
  const priorityKeys = ['command', 'file_path', 'path', 'query', 'pattern', 'content']
  for (const key of priorityKeys) {
    if (typeof args[key] === 'string' && args[key].length > 0) {
      const val = args[key] as string
      // Take only the first line for multiline values (e.g. command content)
      const firstLine = val.split('\n')[0]
      return firstLine.slice(0, 40)
    }
  }
  // Fallback: first string value in args
  for (const val of Object.values(args)) {
    if (typeof val === 'string' && val.length > 0) {
      const firstLine = val.split('\n')[0]
      return firstLine.slice(0, 40)
    }
  }
  return ''
}

/**
 * Renders the live activity feed for a running subagent tool call.
 * Shows up to the last 8 sub-items, with a "... N earlier" line if truncated.
 */
function ToolCallActivity({ subItems }: { subItems: SubItem[] }) {
  const hiddenCount = subItems.length > MAX_SUB_ITEMS ? subItems.length - MAX_SUB_ITEMS : 0
  const visibleItems = subItems.slice(-MAX_SUB_ITEMS)

  return (
    <div className="px-2.5 py-1.5 bg-bg-primary/30 border-t border-border/30">
      {hiddenCount > 0 && (
        <div className="text-[10px] text-text-tertiary/50 font-mono leading-5 mb-0.5">
          ... {hiddenCount} earlier
        </div>
      )}
      {visibleItems.map((item, idx) => {
        if (item.type === 'toolCall') {
          const argSummary = formatSubItemArgs(item.name, item.args)
          return (
            <div
              key={idx}
              className="text-[11px] font-mono text-text-tertiary leading-5 truncate"
            >
              <span className="text-text-tertiary/60">→ </span>
              <span>{item.name}</span>
              {argSummary && (
                <span className="text-text-tertiary/50 ml-1">{argSummary}</span>
              )}
            </div>
          )
        }
        // text item: show first line truncated to 60 chars
        const preview = item.text.split('\n')[0].slice(0, 60)
        if (!preview) return null
        return (
          <div
            key={idx}
            className="text-[11px] font-mono text-text-tertiary/70 leading-5 truncate"
          >
            {preview}
          </div>
        )
      })}
    </div>
  )
}

function ToolCallItem({ tc }: { tc: ToolUseBlock }) {
  const [expanded, setExpanded] = useState(false)

  const statusIcon = tc.done
    ? tc.isError
      ? <X className="size-3.5 text-red-400 flex-shrink-0" />
      : <Check className="size-3.5 text-green-400 flex-shrink-0" />
    : <Loader2 className="size-3.5 text-accent animate-spin flex-shrink-0" />

  const hasDetails = tc.input !== undefined || tc.output !== undefined

  // Show live activity feed when running and sub-items are present
  const showActivity = !tc.done && tc.subItems && tc.subItems.length > 0

  // Show collapsed summary when done and there were sub-item tool calls
  const showSummary = tc.done && tc.subItemCount && tc.subItemCount > 0

  return (
    <div className="rounded-md overflow-hidden border border-border/50">
      <button
        className={cn(
          'flex items-center gap-2 w-full px-2.5 py-1.5 text-xs font-mono text-left transition-colors',
          'hover:bg-bg-hover',
          tc.done
            ? tc.isError
              ? 'bg-red-900/20'
              : 'bg-bg-tertiary'
            : 'bg-bg-tertiary',
        )}
        onClick={() => hasDetails && setExpanded((v) => !v)}
        aria-expanded={expanded}
        disabled={!hasDetails}
      >
        {hasDetails && (
          <span className="text-text-tertiary">
            {expanded
              ? <ChevronDown className="size-3" />
              : <ChevronRight className="size-3" />
            }
          </span>
        )}
        {statusIcon}
        <span className={cn(
          'truncate flex-1',
          tc.done ? 'text-text-secondary' : 'text-accent',
        )}>
          {tc.tool}
        </span>
        {!tc.done && (
          <span className="text-text-tertiary text-[10px] ml-auto">running</span>
        )}
      </button>

      {/* Live activity feed: shown when running and subItems present */}
      {showActivity && (
        <ToolCallActivity subItems={tc.subItems!} />
      )}

      {/* Collapsed summary: shown when done with recorded sub-item tool calls */}
      {showSummary && (
        <div className="text-[10px] text-text-tertiary/70 px-2.5 py-1 border-t border-border/30 font-mono">
          {tc.subItemCount} tool calls
        </div>
      )}

      {expanded && hasDetails && (
        <div className="border-t border-border/50 bg-bg-primary">
          {tc.input !== undefined && (
            <div className="p-2">
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1 px-1">Input</p>
              <pre className="text-[11px] text-text-secondary font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-40 bg-bg-tertiary rounded p-2">
                {JSON.stringify(tc.input, null, 2)}
              </pre>
            </div>
          )}
          {tc.output !== undefined && (
            <div className="p-2 border-t border-border/30">
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1 px-1">Output</p>
              <pre className={cn(
                'text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-40 rounded p-2',
                tc.isError ? 'text-red-300 bg-red-900/20' : 'text-text-secondary bg-bg-tertiary',
              )}>
                {typeof tc.output === 'string'
                  ? tc.output
                  : JSON.stringify(tc.output, null, 2)
                }
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Markdown renderer
// ============================================================================

// Lazily loaded modules
type ReactMarkdownType = typeof import('react-markdown').default
type RemarkGfmType = typeof import('remark-gfm').default

interface MarkdownContentProps {
  text: string
  isStreaming: boolean
  projectRoot: string
  onOpenFileReference?: (relativePath: string) => Promise<void> | void
}

function MarkdownContent({ text, isStreaming, projectRoot, onOpenFileReference }: MarkdownContentProps) {
  const [ReactMarkdown, setReactMarkdown] = useState<ReactMarkdownType | null>(null)
  const [remarkGfm, setRemarkGfm] = useState<RemarkGfmType | null>(null)
  const [modulesLoaded, setModulesLoaded] = useState(false)

  // Load markdown modules once
  useEffect(() => {
    let cancelled = false
    Promise.all([import('react-markdown'), import('remark-gfm')]).then(
      ([rmMod, gfmMod]) => {
        if (cancelled) return
        setReactMarkdown(() => rmMod.default)
        setRemarkGfm(() => gfmMod.default)
        setModulesLoaded(true)
      },
    )
    return () => { cancelled = true }
  }, [])

  // Debounce text updates during streaming (50ms) to reduce Shiki re-renders
  const [debouncedText, setDebouncedText] = useState(text)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (isStreaming) {
      // Debounce during streaming
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => setDebouncedText(text), 50)
    } else {
      // Apply immediately when done
      if (debounceRef.current) clearTimeout(debounceRef.current)
      setDebouncedText(text)
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [text, isStreaming])

  // Memoize plugins array to avoid re-creation on every render
  const remarkPlugins = useMemo(
    () => (remarkGfm ? [remarkGfm] : []),
    [remarkGfm],
  )

  if (!modulesLoaded || !ReactMarkdown) {
    // Plain fallback while modules load
    return (
      <p className="whitespace-pre-wrap break-words text-sm leading-7">
        {text}
        {isStreaming && <StreamingCursor />}
      </p>
    )
  }

  return (
    <div className="markdown-body text-sm leading-7">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        components={{
          // ---- Code blocks (fenced) — handled via pre ----
          pre({ children }) {
            const child = React.Children.toArray(children).find(
              (c) => React.isValidElement(c) && (c as React.ReactElement).type === 'code',
            ) as React.ReactElement | undefined
            if (child) {
              const { className, children: codeChildren } = child.props as { className?: string; children?: React.ReactNode }
              const match = /language-(\w+)/.exec(className || '')
              const language = match ? match[1] : ''
              const codeText = String(codeChildren).replace(/\n$/, '')
              return <CodeBlock code={codeText} language={language} isStreaming={isStreaming} />
            }
            return <pre>{children}</pre>
          },

          // ---- Inline code ----
          code({ children, ...props }) {
            return (
              <code
                className="bg-bg-tertiary text-accent rounded px-1.5 py-0.5 text-[0.85em] font-mono"
                {...props}
              >
                {children}
              </code>
            )
          },

          // ---- Links ----
          a({ href, children, ...props }) {
            if (!href) return <span {...props}>{children}</span>

            // Block dangerous URLs
            if (href.startsWith('javascript:') || href.startsWith('data:')) {
              return <span className="text-text-tertiary">{children}</span>
            }

            const relativeFilePath = resolveFileReferenceHref(href, projectRoot)

            const handleClick = (e: React.MouseEvent) => {
              e.preventDefault()
              if (relativeFilePath && onOpenFileReference) {
                Promise.resolve(onOpenFileReference(relativeFilePath)).catch((err) => {
                  console.error('[open-file-reference]', err)
                  toast.error(err instanceof Error ? err.message : 'Failed to open file')
                })
                return
              }
              if (href.startsWith('http://') || href.startsWith('https://')) {
                // Use bridge IPC if available, else window.open
                if (typeof window !== 'undefined' && (window as any).bridge?.openExternal) {
                  ;(window as any).bridge.openExternal(href).catch(console.error)
                } else {
                  window.open(href, '_blank', 'noopener,noreferrer')
                }
              }
            }

            return (
              <a
                href={href}
                onClick={handleClick}
                className="text-accent underline underline-offset-2 hover:text-accent-hover cursor-pointer"
                rel="noopener noreferrer"
                title={relativeFilePath ? `Open ${relativeFilePath} in file viewer` : href}
                {...props}
              >
                {children}
              </a>
            )
          },

          // ---- Images ----
          img({ src, alt, ...props }) {
            if (!src) return null
            // Only allow https:// and data: image URLs
            if (!src.startsWith('https://') && !src.startsWith('data:image/')) {
              return <span className="text-text-tertiary">[image]</span>
            }
            return (
              <img
                src={src}
                alt={alt || ''}
                className="max-w-full rounded-md my-2"
                {...props}
              />
            )
          },

          // ---- Tables ----
          table({ children, ...props }) {
            return (
              <div className="overflow-x-auto my-3">
                <table
                  className="w-full text-sm border-collapse border border-border"
                  {...props}
                >
                  {children}
                </table>
              </div>
            )
          },
          thead({ children, ...props }) {
            return (
              <thead className="bg-bg-tertiary" {...props}>
                {children}
              </thead>
            )
          },
          tr({ children, ...props }) {
            return (
              <tr
                className="border-b border-border odd:bg-bg-primary even:bg-bg-secondary/50"
                {...props}
              >
                {children}
              </tr>
            )
          },
          th({ children, ...props }) {
            return (
              <th
                className="px-3 py-2 text-left font-semibold text-text-primary border-r border-border last:border-r-0"
                {...props}
              >
                {children}
              </th>
            )
          },
          td({ children, ...props }) {
            return (
              <td
                className="px-3 py-2 text-text-secondary border-r border-border last:border-r-0"
                {...props}
              >
                {children}
              </td>
            )
          },

          // ---- Typography ----
          h1({ children, ...props }) {
            return <h1 className="text-xl font-bold text-text-primary mt-4 mb-2" {...props}>{children}</h1>
          },
          h2({ children, ...props }) {
            return <h2 className="text-lg font-semibold text-text-primary mt-4 mb-2" {...props}>{children}</h2>
          },
          h3({ children, ...props }) {
            return <h3 className="text-base font-semibold text-text-primary mt-3 mb-1" {...props}>{children}</h3>
          },
          p({ children, ...props }) {
            return <p className="mb-3 last:mb-0 leading-7" {...props}>{children}</p>
          },
          ul({ children, ...props }) {
            return <ul className="list-disc pl-5 mb-3 space-y-1" {...props}>{children}</ul>
          },
          ol({ children, ...props }) {
            return <ol className="list-decimal pl-5 mb-3 space-y-1" {...props}>{children}</ol>
          },
          li({ children, ...props }) {
            return <li className="leading-7" {...props}>{children}</li>
          },
          blockquote({ children, ...props }) {
            return (
              <blockquote
                className="border-l-2 border-accent pl-4 my-3 text-text-secondary italic"
                {...props}
              >
                {children}
              </blockquote>
            )
          },
          hr() {
            return <hr className="border-border my-4" />
          },
          strong({ children, ...props }) {
            return <strong className="font-semibold text-text-primary" {...props}>{children}</strong>
          },
          em({ children, ...props }) {
            return <em className="italic" {...props}>{children}</em>
          },
        }}
      >
        {debouncedText}
      </ReactMarkdown>
      {isStreaming && <StreamingCursor />}
    </div>
  )
}

// ============================================================================
// Main ChatMessage component
// ============================================================================

export function ChatMessage({ message, projectRoot, onOpenFileReference }: Props) {
  const isUser = message.role === 'user'
  const isError = message.role === 'error'
  const isStreaming = message.isStreaming
  const [hovered, setHovered] = useState(false)

  // Get the text content for copy (only text blocks, not thinking or tool output)
  const copyText = getMessageText(message)

  // For user and error messages, get plain text from the first text block
  const firstTextBlock = message.contentBlocks.find((b) => b.type === 'text') as Extract<ContentBlock, { type: 'text' }> | undefined
  const plainText = firstTextBlock?.text ?? ''

  return (
    <div
      className={cn('flex w-full mb-4', isUser ? 'justify-end' : 'justify-start')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={cn(
          'relative max-w-[80%] rounded-2xl px-4 py-3',
          isUser
            ? 'bg-accent/15 border border-accent/30 text-text-primary rounded-br-sm'
            : isError
              ? 'bg-red-900/20 border border-red-700/40 text-red-300 rounded-bl-sm'
              : 'bg-bg-secondary border border-border text-text-primary rounded-bl-sm',
        )}
      >
        {/* Copy message button — top-right, on hover (only when there's text to copy) */}
        {!isError && copyText && (
          <div
            className={cn(
              'absolute top-2 right-2 transition-opacity',
              hovered ? 'opacity-100' : 'opacity-0',
            )}
          >
            <CopyButton text={copyText} />
          </div>
        )}

        {/* Error icon + text */}
        {isError && (
          <div className="flex items-start gap-2">
            <AlertCircle className="size-4 mt-0.5 flex-shrink-0 text-red-400" />
            <p className="whitespace-pre-wrap break-words text-sm leading-7">
              {plainText}
            </p>
          </div>
        )}

        {/* User messages: plain text */}
        {isUser && (
          <p className="whitespace-pre-wrap break-words text-sm leading-7 pr-6">
            {plainText}
            {isStreaming && <StreamingCursor />}
          </p>
        )}

        {/* Assistant messages: ordered content blocks */}
        {!isUser && !isError && (
          <div className={cn(copyText ? 'pr-6' : '')}>
            {message.contentBlocks.map((block) => {
              switch (block.type) {
                case 'thinking':
                  return <ThinkingBlock key={block.id} block={block} />
                case 'text':
                  return block.text ? (
                    <MarkdownContent
                      key={block.id}
                      text={block.text}
                      isStreaming={block.isStreaming}
                      projectRoot={projectRoot}
                      onOpenFileReference={onOpenFileReference}
                    />
                  ) : null
                case 'tool_use':
                  return (
                    <div key={block.id} className="mt-2 mb-1">
                      <ToolCallItem tc={block} />
                    </div>
                  )
                default:
                  return null
              }
            })}
          </div>
        )}
      </div>
    </div>
  )
}
