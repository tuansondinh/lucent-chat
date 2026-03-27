/**
 * App — top-level chat interface.
 *
 * Wires window.bridge event listeners on mount and renders the chat UI.
 * Text-only (Phase 2). Voice/TTS path reserved for Phase 4.
 */

import { useEffect, useRef } from 'react'
import { useChatStore } from './store/chat'
import { ChatMessage } from './components/ChatMessage'
import { ChatInput } from './components/ChatInput'

// ============================================================================
// Health indicator dot
// ============================================================================

function HealthDot({ health }: { health: string }) {
  const colorClass =
    health === 'ready'
      ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]'
      : health === 'starting'
        ? 'bg-accent shadow-[0_0_6px_rgba(212,160,78,0.6)] animate-pulse'
        : health === 'crashed' || health === 'degraded'
          ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]'
          : 'bg-bg-tertiary'
  return <span className={`h-2 w-2 rounded-full flex-shrink-0 ${colorClass}`} />
}

// ============================================================================
// App
// ============================================================================

export default function App() {
  const {
    messages,
    agentHealth,
    isGenerating,
    currentModel,
    appendChunk,
    finalizeMessage,
    addUserMessage,
    addToolCall,
    finalizeToolCall,
    setHealth,
    addErrorMessage,
    setModel,
  } = useChatStore()

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const bridge = window.bridge

  // Register bridge event listeners once on mount
  useEffect(() => {
    const unsubs = [
      bridge.onAgentChunk(({ turn_id, text }) => {
        appendChunk(turn_id, text)
      }),
      bridge.onAgentDone(({ turn_id, full_text }) => {
        finalizeMessage(turn_id, full_text)
      }),
      bridge.onToolStart(({ turn_id, tool, input }) => {
        addToolCall(turn_id, tool, input)
      }),
      bridge.onToolEnd(({ turn_id, tool, output, isError }) => {
        finalizeToolCall(turn_id, tool, output, isError)
      }),
      bridge.onHealth((states) => {
        setHealth(states)
      }),
      bridge.onError(({ message }) => {
        addErrorMessage(message)
      }),
    ]

    // Fetch initial health + model state
    bridge.getHealth().then(setHealth).catch(() => {})
    bridge
      .getState()
      .then((state) => {
        const model = state.model as { provider?: string; id?: string } | undefined
        if (model?.id) {
          setModel(`${model.provider ?? ''}/${model.id}`)
        }
      })
      .catch(() => {})

    return () => unsubs.forEach((unsub) => unsub())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = async (text: string) => {
    try {
      const turn_id = await bridge.prompt(text)
      addUserMessage(text, turn_id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send message'
      addErrorMessage(msg)
    }
  }

  const handleAbort = () => {
    bridge.abort().catch(() => {})
  }

  const inputDisabled = agentHealth === 'crashed' || agentHealth === 'degraded'

  const suggestions = [
    'What can you help me with?',
    'Show me the project structure',
    'Read the README',
    'What files are here?',
  ]

  return (
    <div className="flex h-screen flex-col bg-bg-primary text-text-primary select-none">
      {/* Header */}
      <header
        className="flex items-center justify-between border-b border-border px-5 py-3 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Traffic-light spacer (macOS hiddenInset titlebar) */}
        <div className="w-20 flex-shrink-0" />

        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <span>GSD Studio</span>
          {currentModel && (
            <span className="text-text-tertiary text-xs font-normal">
              &middot; {currentModel}
            </span>
          )}
        </div>

        <div
          className="flex items-center gap-1.5 text-xs text-text-tertiary"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <HealthDot health={agentHealth} />
          <span className="capitalize">
            {agentHealth === 'unknown' ? 'connecting' : agentHealth}
          </span>
        </div>
      </header>

      {/* Messages area */}
      <main className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="text-2xl font-semibold text-text-primary">GSD Studio</div>
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
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* Input bar */}
      <div className="flex-shrink-0 mx-auto w-full max-w-3xl">
        <ChatInput
          onSubmit={(t) => void handleSubmit(t)}
          onAbort={handleAbort}
          isGenerating={isGenerating}
          disabled={inputDisabled}
        />
      </div>
    </div>
  )
}
