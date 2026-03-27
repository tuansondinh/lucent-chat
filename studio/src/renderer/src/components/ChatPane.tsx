/**
 * ChatPane — a single self-contained chat pane with its own agent process.
 *
 * Owns: per-pane store subscription, bridge event listeners (filtered to this pane),
 * submit/abort handlers, session state, and the full chat column UI.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { Cpu, ChevronDown, GitBranch, Folder } from 'lucide-react'
import { toast } from 'sonner'
import { ChatMessage } from './ChatMessage'
import { ChatInput, type ChatInputHandle } from './ChatInput'
import { ModelPicker } from './ModelPicker'
import { getPaneStore } from '../store/pane-store'
import { formatModelDisplay, getModelRefFromState } from '../lib/models'
import { useVoice } from '../lib/useVoice'
import { useVoiceStore } from '../store/voice-store'
import { registerPaneElement, registerPaneFocus } from '../lib/pane-refs'

// ============================================================================
// Git branch poller registry — shared across pane instances, keyed by root
// ============================================================================

const gitPollers = new Map<string, { refCount: number; intervalId: ReturnType<typeof setInterval> }>()

// ============================================================================
// ThinkingBubble (local copy to avoid circular dep with App.tsx)
// ============================================================================

function ThinkingBubble() {
  return (
    <div className="flex w-full mb-4 justify-start">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm px-4 py-3 bg-bg-secondary border border-border">
        <span className="w-2 h-2 rounded-full bg-accent opacity-60 animate-bounce [animation-delay:0ms]" />
        <span className="w-2 h-2 rounded-full bg-accent opacity-60 animate-bounce [animation-delay:150ms]" />
        <span className="w-2 h-2 rounded-full bg-accent opacity-60 animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  )
}

// ============================================================================
// PaneFooter — shows git branch + project root, supports changing root
// ============================================================================

function PaneFooter({ paneId }: { paneId: string }) {
  const gitBranch = getPaneStore(paneId)((s) => s.gitBranch)
  const projectRoot = getPaneStore(paneId)((s) => s.projectRoot)
  const bridge = window.bridge

  const shortRoot = projectRoot
    ? projectRoot.replace(/^\/Users\/[^/]+/, '~')
    : '—'

  const handleChangeRoot = useCallback(async () => {
    try {
      const folder = await bridge.pickFolder()
      if (folder) {
        await bridge.setPaneRoot(paneId, folder)
        const info = await bridge.getPaneInfo(paneId)
        getPaneStore(paneId).getState().setProjectRoot(info.projectRoot)
        const branch = await bridge.gitBranch(paneId)
        getPaneStore(paneId).getState().setGitBranch(branch)
      }
    } catch {
      // ignore picker errors
    }
  }, [paneId, bridge])

  return (
    <div className="flex items-center gap-3 px-3 py-1 border-t border-border bg-bg-secondary text-[10px] text-text-tertiary flex-shrink-0 select-none">
      <span className="flex items-center gap-1 min-w-0">
        <GitBranch className="size-3 flex-shrink-0" />
        <span className="truncate">{gitBranch ?? '—'}</span>
      </span>
      <button
        onClick={() => void handleChangeRoot()}
        className="flex items-center gap-1 min-w-0 hover:text-text-primary transition-colors cursor-pointer"
        title="Change project root"
      >
        <Folder className="size-3 flex-shrink-0" />
        <span className="truncate max-w-[200px]">{shortRoot}</span>
      </button>
    </div>
  )
}

// ============================================================================
// Props
// ============================================================================

interface ChatPaneProps {
  paneId: string
  isActive: boolean
  /** Show collapse sidebar padding (true = sidebar icon strip is visible). */
  sidebarCollapsed: boolean
  /** Called when user clicks on this pane to focus it. */
  onFocus: () => void
  /** Called to close this pane — undefined if this is the only pane. */
  onClose?: () => void
}

const suggestions = [
  'What can you help me with?',
  'Show me the project structure',
  'Read the README',
  'What files are here?',
]

// ============================================================================
// ChatPane
// ============================================================================

