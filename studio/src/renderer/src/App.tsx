/**
 * App — top-level layout with sidebar + chat area.
 *
 * Layout: resizable sidebar (react-resizable-panels) | chat column
 * Sidebar state (collapsed) persisted via settings.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { toast, Toaster } from 'sonner'
import { useChatStore } from './store/chat'
import { ChatMessage } from './components/ChatMessage'
import { ChatInput } from './components/ChatInput'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { ModelPicker } from './components/ModelPicker'
import { CommandPalette } from './components/CommandPalette'
import { Settings } from './components/Settings'
import { Onboarding } from './components/Onboarding'
import { Terminal } from './components/Terminal'
import { FileViewer } from './components/FileViewer'

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
// App
// ============================================================================

export default function App() {
  const {
    messages,
    agentHealth,
    isGenerating,
    currentModel,
    viewedFile,
    scrollPositions,
    appendChunk,
    finalizeMessage,
    addUserMessage,
    addToolCall,
    finalizeToolCall,
    setHealth,
    addErrorMessage,
    setModel,
    loadHistory,
    saveScrollPosition,
  } = useChatStore()

  const messagesEndRef = useRef<HTMLDivElement>(null)
  /** Ref to the scrollable messages container — used to save/restore scroll position. */
  const scrollContainerRef = useRef<HTMLElement>(null)
  const bridge = window.bridge

  // -------------------------------------------------------------------------
  // UI state
  // -------------------------------------------------------------------------

  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [fileViewerOpen, setFileViewerOpen] = useState(false)

  // Current session tracking (path + name)
  const [currentSessionPath, setCurrentSessionPath] = useState<string | null>(null)
  const [currentSessionName, setCurrentSessionName] = useState<string>('')

  // -------------------------------------------------------------------------
  // Auto-open file viewer when a file is viewed via tool call
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (viewedFile !== null) {
      setFileViewerOpen(true)
    }
  }, [viewedFile])

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
        // Show onboarding if not yet completed
        if (!s.onboardingComplete) {
          setShowOnboarding(true)
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
  // Sync native window title with current session name
  // -------------------------------------------------------------------------

  useEffect(() => {
    const title = currentSessionName ? currentSessionName : 'Lucent Chat'
    bridge.setWindowTitle(title).catch(() => {})
  }, [currentSessionName]) // eslint-disable-line react-hooks/exhaustive-deps

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
        toast.error(message)
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
        if (typeof state.sessionFile === 'string' && state.sessionFile) {
          setCurrentSessionPath(state.sessionFile)
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
      // Cmd+K — open command palette (always works, even in inputs)
      if (e.metaKey && e.key === 'k') {
        e.preventDefault()
        setCommandPaletteOpen((v) => !v)
        return
      }

      // Cmd+` — toggle terminal panel (always works, even in inputs)
      if (e.metaKey && e.key === '`') {
        e.preventDefault()
        setTerminalOpen((v) => !v)
        return
      }

      // Cmd+Shift+F — toggle file viewer panel (always works, even in inputs)
      if (e.metaKey && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        setFileViewerOpen((v) => !v)
        return
      }

      // Escape — close command palette first; if not open, stop generation
      if (e.key === 'Escape') {
        setCommandPaletteOpen((open) => {
          if (open) {
            e.preventDefault()
            return false
          }
          return open
        })
        // If palette was not open, let Escape propagate to stop generation
        return
      }

      // Don't capture remaining shortcuts when focus is in an input/textarea
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
      if (e.metaKey && e.key === 'm') {
        e.preventDefault()
        setModelPickerOpen((v) => !v)
      }
      if (e.metaKey && e.key === ',') {
        e.preventDefault()
        setSettingsOpen((v) => !v)
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
        if (typeof state.sessionFile === 'string') setCurrentSessionPath(state.sessionFile)
        if (typeof state.sessionName === 'string') setCurrentSessionName(state.sessionName)
      })
      .catch(() => {})
  }, [bridge, loadHistory])

  const handleSwitchSession = useCallback(async (path: string) => {
    // Save current session's scroll position before switching
    if (currentSessionPath && scrollContainerRef.current) {
      saveScrollPosition(currentSessionPath, scrollContainerRef.current.scrollTop)
    }

    // Load messages for the newly switched session
    const history = await bridge.getMessages().catch(() => [] as Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>)
    loadHistory(history)
    setCurrentSessionPath(path)

    // Re-fetch state to get updated session name
    bridge
      .getState()
      .then((state) => {
        const name = typeof state.sessionName === 'string' ? state.sessionName : ''
        setCurrentSessionName(name)
        if (name) toast.success(`Switched to ${name}`)

        // Restore scroll position for this session after the DOM updates
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            const saved = scrollPositions[path]
            scrollContainerRef.current.scrollTop = saved ?? scrollContainerRef.current.scrollHeight
          }
        })
      })
      .catch(() => {})
  }, [bridge, loadHistory, currentSessionPath, scrollPositions, saveScrollPosition]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = useCallback(() => {
    // After rename/delete, refresh state
    bridge
      .getState()
      .then((state) => {
        if (typeof state.sessionFile === 'string') setCurrentSessionPath(state.sessionFile)
        if (typeof state.sessionName === 'string') setCurrentSessionName(state.sessionName)
      })
      .catch(() => {})
  }, [bridge])

  // -------------------------------------------------------------------------
  // Model actions
  // -------------------------------------------------------------------------

  const handleSwitchModel = useCallback(async (provider: string, modelId: string) => {
    try {
      await bridge.switchModel(provider, modelId)
      setModel(`${provider}/${modelId}`)
    } catch (err) {
      console.error('[model] switchModel failed:', err)
    }
  }, [bridge, setModel])

  // -------------------------------------------------------------------------
  // Chat actions
  // -------------------------------------------------------------------------

  const handleSubmit = async (text: string, imageDataUrl?: string) => {
    try {
      // If an image was pasted, append it to the prompt text as an inline marker
      const fullText = imageDataUrl ? (text ? `${text}\n[image: ${imageDataUrl}]` : `[image: ${imageDataUrl}]`) : text
      const turn_id = await bridge.prompt(fullText)
      addUserMessage(text || '[image]', turn_id)
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
      {/* Vertical panel group: chat area on top, optional terminal at bottom */}
      <PanelGroup orientation="vertical" className="flex-1 min-h-0">
        {/* Top panel: sidebar + chat */}
        <Panel className="flex min-h-0">
          {/* Main content: sidebar + chat */}
          <div className="flex flex-1 min-h-0">
            {/* Collapsed sidebar — fixed-width icon strip, outside PanelGroup */}
            {sidebarCollapsed && (
              <>
                <Sidebar
                  collapsed={true}
                  onToggleCollapse={handleToggleSidebar}
                  currentSessionPath={currentSessionPath}
                  onNewSession={() => void handleNewSession()}
                  onSwitchSession={(path) => void handleSwitchSession(path)}
                  onRefresh={handleRefresh}
                  onOpenModelPicker={() => setModelPickerOpen(true)}
                  onOpenSettings={() => setSettingsOpen(true)}
                />
                {fileViewerOpen ? (
                  <PanelGroup orientation="horizontal" className="flex-1 min-h-0">
                    <Panel className="flex flex-col min-h-0 min-w-0">
                      <ChatColumn
                        messages={messages}
                        agentHealth={agentHealth}
                        isGenerating={isGenerating}
                        currentModel={currentModel}
                        sidebarCollapsed={true}
                        inputDisabled={inputDisabled}
                        suggestions={suggestions}
                        messagesEndRef={messagesEndRef}
                        scrollContainerRef={scrollContainerRef}
                        onSubmit={(t, img) => void handleSubmit(t, img)}
                        onAbort={handleAbort}
                      />
                    </Panel>
                    <PanelResizeHandle className="w-px bg-border hover:bg-accent/40 transition-colors cursor-col-resize" />
                    <Panel defaultSize="35%" minSize="20%" maxSize="60%" className="flex flex-col min-h-0 min-w-0">
                      <FileViewer onClose={() => setFileViewerOpen(false)} />
                    </Panel>
                  </PanelGroup>
                ) : (
                  <div className="flex-1 flex flex-col min-h-0 min-w-0">
                    <ChatColumn
                      messages={messages}
                      agentHealth={agentHealth}
                      isGenerating={isGenerating}
                      currentModel={currentModel}
                      sidebarCollapsed={true}
                      inputDisabled={inputDisabled}
                      suggestions={suggestions}
                      messagesEndRef={messagesEndRef}
                      scrollContainerRef={scrollContainerRef}
                      onSubmit={(t, img) => void handleSubmit(t, img)}
                      onAbort={handleAbort}
                    />
                  </div>
                )}
              </>
            )}

            {/* Expanded sidebar — resizable via PanelGroup */}
            {!sidebarCollapsed && (
              <PanelGroup orientation="horizontal" className="flex-1 min-h-0">
                <Panel defaultSize="28%" minSize="24%" className="flex flex-col overflow-hidden">
                  <Sidebar
                    collapsed={false}
                    onToggleCollapse={handleToggleSidebar}
                    currentSessionPath={currentSessionPath}
                    onNewSession={() => void handleNewSession()}
                    onSwitchSession={(path) => void handleSwitchSession(path)}
                    onRefresh={handleRefresh}
                    onOpenModelPicker={() => setModelPickerOpen(true)}
                    onOpenSettings={() => setSettingsOpen(true)}
                  />
                </Panel>
                <PanelResizeHandle className="w-px bg-border hover:bg-accent/40 transition-colors cursor-col-resize" />
                <Panel className="flex flex-col min-h-0">
                  <ChatColumn
                    messages={messages}
                    agentHealth={agentHealth}
                    isGenerating={isGenerating}
                    currentModel={currentModel}
                    sidebarCollapsed={false}
                    inputDisabled={inputDisabled}
                    suggestions={suggestions}
                    messagesEndRef={messagesEndRef}
                    scrollContainerRef={scrollContainerRef}
                    onSubmit={(t, img) => void handleSubmit(t, img)}
                    onAbort={handleAbort}
                  />
                </Panel>
                {fileViewerOpen && (
                  <>
                    <PanelResizeHandle className="w-px bg-border hover:bg-accent/40 transition-colors cursor-col-resize" />
                    <Panel defaultSize="35%" minSize="20%" maxSize="60%" className="flex flex-col min-h-0 min-w-0">
                      <FileViewer onClose={() => setFileViewerOpen(false)} />
                    </Panel>
                  </>
                )}
              </PanelGroup>
            )}
          </div>
        </Panel>

        {/* Terminal panel — toggled with Cmd+` */}
        {terminalOpen && (
          <>
            <PanelResizeHandle className="h-px bg-border hover:bg-accent/40 transition-colors cursor-row-resize" />
            <Panel defaultSize="30%" minSize="10%" className="flex flex-col min-h-0">
              <Terminal />
            </Panel>
          </>
        )}
      </PanelGroup>

      {/* Status bar */}
      <StatusBar
        model={currentModel}
        sessionName={currentSessionName}
        health={agentHealth}
        onOpenModelPicker={() => setModelPickerOpen(true)}
      />

      {/* Model picker dialog */}
      <ModelPicker open={modelPickerOpen} onOpenChange={setModelPickerOpen} />

      {/* Command palette — Cmd+K */}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNewSession={() => void handleNewSession()}
        onSwitchSession={(path) => void handleSwitchSession(path)}
        onToggleSidebar={handleToggleSidebar}
        onSwitchModel={(provider, modelId) => void handleSwitchModel(provider, modelId)}
        onStopGeneration={handleAbort}
        onSettings={() => setSettingsOpen(true)}
        isGenerating={isGenerating}
      />

      {/* Settings dialog — Cmd+, */}
      <Settings open={settingsOpen} onOpenChange={setSettingsOpen} />

      {/* First-run onboarding overlay */}
      {showOnboarding && (
        <Onboarding onComplete={() => setShowOnboarding(false)} />
      )}

      {/* Toast notifications — bottom-right, dark theme */}
      <Toaster position="bottom-right" theme="dark" richColors />
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
  sidebarCollapsed: boolean
  inputDisabled: boolean
  suggestions: string[]
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  /** Ref attached to the scrollable messages container. */
  scrollContainerRef: React.RefObject<HTMLElement | null>
  onSubmit: (text: string, imageDataUrl?: string) => void
  onAbort: () => void
}

function ChatColumn({
  messages,
  agentHealth,
  isGenerating,
  sidebarCollapsed,
  inputDisabled,
  suggestions,
  messagesEndRef,
  scrollContainerRef,
  onSubmit,
  onAbort,
}: ChatColumnProps) {
  return (
    <>
      {/* Header */}
      <header
        className={`flex items-center justify-between border-b border-border py-3 pr-5 flex-shrink-0 ${sidebarCollapsed ? 'pl-14' : 'px-5'}`}
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
        </div>
      </header>

      {/* Messages area */}
      <main ref={scrollContainerRef as React.RefObject<HTMLElement | null>} className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
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
            {isGenerating && (() => {
              const last = messages[messages.length - 1]
              const showThinking = !last || last.role === 'user' || (last.role === 'assistant' && !last.text && last.toolCalls.length === 0)
              return showThinking ? <ThinkingBubble /> : null
            })()}
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
