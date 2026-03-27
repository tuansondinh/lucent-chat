/**
 * App — top-level layout with sidebar + multi-pane chat area.
 *
 * Phase 4C+IDE: Supports up to 4 independent chat panes side by side.
 * Each pane has its own agent process, bridge, orchestrator, and session.
 *
 * Layout: sidebar | explorer (opt) | PanelGroup of ChatPane | FileViewer (opt)
 * Keyboard shortcuts:
 *   Cmd+D       → split pane horizontally (max 4)
 *   Cmd+Shift+D → split pane vertically
 *   Cmd+W       → close active pane (if > 1)
 *   Cmd+1-4     → focus pane 1-4
 *   Cmd+E       → toggle file explorer
 *   Cmd+Shift+F → toggle file viewer
 */

import { useEffect, useCallback, useState, useRef, type ReactNode } from 'react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { toast, Toaster } from 'sonner'
import { PanelLeft, PanelLeftClose } from 'lucide-react'
import { usePanesStore, getPaneStore, deletePaneStore, collectLeafIds, countLeaves, type LayoutNode, type PaneOrientation } from './store/pane-store'
import { deleteFileTreeStore } from './store/file-tree-store'
import { findPaneInDirection, focusPane, type Direction } from './lib/pane-refs'
import { ChatPane } from './components/ChatPane'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { ModelPicker } from './components/ModelPicker'
import { CommandPalette } from './components/CommandPalette'
import { Settings } from './components/Settings'
import { Onboarding } from './components/Onboarding'
import { Terminal } from './components/Terminal'
import { FileViewer } from './components/FileViewer'
import { FileTree } from './components/FileTree'
import { formatModelDisplay, getModelRefFromState } from './lib/models'

// ============================================================================
// Layout tree renderer (module-level to avoid re-creation on each render)
// ============================================================================

function renderLayoutNode(
  node: LayoutNode,
  activePaneId: string,
  sidebarCollapsed: boolean,
  paneCount: number,
  setActivePane: (id: string) => void,
  handleClosePane: (id: string) => Promise<void>,
): ReactNode {
  if (node.type === 'leaf') {
    return (
      <ChatPane
        key={node.paneId}
        paneId={node.paneId}
        isActive={node.paneId === activePaneId}
        sidebarCollapsed={sidebarCollapsed && paneCount === 1}
        onFocus={() => setActivePane(node.paneId)}
        onClose={paneCount > 1 ? () => void handleClosePane(node.paneId) : undefined}
      />
    )
  }
  const isHorizontal = node.orientation === 'horizontal'
  const minSize = isHorizontal ? 15 : 25
  const handleClass = isHorizontal
    ? 'w-px bg-accent/40 hover:bg-accent transition-colors cursor-col-resize'
    : 'h-px bg-accent/40 hover:bg-accent transition-colors cursor-row-resize'
  return (
    <PanelGroup key={node.id} orientation={node.orientation} className="flex-1 min-h-0">
      <Panel key={`${node.id}-0`} minSize={minSize} className="flex flex-col min-h-0 min-w-0">
        {renderLayoutNode(node.children[0], activePaneId, sidebarCollapsed, paneCount, setActivePane, handleClosePane)}
      </Panel>
      <PanelResizeHandle className={handleClass} />
      <Panel key={`${node.id}-1`} minSize={minSize} className="flex flex-col min-h-0 min-w-0">
        {renderLayoutNode(node.children[1], activePaneId, sidebarCollapsed, paneCount, setActivePane, handleClosePane)}
      </Panel>
    </PanelGroup>
  )
}

// ============================================================================
// App
// ============================================================================

