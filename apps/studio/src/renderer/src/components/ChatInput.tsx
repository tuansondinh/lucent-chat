/**
 * ChatInput — text input bar with submit, stop, and voice buttons.
 * Enter submits, Shift+Enter inserts a newline.
 * Supports pasting images from clipboard with a preview thumbnail.
 * When voice is active, shows mic status and a partial transcript preview.
 */

import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle, type KeyboardEvent, type ClipboardEvent } from 'react'
import { Mic, MicOff, Volume2, Zap } from 'lucide-react'
import { btn } from '../lib/theme'
import { cn } from '../lib/utils'

export interface SkillSuggestion {
  trigger: string
  name: string
  description: string
}

interface Props {
  onSubmit: (text: string, imageDataUrl?: string) => void
  onAbort: () => void
  isGenerating: boolean
  canQueueMessage?: boolean
  hasQueuedMessage?: boolean
  queuedMessageLabel?: string | null
  disabled?: boolean
  /** Available skills for autocomplete on `/` keystroke. */
  skills?: SkillSuggestion[]
  // Voice props
  voiceAvailable?: boolean
  voiceActive?: boolean
  voiceSidecarState?: 'unavailable' | 'stopped' | 'starting' | 'ready' | 'error'
  isSpeaking?: boolean
  isTtsPlaying?: boolean
  partialTranscript?: string
  unavailableReason?: string | null
  onVoiceToggle?: () => void
  onStopTts?: () => void
  onEditQueuedMessage?: () => void
  onClearQueuedMessage?: () => void
  onInterruptAndSend?: () => void
  /** When true, textarea uses 16px font-size to prevent iOS zoom on focus. */
  isMobile?: boolean
}

export interface ChatInputHandle {
  focus: () => void
  setDraft: (text: string, imageDataUrl?: string | null) => void
  setImage: (dataUrl: string) => void
}

