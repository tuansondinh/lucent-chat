/**
 * App — top-level layout with sidebar + multi-pane chat area.
 *
 * Phase 4C: Supports up to 4 independent chat panes side by side.
 * Each pane has its own agent process, bridge, orchestrator, and session.
 *
 * Layout: resizable sidebar | PanelGroup of ChatPane components
 * Keyboard shortcuts:
 *   Cmd+\  → split (create new pane, max 4)
 *   Cmd+W  → close active pane (if > 1)
 *   Cmd+1-4 → focus pane 1-4
 */

import { useEffect, useCallback, useState } from 'react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { toast, Toaster } from 'sonner'
import { useChatStore } from './store/chat'
import { usePanesStore, getPaneStore, deletePaneStore } from './store/pane-store'
import { useVoiceStore } from './store/voice-store'
import { ChatPane } from './components/ChatPane'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { ModelPicker } from './components/ModelPicker'
import { CommandPalette } from './components/CommandPalette'
import { Settings } from './components/Settings'
import { Onboarding } from './components/Onboarding'
import { Terminal } from './components/Terminal'
import { FileViewer } from './components/FileViewer'
import { formatModelDisplay, getModelRefFromState } from './lib/models'

// ============================================================================
// App
// ============================================================================

export default function App() {
  const bridge = window.bridge

  // Pane layout state
  const { paneIds, activePaneId, addPane, removePane, setActivePane } = usePanesStore()

  // Active pane's store (for status bar + command palette model)
  const activePaneStore = getPaneStore(activePaneId)
  const {
    agentHealth: activePaneHealth,
    currentModel: activePaneModel,
    currentSessionPath: activePaneSessionPath,
    currentSessionName: activePaneSessionName,
    isGenerating: activePaneGenerating,
  } = activePaneStore()

  // Voice state for StatusBar indicator
  const { active: voiceActive, speaking: voiceSpeaking, ttsPlaying: voiceTtsPlaying } = useVoiceStore()

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

  // -------------------------------------------------------------------------
  // Auto-open file viewer when a file is viewed via tool call in active pane
  // -------------------------------------------------------------------------

  const activeViewedFile = activePaneStore((s) => s.viewedFile)
  useEffect(() => {
    if (activeViewedFile !== null) {
      setFileViewerOpen(true)
    }
  }, [activeViewedFile])

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
  // Voice service probe + status subscription
  // Phase 2 wires the main-process side; these calls are graceful no-ops until then.
  // -------------------------------------------------------------------------

  useEffect(() => {
    // Initial probe — check if sidecar is available
    bridge.voiceProbe()
      .then(({ available, reason }) => {
        useVoiceStore.getState().setAvailable(available, reason ?? null)
      })
      .catch(() => {})

    // Subscribe to ongoing voice status events
    const unsub = bridge.onVoiceStatus((data) => {
      const vs = useVoiceStore.getState()
      vs.setSidecarState(data.state as ReturnType<typeof useVoiceStore.getState>['sidecarState'])
      vs.setPort(data.port)
      vs.setAvailable(data.state === 'ready' || data.available)
    })

    return unsub
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Sync native window title with active pane's session name
  // -------------------------------------------------------------------------

  useEffect(() => {
    const title = activePaneSessionName ? activePaneSessionName : 'Lucent Chat'
    bridge.setWindowTitle(title).catch(() => {})
  }, [activePaneSessionName]) // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Pane split / close actions
  // -------------------------------------------------------------------------

  const handleSplitPane = useCallback(async () => {
    if (paneIds.length >= 4) {
      toast.error('Maximum 4 panes allowed')
      return
    }
    try {
      const { paneId } = await bridge.paneCreate()
      addPane(paneId)
    } catch (err) {
      console.error('[pane] create failed:', err)
      toast.error('Failed to create pane')
    }
  }, [paneIds.length, bridge, addPane])

  const handleClosePane = useCallback(async (paneIdToClose: string) => {
    if (paneIds.length <= 1) return
    try {
      await bridge.paneClose(paneIdToClose)
      removePane(paneIdToClose)
      deletePaneStore(paneIdToClose)
    } catch (err) {
      console.error('[pane] close failed:', err)
    }
  }, [paneIds.length, bridge, removePane])

  // -------------------------------------------------------------------------
  // Sidebar / session actions (scoped to active pane)
  // -------------------------------------------------------------------------

  const syncPaneState = useCallback(async (paneId: string) => {
    const state = await bridge.getState(paneId)
    const paneStore = getPaneStore(paneId).getState()
    const modelRef = getModelRefFromState(state)
    if (modelRef) paneStore.setModel(modelRef)
    if (typeof state.sessionFile === 'string') paneStore.setSessionPath(state.sessionFile)
    if (typeof state.sessionName === 'string') paneStore.setSessionName(state.sessionName)
    return { state, modelRef }
  }, [bridge])

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => !c)
  }, [])

  const handleNewSession = useCallback(async () => {
    const history = await bridge.getMessages(activePaneId).catch(() => [] as Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>)
    getPaneStore(activePaneId).getState().loadHistory(history)
    syncPaneState(activePaneId).catch(() => {})
  }, [bridge, activePaneId, syncPaneState])

  const handleSwitchSession = useCallback(async (path: string) => {
    const history = await bridge.getMessages(activePaneId).catch(() => [] as Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>)
    getPaneStore(activePaneId).getState().loadHistory(history)
    getPaneStore(activePaneId).getState().setSessionPath(path)
    syncPaneState(activePaneId)
      .then(({ state }) => {
        const name = typeof state.sessionName === 'string' ? state.sessionName : ''
        if (name) toast.success(`Switched to ${name}`)
      })
      .catch(() => {})
  }, [bridge, activePaneId, syncPaneState])

  const handleRefresh = useCallback(() => {
    syncPaneState(activePaneId).catch(() => {})
  }, [activePaneId, syncPaneState])

  // -------------------------------------------------------------------------
  // Model actions (scoped to active pane)
  // -------------------------------------------------------------------------

  const handleSwitchModel = useCallback(async (provider: string, modelId: string) => {
    const requestedModel = `${provider}/${modelId}`
    try {
      await bridge.switchModel(activePaneId, provider, modelId)
      const { modelRef } = await syncPaneState(activePaneId)
      if (modelRef && modelRef !== requestedModel) {
        toast.error(`Model switch did not apply. Active model is ${formatModelDisplay(modelRef, { includeProvider: true })}.`)
        return
      }
      if (!modelRef) {
        toast.error('Model switch completed, but the active model could not be confirmed.')
        return
      }
      toast.success(`Switched to ${formatModelDisplay(modelRef, { includeProvider: true })}`)
    } catch (err) {
      console.error('[model] switchModel failed:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to switch model')
    }
  }, [bridge, activePaneId, syncPaneState])

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

      // Cmd+` — toggle terminal panel
      if (e.metaKey && e.key === '`') {
        e.preventDefault()
        setTerminalOpen((v) => !v)
        return
      }

      // Cmd+Shift+F — toggle file viewer panel
      if (e.metaKey && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        setFileViewerOpen((v) => !v)
        return
      }

      // Cmd+D — split pane (layout-independent shortcut)
      if (e.metaKey && e.key === 'd') {
        e.preventDefault()
        void handleSplitPane()
        return
      }

      // Escape — close command palette first; if not open, let propagate
      if (e.key === 'Escape') {
        setCommandPaletteOpen((open) => {
          if (open) {
            e.preventDefault()
            return false
          }
          return open
        })
        return
      }

      // Cmd+1-4 — focus pane by index (works even in inputs)
      if (e.metaKey && ['1', '2', '3', '4'].includes(e.key)) {
        const idx = parseInt(e.key, 10) - 1
        const ids = usePanesStore.getState().paneIds
        if (idx < ids.length) {
          e.preventDefault()
          setActivePane(ids[idx])
          return
        }
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
      // Cmd+W — close active pane
      if (e.metaKey && e.key === 'w') {
        e.preventDefault()
        void handleClosePane(usePanesStore.getState().activePaneId)
        return
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const sidebarEl = (
    <Sidebar
      collapsed={sidebarCollapsed}
      onToggleCollapse={handleToggleSidebar}
      currentSessionPath={activePaneSessionPath}
      activePaneId={activePaneId}
      onNewSession={() => void handleNewSession()}
      onSwitchSession={(path) => void handleSwitchSession(path)}
      onRefresh={handleRefresh}
      onOpenModelPicker={() => setModelPickerOpen(true)}
      onOpenSettings={() => setSettingsOpen(true)}
    />
  )

  // Multi-pane horizontal layout
  const chatPaneGroup = (
    <PanelGroup orientation="horizontal" className="flex-1 min-h-0">
      {paneIds.map((paneId, i) => (
        <>
          {i > 0 && (
            <PanelResizeHandle
              key={`sep-${paneId}`}
              className="w-px bg-border hover:bg-accent/40 transition-colors cursor-col-resize"
            />
          )}
          <Panel key={paneId} minSize={15} className="flex flex-col min-h-0 min-w-0">
            <ChatPane
              paneId={paneId}
              isActive={paneId === activePaneId}
              sidebarCollapsed={sidebarCollapsed && paneIds.length === 1}
              onFocus={() => setActivePane(paneId)}
              onClose={paneIds.length > 1 ? () => void handleClosePane(paneId) : undefined}
            />
          </Panel>
        </>
      ))}
    </PanelGroup>
  )

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-screen flex-col bg-bg-primary text-text-primary select-none overflow-hidden">
      {/* Vertical panel group: chat area on top, optional terminal at bottom */}
      <PanelGroup orientation="vertical" className="flex-1 min-h-0">
        {/* Top panel: sidebar + chat panes */}
        <Panel className="flex min-h-0">
          <div className="flex flex-1 min-h-0">
            {/* Collapsed sidebar — fixed-width icon strip */}
            {sidebarCollapsed && (
              <>
                {sidebarEl}
                {fileViewerOpen ? (
                  <PanelGroup orientation="horizontal" className="flex-1 min-h-0">
                    <Panel className="flex flex-col min-h-0 min-w-0">
                      {chatPaneGroup}
                    </Panel>
                    <PanelResizeHandle className="w-px bg-border hover:bg-accent/40 transition-colors cursor-col-resize" />
                    <Panel defaultSize={35} minSize={20} maxSize={60} className="flex flex-col min-h-0 min-w-0">
                      <FileViewer onClose={() => setFileViewerOpen(false)} />
                    </Panel>
                  </PanelGroup>
                ) : (
                  <div className="flex-1 flex flex-col min-h-0 min-w-0">
                    {chatPaneGroup}
                  </div>
                )}
              </>
            )}

            {/* Expanded sidebar — resizable via PanelGroup */}
            {!sidebarCollapsed && (
              <PanelGroup orientation="horizontal" className="flex-1 min-h-0">
                <Panel defaultSize={28} minSize={20} className="flex flex-col overflow-hidden">
                  {sidebarEl}
                </Panel>
                <PanelResizeHandle className="w-px bg-border hover:bg-accent/40 transition-colors cursor-col-resize" />
                <Panel className="flex flex-col min-h-0">
                  {chatPaneGroup}
                </Panel>
                {fileViewerOpen && (
                  <>
                    <PanelResizeHandle className="w-px bg-border hover:bg-accent/40 transition-colors cursor-col-resize" />
                    <Panel defaultSize={35} minSize={20} maxSize={60} className="flex flex-col min-h-0 min-w-0">
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
            <Panel defaultSize={30} minSize={10} className="flex flex-col min-h-0">
              <Terminal />
            </Panel>
          </>
        )}
      </PanelGroup>

      {/* Status bar — reflects active pane */}
      <StatusBar
        model={activePaneModel}
        sessionName={activePaneSessionName}
        health={activePaneHealth}
        onOpenModelPicker={() => setModelPickerOpen(true)}
        voiceActive={voiceActive}
        voiceSpeaking={voiceSpeaking}
        voiceTtsPlaying={voiceTtsPlaying}
      />

      {/* Model picker dialog */}
      <ModelPicker open={modelPickerOpen} onOpenChange={setModelPickerOpen} />

      {/* Command palette — Cmd+K */}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        activePaneId={activePaneId}
        onNewSession={() => void handleNewSession()}
        onSwitchSession={(path) => void handleSwitchSession(path)}
        onToggleSidebar={handleToggleSidebar}
        onSwitchModel={(provider, modelId) => void handleSwitchModel(provider, modelId)}
        onStopGeneration={() => bridge.abort(activePaneId).catch(() => {})}
        onSettings={() => setSettingsOpen(true)}
        onSplitPane={() => void handleSplitPane()}
        onClosePane={paneIds.length > 1 ? () => void handleClosePane(activePaneId) : undefined}
        isGenerating={activePaneGenerating}
        canSplit={paneIds.length < 4}
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
