/**
 * App — top-level layout with sidebar + chat area.
 *
 * Layout: resizable sidebar (react-resizable-panels) | chat column
 * Sidebar state (collapsed) persisted via settings.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useChatStore } from './store/chat'
import { ChatMessage } from './components/ChatMessage'
import { ChatInput } from './components/ChatInput'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'

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
    loadHistory,
  } = useChatStore()

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const bridge = window.bridge

  // -------------------------------------------------------------------------
  // Sidebar state
  // -------------------------------------------------------------------------

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  // Current session tracking (path + name)
  const [currentSessionPath, setCurrentSessionPath] = useState<string | null>(null)
  const [currentSessionName, setCurrentSessionName] = useState<string>('')

  // -------------------------------------------------------------------------
  // Load persisted settings on mount
  // -------------------------------------------------------------------------

  useEffect(() => {
    bridge
      .getSettings()
      .then((s) => {
        if (typeof s.sidebarCollapsed === 'boolean') {
          setSidebarCollapsed(s.sidebarCollapsed)
        }
      })
      .catch(() => {})
      .finally(() => setSettingsLoaded(true))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Persist sidebar collapsed state when it changes
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!settingsLoaded) return
    bridge.setSettings({ sidebarCollapsed }).catch(() => {})
  }, [sidebarCollapsed, settingsLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Register bridge event listeners once on mount
  // -------------------------------------------------------------------------

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
        // Capture initial session path if available
        if (typeof state.sessionPath === 'string' && state.sessionPath) {
          setCurrentSessionPath(state.sessionPath)
        }
        if (typeof state.sessionName === 'string' && state.sessionName) {
          setCurrentSessionName(state.sessionName)
        }
      })
      .catch(() => {})

    return () => unsubs.forEach((unsub) => unsub())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Scroll to bottom when messages change
  // -------------------------------------------------------------------------

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // -------------------------------------------------------------------------
  // Keyboard shortcuts
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when focus is in an input/textarea
      const tag = (e.target as HTMLElement).tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return

      if (e.metaKey && e.key === 'b') {
        e.preventDefault()
        handleToggleSidebar()
      }
      if (e.metaKey && e.key === 'n') {
        e.preventDefault()
        void handleNewSession()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Session actions
  // -------------------------------------------------------------------------

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => !c)
  }, [])

  const handleNewSession = useCallback(async () => {
    // After newSession, clear messages and update tracking
    const history = await bridge.getMessages().catch(() => [] as Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>)
    loadHistory(history)
    // Re-fetch state to get new session path/name
    bridge
      .getState()
      .then((state) => {
        if (typeof state.sessionPath === 'string') setCurrentSessionPath(state.sessionPath)
        if (typeof state.sessionName === 'string') setCurrentSessionName(state.sessionName)
      })
      .catch(() => {})
  }, [bridge, loadHistory])

  const handleSwitchSession = useCallback(async (path: string) => {
    // Load messages for the newly switched session
    const history = await bridge.getMessages().catch(() => [] as Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>)
    loadHistory(history)
    setCurrentSessionPath(path)
    // Re-fetch state to get updated session name
    bridge
      .getState()
      .then((state) => {
        if (typeof state.sessionName === 'string') setCurrentSessionName(state.sessionName)
      })
      .catch(() => {})
  }, [bridge, loadHistory])

  const handleRefresh = useCallback(() => {
    // After rename/delete, refresh state
    bridge
      .getState()
      .then((state) => {
        if (typeof state.sessionPath === 'string') setCurrentSessionPath(state.sessionPath)
        if (typeof state.sessionName === 'string') setCurrentSessionName(state.sessionName)
      })
      .catch(() => {})
  }, [bridge])

  // -------------------------------------------------------------------------
  // Chat actions
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-screen flex-col bg-bg-primary text-text-primary select-none overflow-hidden">
      {/* Main content: sidebar + chat */}
      <div className="flex flex-1 min-h-0">
        {sidebarCollapsed ? (
          // Collapsed sidebar — thin icon strip
          <Sidebar
            collapsed={true}
            onToggleCollapse={handleToggleSidebar}
            currentSessionPath={currentSessionPath}
            onNewSession={() => void handleNewSession()}
            onSwitchSession={(path) => void handleSwitchSession(path)}
            onRefresh={handleRefresh}
          />
        ) : (
          <PanelGroup orientation="horizontal" className="flex-1 min-h-0">
            {/* Sidebar panel */}
            <Panel
              defaultSize={22}
              minSize={15}
              maxSize={35}
              className="flex flex-col"
            >
              <Sidebar
                collapsed={false}
                onToggleCollapse={handleToggleSidebar}
                currentSessionPath={currentSessionPath}
                onNewSession={() => void handleNewSession()}
                onSwitchSession={(path) => void handleSwitchSession(path)}
                onRefresh={handleRefresh}
              />
            </Panel>

            {/* Resize handle */}
            <PanelResizeHandle className="w-px bg-border hover:bg-accent/40 transition-colors cursor-col-resize" />

            {/* Chat panel */}
            <Panel className="flex flex-col min-h-0">
              <ChatColumn
                messages={messages}
                agentHealth={agentHealth}
                isGenerating={isGenerating}
                currentModel={currentModel}
                inputDisabled={inputDisabled}
                suggestions={suggestions}
                messagesEndRef={messagesEndRef}
                onSubmit={(t) => void handleSubmit(t)}
                onAbort={handleAbort}
              />
            </Panel>
          </PanelGroup>
        )}

        {/* When collapsed, chat fills remaining space */}
        {sidebarCollapsed && (
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            <ChatColumn
              messages={messages}
              agentHealth={agentHealth}
              isGenerating={isGenerating}
              currentModel={currentModel}
              inputDisabled={inputDisabled}
              suggestions={suggestions}
              messagesEndRef={messagesEndRef}
              onSubmit={(t) => void handleSubmit(t)}
              onAbort={handleAbort}
            />
          </div>
        )}
      </div>

      {/* Status bar */}
      <StatusBar
        model={currentModel}
        sessionName={currentSessionName}
        health={agentHealth}
      />
    </div>
  )
}

// ============================================================================
// ChatColumn — extracted to avoid duplication in collapsed/expanded layouts
// ============================================================================

interface ChatColumnProps {
  messages: ReturnType<typeof useChatStore.getState>['messages']
  agentHealth: string
  isGenerating: boolean
  currentModel: string
  inputDisabled: boolean
  suggestions: string[]
  messagesEndRef: React.RefObject<HTMLDivElement>
  onSubmit: (text: string) => void
  onAbort: () => void
}

function ChatColumn({
  messages,
  agentHealth,
  isGenerating,
  inputDisabled,
  suggestions,
  messagesEndRef,
  onSubmit,
  onAbort,
}: ChatColumnProps) {
  return (
    <>
      {/* Header */}
      <header
        className="flex items-center justify-between border-b border-border px-5 py-3 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <span>Voice Bridge</span>
        </div>

        <div
          className="flex items-center gap-1.5 text-xs text-text-tertiary"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <span className="capitalize">
            {agentHealth === 'unknown' ? 'connecting' : agentHealth}
          </span>
        </div>
      </header>

      {/* Messages area */}
      <main className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="text-2xl font-semibold text-text-primary">Voice Bridge</div>
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
                    onClick={() => onSubmit(s)}
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
          onSubmit={onSubmit}
          onAbort={onAbort}
          isGenerating={isGenerating}
          disabled={inputDisabled}
        />
      </div>
    </>
  )
}