const DRAFT_KEY = 'lc_input_draft'

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSubmit,
  onAbort,
  isGenerating,
  canQueueMessage = false,
  hasQueuedMessage = false,
  queuedMessageLabel = null,
  disabled,
  skills = [],
  voiceAvailable = false,
  voiceActive = false,
  voiceSidecarState = 'stopped',
  isSpeaking = false,
  isTtsPlaying = false,
  partialTranscript = '',
  unavailableReason = null,
  onVoiceToggle,
  onStopTts,
  onEditQueuedMessage,
  onClearQueuedMessage,
  onInterruptAndSend,
  isMobile = false,
}: Props, ref) {
  // On mobile, restore persisted draft from localStorage (Task 10: State persistence)
  const [value, setValue] = useState<string>(() => {
    if (isMobile) {
      try { return localStorage.getItem(DRAFT_KEY) ?? '' } catch { return '' }
    }
    return ''
  })
  const [pastedImage, setPastedImage] = useState<string | null>(null)
  const [skillDropdownOpen, setSkillDropdownOpen] = useState(false)
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    setImage: (dataUrl: string) => {
      setPastedImage(dataUrl)
      textareaRef.current?.focus()
    },
    setDraft: (text: string, imageDataUrl?: string | null) => {
      setValue(text)
      setPastedImage(imageDataUrl ?? null)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        const end = text.length
        el.setSelectionRange(end, end)
      })
    },
  }))

  // Persist input draft to localStorage on mobile (debounced 300ms)
  useEffect(() => {
    if (!isMobile) return
    const timer = setTimeout(() => {
      try {
        if (value) {
          localStorage.setItem(DRAFT_KEY, value)
        } else {
          localStorage.removeItem(DRAFT_KEY)
        }
      } catch { /* localStorage may be unavailable in private browsing */ }
    }, 300)
    return () => clearTimeout(timer)
  }, [value, isMobile])

  // Auto-resize textarea up to ~5 lines to keep the composer compact.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 128) + 'px'
  }, [value])

  // Skill autocomplete: filter by text after `/`
  // Only show dropdown while typing the trigger — not after a space (skill already selected)
  const filteredSkills = (() => {
    if (!value.startsWith('/') || !skills.length) return []
    const afterSlash = value.slice(1)
    if (afterSlash.includes(' ')) return [] // skill selected, stop suggesting
    const typed = afterSlash.toLowerCase()
    if (!typed) return skills
    return skills.filter((s) => s.trigger.toLowerCase().startsWith(typed))
  })()

  // Open dropdown when value starts with `/`
  useEffect(() => {
    if (value.startsWith('/') && filteredSkills.length > 0) {
      setSkillDropdownOpen(true)
      setSelectedSkillIndex(0)
    } else {
      setSkillDropdownOpen(false)
    }
  }, [value, filteredSkills.length])

  const selectSkill = useCallback((skill: SkillSuggestion) => {
    setValue(`/${skill.trigger} `)
    setSkillDropdownOpen(false)
    textareaRef.current?.focus()
  }, [])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Skill dropdown navigation
    if (skillDropdownOpen && filteredSkills.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedSkillIndex((i) => (i + 1) % filteredSkills.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedSkillIndex((i) => (i - 1 + filteredSkills.length) % filteredSkills.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        const skill = filteredSkills[selectedSkillIndex]
        if (skill) selectSkill(skill)
        return
      }
      if (e.key === 'Escape') {
        setSkillDropdownOpen(false)
        return
      }
    }

    if (e.key === 'Escape') {
      if (hasQueuedMessage && onInterruptAndSend) {
        e.preventDefault()
        onInterruptAndSend()
        return
      }
    }

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

  /** Handle drag-and-drop for images */
  const [isDragging, setIsDragging] = useState(false)
  
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return

    const imageFile = Array.from(files).find((f) => f.type.startsWith('image/'))
    if (!imageFile) return

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
    if ((!text && !pastedImage) || disabled) return
    if (isGenerating && !canQueueMessage) return
    const imageToSend = pastedImage ?? undefined
    setValue('')
    setPastedImage(null)
    // Clear persisted draft on submit (Task 10: State persistence)
    if (isMobile) {
      try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
    }
    onSubmit(text, imageToSend)
  }

  const queueLocked = hasQueuedMessage
  const canSubmit = Boolean(value.trim() || pastedImage) && !disabled && (!isGenerating || canQueueMessage)
  const isVoiceStarting = voiceSidecarState === 'starting'

  // Mic button appearance depends on voice state.
  // On mobile: 48px prominent circle (tap-to-toggle). On desktop: 32px compact button.
  const micButtonClass = (() => {
    const sizeClass = isMobile
      ? 'mobile-voice-btn'
      : 'flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-xl'
    if (!voiceAvailable) {
      return `${sizeClass} bg-bg-tertiary border border-border text-text-tertiary opacity-40 cursor-not-allowed`
    }
    if (isVoiceStarting) {
      return `${sizeClass} bg-accent/10 border border-accent/40 text-accent cursor-wait`
    }
    if (isTtsPlaying) {
      return `${sizeClass} bg-accent/20 border border-accent/60 text-accent hover:bg-accent/30 transition-colors`
    }
    if (voiceActive && isSpeaking) {
      return `${sizeClass} bg-green-500/20 border border-green-500/60 text-green-400 hover:bg-green-500/30 transition-colors animate-pulse`
    }
    if (voiceActive) {
      return isMobile
        ? `${sizeClass} bg-accent text-bg-primary border border-accent transition-colors`
        : `${sizeClass} bg-orange-500/20 border border-orange-500/60 text-orange-400 hover:bg-orange-500/30 transition-colors`
    }
    return isMobile
      ? `${sizeClass} bg-bg-tertiary border border-border text-text-secondary hover:bg-bg-hover transition-colors`
      : `${sizeClass} bg-bg-tertiary border border-border text-text-tertiary hover:text-text-primary hover:border-border-active transition-colors`
  })()

  return (
    <div className="relative border-t border-border bg-bg-secondary px-2 py-1.5">
      {/* Partial transcript preview — shown when voice is active and capturing */}
      {voiceActive && partialTranscript && (
        <div className="mb-2 px-1 text-xs text-text-tertiary italic truncate">
          {partialTranscript}
        </div>
      )}

      {/* Voice startup hint — shown while the sidecar is booting */}
      {isVoiceStarting && !voiceActive && (
        <div className="mb-2 px-1 text-xs text-text-tertiary">
          Starting voice service...
        </div>
      )}

      {queuedMessageLabel && (
        <div className="mb-2 flex items-center gap-2 px-1 text-xs">
          <div className="min-w-0 flex-1 truncate text-accent">
            Queued next: {queuedMessageLabel}
            <span className="opacity-50 ml-1.5 font-normal italic">(hit Esc to send queued message)</span>
          </div>
          <button
            type="button"
            onClick={onEditQueuedMessage}
            title="Edit queued message"
            className={cn(btn.outline, 'px-1.5 py-0.5 text-xs')}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onClearQueuedMessage}
            title="Cancel queued message"
            className={cn(btn.outline, 'px-1.5 py-0.5 text-xs')}
          >
            Clear
          </button>
        </div>
      )}

      {/* Skill autocomplete dropdown — positioned above the input */}
      {skillDropdownOpen && filteredSkills.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 mx-2 rounded-lg border border-border bg-bg-secondary shadow-lg overflow-y-auto max-h-[240px] z-50">
          {filteredSkills.map((skill, i) => (
            <button
              key={skill.trigger}
              type="button"
              onClick={() => selectSkill(skill)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                i === selectedSkillIndex
                  ? 'bg-accent/15 text-text-primary'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
              )}
            >
              <Zap className="h-3 w-3 flex-shrink-0 text-accent" />
              <span className="font-medium text-text-primary whitespace-nowrap">/{skill.trigger}</span>
              <span className="text-xs text-text-tertiary truncate">{skill.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* Image preview thumbnail */}
      {pastedImage && (
        <div className="mb-1.5 flex items-start gap-2">
          <div className="relative inline-block">
            <img
              src={pastedImage}
              alt="Pasted image preview"
              className="h-14 w-auto max-w-[108px] rounded-lg border border-border object-cover"
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

      <div 
        className={cn(
          "flex items-center gap-2 rounded-lg border px-2 py-0.5 focus-within:border-accent/50 transition-colors",
          isDragging 
            ? "border-accent bg-accent/10" 
            : "border-border bg-bg-secondary"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            disabled
              ? 'Waiting for agent...'
              : hasQueuedMessage
                ? 'One queued message already waiting...'
              : isGenerating
                  ? 'Type a follow-up and press Enter to queue it...'
                  : 'Ask anything... (Enter to send, Shift+Enter for newline)'
          }
          disabled={disabled}
          readOnly={queueLocked}
          rows={1}
          className={[
            'flex-1 resize-none bg-transparent text-xs text-text-primary placeholder-text-tertiary',
            'outline-none leading-4 min-h-[18px] max-h-[100px]',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            queueLocked ? 'opacity-60 cursor-default select-none' : '',
            isMobile ? 'mobile-chat-input' : '',
          ].join(' ')}
        />
        {/* Mic / TTS button — tap-to-toggle on mobile, hold-space PTT gated on desktop */}
        <button
          onClick={isTtsPlaying ? onStopTts : onVoiceToggle}
          disabled={!voiceAvailable || isVoiceStarting}
          aria-label={
            !voiceAvailable
              ? (unavailableReason ?? 'Voice unavailable')
              : isVoiceStarting
                ? 'Starting voice service...'
              : isTtsPlaying
                ? 'Stop speaking'
                : voiceActive
                  ? 'Stop voice mode'
                  : 'Start voice mode'
          }
          title={
            !voiceAvailable
              ? (unavailableReason ?? 'Voice unavailable')
              : isVoiceStarting
                ? 'Starting voice service...'
              : isTtsPlaying
                ? 'Stop speaking'
                : voiceActive
                  ? isMobile ? 'Tap to stop mic' : 'Stop voice mode'
                  : isMobile ? 'Tap to start mic' : 'Start voice mode'
          }
          className={micButtonClass}
        >
          {isVoiceStarting ? (
            <svg className={isMobile ? 'h-5 w-5 animate-spin' : 'h-4 w-4 animate-spin'} viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
              <path d="M8 2.5A5.5 5.5 0 0 1 13.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : isTtsPlaying ? (
            <Volume2 className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} />
          ) : voiceActive ? (
            <Mic className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} />
          ) : (
            <MicOff className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} />
          )}
        </button>

        {isGenerating && (
          <button
            onClick={onAbort}
            title="Stop generation"
            className={cn(btn.danger, 'flex-shrink-0 flex items-center justify-center h-7 w-7')}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="2" y="2" width="8" height="8" rx="1" />
            </svg>
          </button>
        )}

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          title={isGenerating ? (hasQueuedMessage ? 'One queued follow-up already pending' : 'Queue follow-up message') : 'Send message'}
          className={cn(
            'flex-shrink-0 flex items-center justify-center h-7 w-7',
            canSubmit
              ? btn.primary
              : 'rounded-lg bg-bg-tertiary border border-border text-text-tertiary cursor-not-allowed opacity-50',
          )}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M6 1L11 6L6 11M1 6H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </button>
      </div>
    </div>
  )
})
