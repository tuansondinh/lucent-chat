/**
 * ChatInput — text input bar with submit and stop buttons.
 * Enter submits, Shift+Enter inserts a newline.
 */

import { useState, useRef, useEffect, type KeyboardEvent } from 'react'

interface Props {
  onSubmit: (text: string) => void
  onAbort: () => void
  isGenerating: boolean
  disabled?: boolean
}

export function ChatInput({ onSubmit, onAbort, isGenerating, disabled }: Props) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea up to ~6 lines
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [value])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleSubmit = () => {
    const text = value.trim()
    if (!text || isGenerating || disabled) return
    setValue('')
    onSubmit(text)
  }

  return (
    <div className="border-t border-border bg-bg-primary px-4 py-3">
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-bg-secondary px-3 py-2 focus-within:border-border-active transition-colors">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Waiting for agent...' : 'Ask anything... (Enter to send, Shift+Enter for newline)'}
          disabled={disabled || isGenerating}
          rows={1}
          className={[
            'flex-1 resize-none bg-transparent text-sm text-text-primary placeholder-text-tertiary',
            'outline-none leading-7 min-h-[28px] max-h-[160px]',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          ].join(' ')}
        />

        {isGenerating ? (
          <button
            onClick={onAbort}
            title="Stop generation"
            className="flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-xl bg-red-600/20 border border-red-600/40 text-red-400 hover:bg-red-600/30 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="2" y="2" width="8" height="8" rx="1" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || disabled}
            title="Send message"
            className={[
              'flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-xl transition-colors',
              value.trim() && !disabled
                ? 'bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30'
                : 'bg-bg-tertiary border border-border text-text-tertiary cursor-not-allowed opacity-50',
            ].join(' ')}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M6 1L11 6L6 11M1 6H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </button>
        )}
      </div>
      <p className="mt-1.5 text-center text-[10px] text-text-tertiary">
        Enter to send · Shift+Enter for newline
      </p>
    </div>
  )
}
