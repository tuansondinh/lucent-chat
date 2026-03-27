/**
 * ChatPane — a single self-contained chat pane with its own agent process.
 *
 * Owns: per-pane store subscription, bridge event listeners (filtered to this pane),
 * submit/abort handlers, session state, and the full chat column UI.
 */

import { useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { getPaneStore } from '../store/pane-store'

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
    viewedFile,
  } = store()

  const bridge = window.bridge
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLElement>(null)

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
      }),
      bridge.onAgentDone(({ paneId: pid, turn_id, full_text }) => {
        if (pid !== paneId) return
        store.getState().finalizeMessage(turn_id, full_text)
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
        const model = state.model as { provider?: string; id?: string } | undefined
        if (model?.id) {
          store.getState().setModel(`${model.provider ?? ''}/${model.id}`)
        }
        if (typeof state.sessionFile === 'string' && state.sessionFile) {
          store.getState().setSessionPath(state.sessionFile)
        }
        if (typeof state.sessionName === 'string' && state.sessionName) {
          store.getState().setSessionName(state.sessionName)
        }
      })
      .catch(() => {})

    return () => unsubs.forEach((u) => u())
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
    <div
      className={[
        'flex flex-col h-full overflow-hidden',
        isActive && !isOnlyPane ? 'outline outline-1 outline-accent/30' : '',
      ].join(' ')}
      onClick={!isActive ? onFocus : undefined}
    >
      {/* Header */}
      <header
        className={[
          'flex items-center justify-between border-b border-border py-3 pr-5 flex-shrink-0',
          sidebarCollapsed && isOnlyPane ? 'pl-14' : 'px-5',
        ].join(' ')}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <span>Lucent Chat</span>
        </div>

        <div
          className="flex items-center gap-1.5 text-xs text-text-tertiary"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <span className="capitalize">
            {agentHealth === 'unknown' ? 'connecting' : agentHealth}
          </span>
          {onClose && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClose()
              }}
              title="Close pane"
              className="ml-1 flex items-center justify-center w-5 h-5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* Messages area */}
      <main
        ref={scrollContainerRef as React.RefObject<HTMLElement | null>}
        className="flex-1 overflow-y-auto px-4 py-4 min-h-0"
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
              <div className="mt-4 grid grid-cols-2 gap-2 max-w-md w-full">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => void handleSubmit(s)}
                    disabled={inputDisabled || isGenerating}
                    className="rounded-xl border border-border bg-bg-secondary px-3 py-2 text-xs text-text-secondary hover:border-border-active hover:text-text-primary transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
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
          onSubmit={(t, img) => void handleSubmit(t, img)}
          onAbort={handleAbort}
          isGenerating={isGenerating}
          disabled={inputDisabled}
        />
      </div>
    </div>
  )
}