export default function App() {
  const bridge = window.bridge

  // Pane layout state
  const { layout, activePaneId, setActivePane } = usePanesStore()
  const paneIds = collectLeafIds(layout)
  const paneCount = paneIds.length

  // Active pane's store (for status bar + command palette model)
  const activePaneStore = getPaneStore(activePaneId)
  const {
    agentHealth: activePaneHealth,
    currentModel: activePaneModel,
    currentSessionPath: activePaneSessionPath,
    currentSessionName: activePaneSessionName,
    isGenerating: activePaneGenerating,
  } = activePaneStore()

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
  const [explorerOpen, setExplorerOpen] = useState(false)

  // Refs kept in sync with modal open state — used in keydown handler for gating
  const commandPaletteOpenRef = useRef(commandPaletteOpen)
  const settingsOpenRef = useRef(settingsOpen)
  const modelPickerOpenRef = useRef(modelPickerOpen)
  useEffect(() => { commandPaletteOpenRef.current = commandPaletteOpen }, [commandPaletteOpen])
  useEffect(() => { settingsOpenRef.current = settingsOpen }, [settingsOpen])
  useEffect(() => { modelPickerOpenRef.current = modelPickerOpen }, [modelPickerOpen])

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
  // Sync native window title with active pane's session name
  // -------------------------------------------------------------------------

  useEffect(() => {
    const title = activePaneSessionName ? activePaneSessionName : 'Lucent Chat'
    bridge.setWindowTitle(title).catch(() => {})
  }, [activePaneSessionName]) // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Pane split / close actions
  // -------------------------------------------------------------------------

  const handleSplitPane = useCallback(async (orientation: PaneOrientation = 'horizontal') => {
    const state = usePanesStore.getState()
    if (countLeaves(state.layout) >= 4) {
      toast.error('Maximum 4 panes allowed')
      return
    }
    if (state.splitPending) return
    usePanesStore.getState().setSplitPending(true)
    try {
      const { paneId: newPaneId } = await bridge.paneCreate()
      const inserted = usePanesStore.getState().splitPane(
        usePanesStore.getState().activePaneId,
        newPaneId,
        orientation,
      )
      if (!inserted) {
        await bridge.paneClose(newPaneId).catch(() => {})
        deletePaneStore(newPaneId)
      }
    } catch (err) {
      console.error('[pane] create failed:', err)
      toast.error('Failed to create pane')
    } finally {
      usePanesStore.getState().setSplitPending(false)
    }
  }, [bridge])

  const handleClosePane = useCallback(async (paneIdToClose: string) => {
    if (countLeaves(usePanesStore.getState().layout) <= 1) return
    try {
      await bridge.paneClose(paneIdToClose)
      usePanesStore.getState().removePane(paneIdToClose)
      deletePaneStore(paneIdToClose)
      deleteFileTreeStore(paneIdToClose)
    } catch (err) {
      console.error('[pane] close failed:', err)
    }
  }, [bridge])

  const handleNavigatePane = useCallback((direction: Direction) => {
    const currentActive = usePanesStore.getState().activePaneId
    const targetId = findPaneInDirection(currentActive, direction)
    if (targetId) {
      setActivePane(targetId)
      focusPane(targetId)
    }
  }, [setActivePane])

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
      const isModalOpen = commandPaletteOpenRef.current || settingsOpenRef.current || modelPickerOpenRef.current

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

      // Cmd+E — toggle explorer panel
      if (e.metaKey && !e.shiftKey && e.key === 'e') {
        e.preventDefault()
        setExplorerOpen((v) => !v)
        return
      }

      // Cmd+Shift+F — toggle file viewer panel
      if (e.metaKey && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        setFileViewerOpen((v) => !v)
        return
      }

      // Cmd+Shift+D — split pane vertically (must come before Cmd+D check)
      if (e.metaKey && e.shiftKey && e.code === 'KeyD') {
        if (!isModalOpen) {
          e.preventDefault()
          void handleSplitPane('vertical')
        }
        return
      }

      // Cmd+D — split pane horizontally
      if (e.metaKey && !e.shiftKey && e.code === 'KeyD') {
        if (!isModalOpen) {
          e.preventDefault()
          void handleSplitPane('horizontal')
        }
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
        const ids = collectLeafIds(usePanesStore.getState().layout)
        if (idx < ids.length) {
          e.preventDefault()
          setActivePane(ids[idx])
          focusPane(ids[idx])
          return
        }
      }

      // Cmd+Option+Arrow — spatial pane navigation
      if (e.metaKey && e.altKey) {
        if (!isModalOpen) {
          if (e.key === 'ArrowLeft')  { e.preventDefault(); handleNavigatePane('left');  return }
          if (e.key === 'ArrowRight') { e.preventDefault(); handleNavigatePane('right'); return }
          if (e.key === 'ArrowUp')    { e.preventDefault(); handleNavigatePane('up');    return }
          if (e.key === 'ArrowDown')  { e.preventDefault(); handleNavigatePane('down');  return }
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

  // Recursive layout tree renderer
  const chatPaneGroup = renderLayoutNode(layout, activePaneId, sidebarCollapsed, paneCount, setActivePane, handleClosePane)

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-screen flex-col bg-bg-primary text-text-primary select-none overflow-hidden">
      {/* Fixed top bar — spans full width */}
      <header
        className="flex h-11 flex-shrink-0 items-center border-b border-border bg-bg-secondary"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Traffic-light spacer + sidebar toggle */}
        <div className="flex items-center pl-20 pr-2 gap-1 flex-shrink-0">
          <button
            onClick={handleToggleSidebar}
            title={sidebarCollapsed ? 'Expand sidebar (⌘B)' : 'Collapse sidebar (⌘B)'}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            {sidebarCollapsed ? <PanelLeft className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
          </button>
        </div>

        <div className="flex-1" />

        {/* Agent health / status */}
        <div
          className="pr-4 text-xs text-text-tertiary capitalize flex-shrink-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {activePaneHealth === 'unknown' ? 'connecting' : activePaneHealth}
        </div>
      </header>

      {/* Vertical panel group: chat area on top, optional terminal at bottom */}
      <PanelGroup orientation="vertical" className="flex-1 min-h-0">
        {/* Top panel: unified sidebar | explorer | pane group | file viewer */}
        <Panel className="flex min-h-0">
          <div className="flex flex-1 min-h-0">
            {/* Collapsed sidebar — fixed icon strip outside PanelGroup */}
            {sidebarCollapsed && (
              <div className="flex-shrink-0">{sidebarEl}</div>
            )}

            {/* Unified horizontal PanelGroup */}
            <PanelGroup orientation="horizontal" className="flex-1 min-h-0 min-w-0">
              {/* Expanded sidebar inside PanelGroup */}
              {!sidebarCollapsed && (
                <>
                  <Panel defaultSize={22} minSize={15} maxSize={35} className="flex flex-col overflow-hidden">
                    {sidebarEl}
                  </Panel>
                  <PanelResizeHandle className="w-px bg-border hover:bg-accent/40 transition-colors cursor-col-resize" />
                </>
              )}

              {/* Explorer panel — Cmd+E */}
              {explorerOpen && (
                <>
                  <Panel defaultSize={18} minSize={12} maxSize={35} className="flex flex-col overflow-hidden border-r border-border">
                    <FileTree paneId={activePaneId} onFileOpen={() => setFileViewerOpen(true)} />
                  </Panel>
                  <PanelResizeHandle className="w-px bg-border hover:bg-accent/40 transition-colors cursor-col-resize" />
                </>
              )}

              {/* Chat panes */}
              <Panel className="flex flex-col min-h-0 min-w-0">
                {chatPaneGroup}
              </Panel>

              {/* FileViewer — Cmd+Shift+F or opened from file tree */}
              {fileViewerOpen && (
                <>
                  <PanelResizeHandle className="w-px bg-border hover:bg-accent/40 transition-colors cursor-col-resize" />
                  <Panel defaultSize={30} minSize={20} maxSize={50} className="flex flex-col min-h-0">
                    <FileViewer paneId={activePaneId} onClose={() => setFileViewerOpen(false)} />
                  </Panel>
                </>
              )}
            </PanelGroup>
          </div>
        </Panel>

        {/* Terminal panel — toggled with Cmd+` */}
        {terminalOpen && (
          <>
            <PanelResizeHandle className="h-px bg-accent/40 hover:bg-accent transition-colors cursor-row-resize" />
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
        fileViewerOpen={fileViewerOpen}
        onToggleFileViewer={() => setFileViewerOpen((v) => !v)}
        onOpenModelPicker={() => setModelPickerOpen(true)}
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
        onSplitPane={() => void handleSplitPane('horizontal')}
        onSplitPaneVertical={() => void handleSplitPane('vertical')}
        onNavigatePane={(dir) => handleNavigatePane(dir)}
        onClosePane={paneCount > 1 ? () => void handleClosePane(activePaneId) : undefined}
        isGenerating={activePaneGenerating}
        canSplit={paneCount < 4}
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
