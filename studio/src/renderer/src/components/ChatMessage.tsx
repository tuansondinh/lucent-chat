/**
 * ChatMessage — renders a single message bubble with rich markdown support.
 *
 * Features:
 * - react-markdown + remark-gfm for full markdown rendering
 * - Shiki syntax highlighting for code blocks
 * - Copy button per message and per code block
 * - Streaming cursor animation
 * - Tool call display with collapsible details
 * - Error message styling
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { ChatMessage as ChatMsg } from '../store/chat'
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
} from 'lucide-react'

// ============================================================================
// Types
// ============================================================================

interface Props {
  message: ChatMsg
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
// Tool call item
// ============================================================================

function ToolCallItem({ tc }: { tc: ChatMsg['toolCalls'][number] }) {
  const [expanded, setExpanded] = useState(false)

  const statusIcon = tc.done
    ? tc.isError
      ? <X className="size-3.5 text-red-400 flex-shrink-0" />
      : <Check className="size-3.5 text-green-400 flex-shrink-0" />
    : <Loader2 className="size-3.5 text-accent animate-spin flex-shrink-0" />

  const hasDetails = tc.input !== undefined || tc.output !== undefined

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
}

function MarkdownContent({ text, isStreaming }: MarkdownContentProps) {
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
          // ---- Code blocks ----
          code({ node: _node, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const language = match ? match[1] : ''
            const isBlock = !!(props as any).inline === false || className?.startsWith('language-')

            if (isBlock || language) {
              const codeText = String(children).replace(/\n$/, '')
              return (
                <CodeBlock
                  code={codeText}
                  language={language}
                  isStreaming={isStreaming}
                />
              )
            }
            // Inline code
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

            const handleClick = (e: React.MouseEvent) => {
              e.preventDefault()
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

export function ChatMessage({ message }: Props) {
  const isUser = message.role === 'user'
  const isError = message.role === 'error'
  const isStreaming = message.isStreaming
  const [hovered, setHovered] = useState(false)

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
        {/* Copy message button — top-right, on hover */}
        {!isError && message.text && (
          <div
            className={cn(
              'absolute top-2 right-2 transition-opacity',
              hovered ? 'opacity-100' : 'opacity-0',
            )}
          >
            <CopyButton text={message.text} />
          </div>
        )}

        {/* Error icon + text */}
        {isError && (
          <div className="flex items-start gap-2">
            <AlertCircle className="size-4 mt-0.5 flex-shrink-0 text-red-400" />
            <p className="whitespace-pre-wrap break-words text-sm leading-7">
              {message.text}
            </p>
          </div>
        )}

        {/* User messages: plain text */}
        {isUser && (
          <p className="whitespace-pre-wrap break-words text-sm leading-7 pr-6">
            {message.text}
            {isStreaming && <StreamingCursor />}
          </p>
        )}

        {/* Assistant messages: rich markdown */}
        {!isUser && !isError && (
          <div className="pr-6">
            <MarkdownContent text={message.text} isStreaming={isStreaming} />
          </div>
        )}

        {/* Tool calls */}
        {message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.toolCalls.map((tc, i) => (
              <ToolCallItem key={i} tc={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
