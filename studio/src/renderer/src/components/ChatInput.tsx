/**
 * ChatInput — text input bar with submit, stop, and voice buttons.
 * Enter submits, Shift+Enter inserts a newline.
 * Supports pasting images from clipboard with a preview thumbnail.
 * When voice is active, shows mic status and a partial transcript preview.
 */

import { useState, useRef, useEffect, useCallback, type KeyboardEvent, type ClipboardEvent } from 'react'
import { Mic, MicOff, Volume2 } from 'lucide-react'

interface Props {
  onSubmit: (text: string, imageDataUrl?: string) => void
  onAbort: () => void
  isGenerating: boolean
  disabled?: boolean
  // Voice props
  voiceAvailable?: boolean
  voiceActive?: boolean
  isSpeaking?: boolean
  isTtsPlaying?: boolean
  partialTranscript?: string
  unavailableReason?: string | null
  onVoiceToggle?: () => void
  onStopTts?: () => void
}

export function ChatInput({
  onSubmit,
  onAbort,
  isGenerating,
  disabled,
  voiceAvailable = false,
  voiceActive = false,
  isSpeaking = false,
  isTtsPlaying = false,
  partialTranscript = '',
  unavailableReason = null,
  onVoiceToggle,
  onStopTts,
}: Props) {
  const [value, setValue] = useState('')
  const [pastedImage, setPastedImage] = useState<string | null>(null)
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

  /** Handle paste events — capture image files from clipboard. */
  const handlePaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData?.files
    if (!files || files.length === 0) return

    const imageFile = Array.from(files).find((f) => f.type.startsWith('image/'))
    if (!imageFile) return

    // Prevent default so the file name isn't pasted as text
    e.preventDefault()

    const reader = new FileReader()
    reader.onload = (evt) => {
      const dataUrl = evt.target?.result
      if (typeof dataUrl === 'string') {
        setPastedImage(dataUrl)
      }
    }
    reader.readAsDataURL(imageFile)
  }, [])

  const handleSubmit = () => {
    const text = value.trim()
    if ((!text && !pastedImage) || isGenerating || disabled) return
    const imageToSend = pastedImage ?? undefined
    setValue('')
    setPastedImage(null)
    onSubmit(text, imageToSend)
  }

  const canSubmit = (value.trim() || pastedImage) && !disabled

  // Mic button appearance depends on voice state
  const micButtonClass = (() => {
    if (!voiceAvailable) {
      return 'flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-xl bg-bg-tertiary border border-border text-text-tertiary opacity-40 cursor-not-allowed'
    }
    if (isTtsPlaying) {
      return 'flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-xl bg-accent/20 border border-accent/60 text-accent hover:bg-accent/30 transition-colors'
    }
    if (voiceActive && isSpeaking) {
      return 'flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-xl bg-green-500/20 border border-green-500/60 text-green-400 hover:bg-green-500/30 transition-colors animate-pulse'
    }
    if (voiceActive) {
      return 'flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-xl bg-accent/20 border border-accent/60 text-accent hover:bg-accent/30 transition-colors'
    }
    return 'flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-xl bg-bg-tertiary border border-border text-text-tertiary hover:text-text-primary hover:border-border-active transition-colors'
  })()

  return (
    <div className="border-t border-border bg-bg-primary px-4 py-3">
      {/* Partial transcript preview — shown when voice is active and capturing */}
      {voiceActive && partialTranscript && (
        <div className="mb-2 px-1 text-xs text-text-tertiary italic truncate">
          {partialTranscript}
        </div>
      )}

      {/* Image preview thumbnail */}
      {pastedImage && (
        <div className="mb-2 flex items-start gap-2">
          <div className="relative inline-block">
            <img
              src={pastedImage}
              alt="Pasted image preview"
              className="h-16 w-auto max-w-[120px] rounded-lg border border-border object-cover"
            />
            <button
              onClick={() => setPastedImage(null)}
              title="Remove image"
              className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-bg-tertiary border border-border text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M1 1L7 7M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2 rounded-2xl border border-border bg-bg-secondary px-3 py-2 focus-within:border-border-active transition-colors">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={disabled ? 'Waiting for agent...' : 'Ask anything... (Enter to send, Shift+Enter for newline)'}
          disabled={disabled || isGenerating}
          rows={1}
          className={[
            'flex-1 resize-none bg-transparent text-sm text-text-primary placeholder-text-tertiary',
            'outline-none leading-7 min-h-[28px] max-h-[160px]',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          ].join(' ')}
        />

        {/* Mic / TTS button */}
        <button
          onClick={isTtsPlaying ? onStopTts : onVoiceToggle}
          disabled={!voiceAvailable}
          title={
            !voiceAvailable
              ? (unavailableReason ?? 'Voice unavailable')
              : isTtsPlaying
                ? 'Stop speaking'
                : voiceActive
                  ? 'Stop voice mode'
                  : 'Start voice mode'
          }
          className={micButtonClass}
        >
          {isTtsPlaying ? (
            <Volume2 className="w-4 h-4" />
          ) : voiceActive ? (
            <Mic className="w-4 h-4" />
          ) : (
            <MicOff className="w-4 h-4" />
          )}
        </button>

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
            disabled={!canSubmit}
            title="Send message"
            className={[
              'flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-xl transition-colors',
              canSubmit
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