export function ChatPane({ paneId, isActive, sidebarCollapsed, onFocus, onClose }: ChatPaneProps) {
  const store = getPaneStore(paneId)
  const {
    messages,
    agentHealth,
    isGenerating,
    appendChunk,
    finalizeMessage,
    addUserMessage,
    addToolCall,
    finalizeToolCall,
    addThinking,
    appendThinkingChunk,
    finalizeThinking,
    startTextBlock,
    finalizeTextBlock,
    setHealth,
    addErrorMessage,
    setModel,
    loadHistory,
    setSessionPath,
    setSessionName,
    currentModel,
  } = store()

  const bridge = window.bridge
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLElement>(null)
  const inputRef = useRef<ChatInputHandle>(null)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)

  // Voice integration — app-global store, but forwarding is scoped to this pane
  const voiceStore = useVoiceStore()
  const { toggleVoice, stopTts, feedAgentChunk, flushTts } = useVoice({
    onTranscript: (text) => void handleSubmit(text),
    activePaneId: paneId,
  })

  // Stable callback ref for root div — registers the element for spatial navigation
  const rootRef = useCallback((el: HTMLDivElement | null) => {
    registerPaneElement(paneId, el)
  }, [paneId])

  // Register focus callback and clean up on unmount
  useEffect(() => {
    registerPaneFocus(paneId, () => inputRef.current?.focus())
    return () => {
      registerPaneElement(paneId, null)
      registerPaneFocus(paneId, null)
    }
  }, [paneId])

  // Auto-scroll when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Register bridge event listeners filtered to THIS pane
  useEffect(() => {
    const unsubs = [
      bridge.onAgentChunk(({ paneId: pid, turn_id, text }) => {
        if (pid !== paneId) return
        store.getState().appendChunk(turn_id, text)
        // Forward chunk to TTS sentence accumulator when voice is active on this pane
        if (isActive && useVoiceStore.getState().active) feedAgentChunk(text, turn_id)
      }),
      bridge.onAgentDone(({ paneId: pid, turn_id, full_text }) => {
        if (pid !== paneId) return
        store.getState().finalizeMessage(turn_id, full_text)
        // Flush remaining TTS buffer at end of turn
        if (isActive && useVoiceStore.getState().active) flushTts(turn_id)
      }),
      bridge.onToolStart(({ paneId: pid, turn_id, tool, input }) => {
        if (pid !== paneId) return
        store.getState().addToolCall(turn_id, tool, input)
      }),
      bridge.onToolEnd(({ paneId: pid, turn_id, tool, output, isError }) => {
        if (pid !== paneId) return
        store.getState().finalizeToolCall(turn_id, tool, output, isError)
      }),
      bridge.onThinkingStart(({ paneId: pid, turn_id }) => {
        if (pid !== paneId) return
        store.getState().addThinking(turn_id)
      }),
      bridge.onThinkingChunk(({ paneId: pid, turn_id, text }) => {
        if (pid !== paneId) return
        store.getState().appendThinkingChunk(turn_id, text)
      }),
      bridge.onThinkingEnd(({ paneId: pid, turn_id, text }) => {
        if (pid !== paneId) return
        store.getState().finalizeThinking(turn_id, text)
      }),
      bridge.onTextBlockStart(({ paneId: pid, turn_id }) => {
        if (pid !== paneId) return
        store.getState().startTextBlock(turn_id)
      }),
      bridge.onTextBlockEnd(({ paneId: pid, turn_id }) => {
        if (pid !== paneId) return
        store.getState().finalizeTextBlock(turn_id)
      }),
      bridge.onHealth(({ paneId: pid, states }) => {
        if (pid !== paneId) return
        store.getState().setHealth(states)
      }),
      bridge.onError(({ paneId: pid, message }) => {
        if (pid !== paneId) return
        store.getState().addErrorMessage(message)
        toast.error(message)
      }),
    ]

    // Fetch initial state for this pane
    bridge.getHealth(paneId).then((states) => store.getState().setHealth(states)).catch(() => {})
    bridge
      .getState(paneId)
      .then((state) => {
        const modelRef = getModelRefFromState(state)
        if (modelRef) {
          store.getState().setModel(modelRef)
        }
        if (typeof state.sessionFile === 'string' && state.sessionFile) {
          store.getState().setSessionPath(state.sessionFile)
        }
        if (typeof state.sessionName === 'string' && state.sessionName) {
          store.getState().setSessionName(state.sessionName)
        }
      })
      .catch(() => {})

    // Fetch initial git/project info and set up shared branch poller
    let pollerKey: string | null = null
    bridge.getPaneInfo(paneId)
      .then((info) => {
        store.getState().setProjectRoot(info.projectRoot)
        return bridge.gitBranch(paneId).then((branch) => {
          store.getState().setGitBranch(branch)
          return info.projectRoot
        })
      })
      .then((root) => {
        pollerKey = root
        let entry = gitPollers.get(root)
        if (!entry) {
          const intervalId = setInterval(async () => {
            const branch = await bridge.gitBranch(paneId).catch(() => null)
            const current = store.getState().gitBranch
            if (branch !== current) store.getState().setGitBranch(branch)
          }, 30_000)
          entry = { refCount: 1, intervalId }
          gitPollers.set(root, entry)
        } else {
          entry.refCount++
        }
      })
      .catch(() => {})

    return () => {
      unsubs.forEach((u) => u())
      // Clean up git poller
      if (pollerKey) {
        const entry = gitPollers.get(pollerKey)
        if (entry) {
          entry.refCount--
          if (entry.refCount <= 0) {
            clearInterval(entry.intervalId)
            gitPollers.delete(pollerKey)
          }
        }
      }
    }
  }, [paneId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Submit handler
  const handleSubmit = useCallback(async (text: string, imageDataUrl?: string) => {
    try {
      const fullText = imageDataUrl
        ? (text ? `${text}\n[image: ${imageDataUrl}]` : `[image: ${imageDataUrl}]`)
        : text
      const turn_id = await bridge.prompt(paneId, fullText)
      store.getState().addUserMessage(text || '[image]', turn_id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send message'
      store.getState().addErrorMessage(msg)
    }
  }, [paneId, bridge, store])

  const handleAbort = useCallback(() => {
    bridge.abort(paneId).catch(() => {})
  }, [paneId, bridge])

  const inputDisabled = agentHealth === 'crashed' || agentHealth === 'degraded'

  const isOnlyPane = !onClose

  return (
    <>
      <div
        ref={rootRef}
        className={[
          'flex flex-col h-full overflow-hidden',
          isActive && !isOnlyPane ? 'outline outline-1 outline-accent/30' : '',
        ].join(' ')}
        onClick={!isActive ? onFocus : undefined}
      >
        {/* Messages area */}
        <main
          ref={scrollContainerRef as React.RefObject<HTMLElement | null>}
          className="flex-1 overflow-y-auto px-4 py-3 min-h-0"
        >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="text-2xl font-semibold text-text-primary">Lucent Chat</div>
            <p className="text-sm text-text-secondary max-w-xs">
              {agentHealth === 'ready'
                ? 'Ask anything to get started.'
                : agentHealth === 'starting'
                  ? 'Agent is starting up...'
                  : agentHealth === 'crashed'
                    ? 'Agent crashed. Restarting automatically...'
                    : 'Connecting to agent...'}
            </p>
            {agentHealth === 'ready' && (
              <div className="mt-3 grid grid-cols-2 gap-2 max-w-md w-full">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => void handleSubmit(s)}
                    disabled={inputDisabled || isGenerating}
                    className="rounded-xl border border-border bg-bg-secondary px-3 py-1.5 text-xs text-text-secondary hover:border-border-active hover:text-text-primary transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {isGenerating && (() => {
              const last = messages[messages.length - 1]
              const showThinking = !last || last.role === 'user' || (last.role === 'assistant' && last.contentBlocks.length === 0)
              return showThinking ? <ThinkingBubble /> : null
            })()}
            <div ref={messagesEndRef} />
          </div>
        )}
        </main>

        {/* Input bar */}
        <div className="flex-shrink-0 mx-auto w-full max-w-3xl">
          <ChatInput
            ref={inputRef}
            onSubmit={(t, img) => void handleSubmit(t, img)}
            onAbort={handleAbort}
            isGenerating={isGenerating}
            disabled={inputDisabled}
            voiceAvailable={voiceStore.available}
            voiceActive={voiceStore.active}
            isSpeaking={voiceStore.speaking}
            isTtsPlaying={voiceStore.ttsPlaying}
            partialTranscript={voiceStore.partialTranscript}
            unavailableReason={voiceStore.unavailableReason}
            onVoiceToggle={toggleVoice}
            onStopTts={stopTts}
          />
        </div>

        {/* Per-pane model picker bar */}
        <div className="flex-shrink-0 flex items-center justify-center border-t border-border/40 py-1">
          <button
            onClick={(e) => { e.stopPropagation(); if (!isActive) onFocus(); setModelPickerOpen(true) }}
            title={formatModelDisplay(currentModel, { includeProvider: true, fallback: 'Select model' })}
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-text-tertiary transition-colors hover:text-text-secondary hover:bg-bg-hover"
          >
            <Cpu className="h-2.5 w-2.5 flex-shrink-0" />
            <span className="font-mono">{formatModelDisplay(currentModel, { fallback: 'Select model' })}</span>
            <ChevronDown className="h-2.5 w-2.5 flex-shrink-0 opacity-60" />
          </button>
        </div>

        {/* Per-pane footer — git branch + project root */}
        <PaneFooter paneId={paneId} />
      </div>
      <ModelPicker open={modelPickerOpen} onOpenChange={setModelPickerOpen} paneId={paneId} />
    </>
  )
}
