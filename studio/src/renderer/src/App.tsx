/**
 * App — top-level layout with sidebar + multi-pane chat area.
 *
 * Phase 4C+IDE: Supports up to 4 independent chat panes side by side.
 * Each pane has its own agent process, bridge, orchestrator, and session.
 *
 * Layout: sidebar | PanelGroup of ChatPane | FileViewer (opt)
 * Keyboard shortcuts:
 *   Cmd+D       → split pane horizontally (max 4)
 *   Cmd+Shift+D → split pane vertically
 *   Cmd+W       → close active pane (if > 1)
 *   Cmd+1-4     → focus pane 1-4
 *   Cmd+E       → toggle explorer in sidebar
 *   Cmd+Shift+F → toggle file viewer
 *   Voice PTT   → configurable in Settings (default: hold Space)
 */

import { useEffect, useCallback, useState, useRef, type ReactNode } from 'react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { toast, Toaster } from 'sonner'
import { usePanesStore, getPaneStore, deletePaneStore, collectLeafIds, countLeaves, type LayoutNode, type PaneOrientation } from './store/pane-store'
import { getFileTreeStore, deleteFileTreeStore } from './store/file-tree-store'
import { findPaneInDirection, focusPane, type Direction } from './lib/pane-refs'
import { getBridge } from './lib/bridge'
import { ChatPane } from './components/ChatPane'
import { Sidebar, type SidebarView } from './components/Sidebar'
import { VoiceDownloadBanner } from './components/VoiceDownloadBanner'
import { ModelPicker } from './components/ModelPicker'
import { useVoiceStore } from './store/voice-store'
import { CommandPalette } from './components/CommandPalette'
import { Settings } from './components/Settings'
import { Onboarding } from './components/Onboarding'
import { Terminal } from './components/Terminal'
import { FileViewer } from './components/FileViewer'
import { formatModelDisplay, getModelRefFromState } from './lib/models'

const MIN_FILE_VIEWER_WIDTH = 360
const MAX_FILE_VIEWER_WIDTH = 840
const MIN_CHAT_AREA_WIDTH = 420
const COLLAPSED_SIDEBAR_WIDTH = 40
const EXPANDED_SIDEBAR_WIDTH = 280

function getMaxFileViewerWidth(viewportWidth: number, paneCount: number, sidebarCollapsed: boolean): number {
  const sidebarWidth = sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : EXPANDED_SIDEBAR_WIDTH
  return Math.min(
    MAX_FILE_VIEWER_WIDTH,
    viewportWidth - sidebarWidth - paneCount * MIN_CHAT_AREA_WIDTH,
  )
}

function clampFileViewerWidth(
  viewportWidth: number,
  requestedWidth: number,
  paneCount: number,
  sidebarCollapsed: boolean,
): number {
  const maxAllowedWidth = Math.min(
    MAX_FILE_VIEWER_WIDTH,
    Math.max(MIN_FILE_VIEWER_WIDTH, getMaxFileViewerWidth(viewportWidth, paneCount, sidebarCollapsed)),
  )
  return Math.min(Math.max(requestedWidth, MIN_FILE_VIEWER_WIDTH), maxAllowedWidth)
}

// ============================================================================
// Layout tree renderer (module-level to avoid re-creation on each render)
// ============================================================================

function renderLayoutNode(
  node: LayoutNode,
  activePaneId: string,
  sidebarCollapsed: boolean,
  paneCount: number,
  voicePttShortcut: 'space' | 'alt+space' | 'cmd+shift+space',
  setActivePane: (id: string) => void,
  handleClosePane: (id: string) => Promise<void>,
  handleOpenFile: (paneId: string, relativePath: string) => Promise<void>,
): ReactNode {
  if (node.type === 'leaf') {
    return (
      <ChatPane
        key={node.paneId}
        paneId={node.paneId}
        isActive={node.paneId === activePaneId}
        sidebarCollapsed={sidebarCollapsed && paneCount === 1}
        voicePttShortcut={voicePttShortcut}
        onFocus={() => setActivePane(node.paneId)}
        onClose={paneCount > 1 ? () => void handleClosePane(node.paneId) : undefined}
        onOpenFile={handleOpenFile}
      />
    )
  }
  const isHorizontal = node.orientation === 'horizontal'
  const minSize = isHorizontal ? 15 : 25
  const handleClass = isHorizontal
    ? 'w-px bg-accent/40 hover:bg-accent transition-colors cursor-col-resize'
    : 'h-px bg-accent/40 hover:bg-accent transition-colors cursor-row-resize'
  return (
    <PanelGroup key={node.id} orientation={node.orientation} className="flex-1 min-h-0 min-w-0">
      <Panel key={`${node.id}-0`} minSize={minSize} className="flex flex-col min-h-0 min-w-0">
        {renderLayoutNode(node.children[0], activePaneId, sidebarCollapsed, paneCount, voicePttShortcut, setActivePane, handleClosePane, handleOpenFile)}
      </Panel>
      <PanelResizeHandle className={handleClass} />
      <Panel key={`${node.id}-1`} minSize={minSize} className="flex flex-col min-h-0 min-w-0">
        {renderLayoutNode(node.children[1], activePaneId, sidebarCollapsed, paneCount, voicePttShortcut, setActivePane, handleClosePane, handleOpenFile)}
      </Panel>
    </PanelGroup>
  )
}

// ============================================================================
// App
// ============================================================================

export default function App() {
  const bridge = getBridge()

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

  // Voice store (global, not per-pane) — select only needed state to avoid re-renders
  const voiceSidecarState = useVoiceStore((s) => s.sidecarState)
  const voiceError = useVoiceStore((s) => s.error)

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
  const [fileViewerWidth, setFileViewerWidth] = useState(440)
  const [sidebarView, setSidebarView] = useState<SidebarView>('sessions')
  const [voicePttShortcut, setVoicePttShortcut] = useState<'space' | 'alt+space' | 'cmd+shift+space'>('space')
  const [voiceModelsDownloaded, setVoiceModelsDownloaded] = useState(false)

  // Refs kept in sync with modal open state — used in keydown handler for gating
  const commandPaletteOpenRef = useRef(commandPaletteOpen)
  const settingsOpenRef = useRef(settingsOpen)
  const modelPickerOpenRef = useRef(modelPickerOpen)
  const sidebarCollapsedRef = useRef(sidebarCollapsed)
  const sidebarViewRef = useRef(sidebarView)
  useEffect(() => { commandPaletteOpenRef.current = commandPaletteOpen }, [commandPaletteOpen])
  useEffect(() => { settingsOpenRef.current = settingsOpen }, [settingsOpen])
  useEffect(() => { modelPickerOpenRef.current = modelPickerOpen }, [modelPickerOpen])
  useEffect(() => { sidebarCollapsedRef.current = sidebarCollapsed }, [sidebarCollapsed])
  useEffect(() => { sidebarViewRef.current = sidebarView }, [sidebarView])

  // -------------------------------------------------------------------------
  // Load persisted settings on mount
  // -------------------------------------------------------------------------

  useEffect(() => {
    bridge
      .getSettings()
      .then((s) => {
        // Default to collapsed — only expand if explicitly set to false
        if (s.sidebarCollapsed === false) {
          setSidebarCollapsed(false)
        }
        if (s.voicePttShortcut === 'space' || s.voicePttShortcut === 'alt+space' || s.voicePttShortcut === 'cmd+shift+space') {
          setVoicePttShortcut(s.voicePttShortcut)
        }
        if (s.voiceModelsDownloaded === true) {
          setVoiceModelsDownloaded(true)
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
  // Mark voice models as downloaded once voice service reaches ready state
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!settingsLoaded) return
    if (voiceSidecarState === 'ready' && !voiceModelsDownloaded) {
      setVoiceModelsDownloaded(true)
      bridge.setSettings({ voiceModelsDownloaded: true }).catch(() => {})
    }
  }, [voiceSidecarState, voiceModelsDownloaded, settingsLoaded, bridge])

  useEffect(() => {
    const handleWindowResize = () => {
      setFileViewerWidth((currentWidth) => clampFileViewerWidth(window.innerWidth, currentWidth, paneCount, sidebarCollapsed))
    }
    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [paneCount, sidebarCollapsed])

  useEffect(() => {
    if (!fileViewerOpen) return

    const maxViewerWidth = getMaxFileViewerWidth(window.innerWidth, paneCount, sidebarCollapsed)

    if (maxViewerWidth < MIN_FILE_VIEWER_WIDTH) {
      setFileViewerOpen(false)
      return
    }

    setFileViewerWidth((currentWidth) => Math.min(currentWidth, maxViewerWidth))
  }, [fileViewerOpen, paneCount, sidebarCollapsed])

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

  const handleToggleExplorer = useCallback(() => {
    if (sidebarCollapsedRef.current) {
      setSidebarCollapsed(false)
      setSidebarView('explorer')
      return
    }
    setSidebarView(sidebarViewRef.current === 'explorer' ? 'sessions' : 'explorer')
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

  const openFileViewer = useCallback(() => {
    const sidebarWidth = sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : EXPANDED_SIDEBAR_WIDTH
    const maxViewerWidth = getMaxFileViewerWidth(window.innerWidth, paneCount, sidebarCollapsed)
    if (maxViewerWidth < MIN_FILE_VIEWER_WIDTH) {
      toast.error('Not enough space to open the file viewer with the current pane layout.')
      return
    }

    const desiredWidth = Math.round((window.innerWidth - sidebarWidth) / 2)
    setFileViewerWidth(clampFileViewerWidth(window.innerWidth, desiredWidth, paneCount, sidebarCollapsed))
    setFileViewerOpen(true)
  }, [paneCount, sidebarCollapsed])

  const toggleFileViewer = useCallback(() => {
    if (fileViewerOpen) {
      setFileViewerOpen(false)
      return
    }
    openFileViewer()
  }, [fileViewerOpen, openFileViewer])

  // -------------------------------------------------------------------------
  // File open action (used by CommandPalette recent files)
  // -------------------------------------------------------------------------

  const handleOpenFile = useCallback(async (paneId: string, relativePath: string) => {
    try {
      const result = await bridge.fsReadFile(paneId, relativePath)
      getPaneStore(paneId).getState().openFile({
        relativePath,
        content: result.content,
        source: 'user',
        truncated: result.truncated,
        isBinary: result.isBinary,
      })
      openFileViewer()
    } catch (err) {
      console.error('[openFile]', err)
    }
  }, [bridge, openFileViewer])

  const handleOpenDiff = useCallback(async (paneId: string, relativePath: string) => {
    try {
      const diff = await bridge.gitFileDiff(paneId, relativePath)
      if (!diff) {
        toast.error(`No diff available for ${relativePath}`)
        return
      }

      getPaneStore(paneId).getState().openDiff({
        relativePath: diff.path,
        diffText: diff.diffText,
        status: diff.status,
        previousPath: diff.previousPath,
        isBinary: diff.isBinary,
      })
      openFileViewer()
    } catch (err) {
      console.error('[openDiff]', err)
      toast.error(err instanceof Error ? err.message : 'Failed to load diff')
    }
  }, [bridge, openFileViewer])

  useEffect(() => {
    const pendingReloads = new Map<string, number>()

    const unsubscribe = bridge.onFileChanged(({ paneId, changes }) => {
      const existingTimeout = pendingReloads.get(paneId)
      if (existingTimeout) {
        window.clearTimeout(existingTimeout)
      }

      const timeoutId = window.setTimeout(() => {
        pendingReloads.delete(paneId)

        const treeStore = getFileTreeStore(paneId)
        void treeStore.getState().refreshVisibleDirs()
        void treeStore.getState().refreshModifiedFiles()

        const paneStore = getPaneStore(paneId)
        const openTabs = paneStore.getState().openFiles
        const changedPaths = changes
          .map((change) => change.relativePath)
          .filter((path): path is string => typeof path === 'string' && path.length > 0)

        const affectedOpenTabs = changedPaths.length === 0
          ? openTabs
          : openTabs.filter((openTab) =>
              changedPaths.some((changedPath) =>
                openTab.relativePath === changedPath || openTab.relativePath.startsWith(`${changedPath}/`),
              ),
            )

        void Promise.allSettled(
          affectedOpenTabs.map(async (openTab) => {
            try {
              if (openTab.kind === 'diff') {
                const diff = await bridge.gitFileDiff(paneId, openTab.relativePath)
                if (!diff) {
                  paneStore.getState().closeFile(openTab.tabKey)
                  return
                }
                paneStore.getState().openDiff({
                  relativePath: diff.path,
                  diffText: diff.diffText,
                  status: diff.status,
                  previousPath: diff.previousPath,
                  isBinary: diff.isBinary,
                })
                return
              }

              const result = await bridge.fsReadFile(paneId, openTab.relativePath)
              paneStore.getState().openFile({
                relativePath: openTab.relativePath,
                content: result.content,
                source: 'user',
                truncated: result.truncated,
                isBinary: result.isBinary,
              })
            } catch {
              paneStore.getState().closeFile(openTab.tabKey)
            }
          }),
        )
      }, 140)

      pendingReloads.set(paneId, timeoutId)
    })

    return () => {
      for (const timeoutId of pendingReloads.values()) {
        window.clearTimeout(timeoutId)
      }
      unsubscribe()
    }
  }, [bridge])

  const handleFileViewerResizeStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()

    const handlePointerMove = (moveEvent: MouseEvent) => {
      const nextWidth = clampFileViewerWidth(window.innerWidth, window.innerWidth - moveEvent.clientX, paneCount, sidebarCollapsed)
      setFileViewerWidth(nextWidth)
    }

    const handlePointerUp = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', handlePointerUp)
  }, [paneCount, sidebarCollapsed])

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

      // Cmd+E — toggle explorer within the sidebar
      if (e.metaKey && !e.shiftKey && e.key === 'e') {
        e.preventDefault()
        handleToggleExplorer()
        return
      }

      // Cmd+Shift+F — toggle file viewer panel
      if (e.metaKey && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        toggleFileViewer()
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

      // Escape — close command palette first; otherwise stop the active pane
      if (e.key === 'Escape') {
        if (commandPaletteOpenRef.current) {
          e.preventDefault()
          setCommandPaletteOpen(false)
          return
        }
        if (!isModalOpen) {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('lucent:stop-active-pane', {
            detail: { paneId: usePanesStore.getState().activePaneId },
          }))
        }
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
      view={sidebarView}
      onViewChange={setSidebarView}
      onNewSession={() => void handleNewSession()}
      onSwitchSession={(path) => void handleSwitchSession(path)}
      onRefresh={handleRefresh}
      onOpenModelPicker={() => setModelPickerOpen(true)}
      onOpenSettings={() => setSettingsOpen(true)}
      onExplorerFileOpen={openFileViewer}
      onOpenDiff={handleOpenDiff}
    />
  )

  // Recursive layout tree renderer
  const chatPaneGroup = renderLayoutNode(layout, activePaneId, sidebarCollapsed, paneCount, voicePttShortcut, setActivePane, handleClosePane, handleOpenFile)

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-screen flex-col bg-bg-primary text-text-primary select-none overflow-hidden">
      {/* Fixed top bar — spans full width */}
      <header
        className="flex h-9 flex-shrink-0 items-center border-b border-border bg-bg-secondary"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Spacer for traffic lights (always) + collapsed sidebar (when collapsed) */}
        <div className={sidebarCollapsed ? 'pl-32 flex-shrink-0' : 'pl-20 flex-shrink-0'} />

        {/* App name */}
        <div className="flex-1 text-sm font-semibold text-text-secondary">
          Lucent Chat
        </div>

        {/* Agent health / status */}
        <div
          className="pr-4 text-xs text-text-tertiary capitalize flex-shrink-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {activePaneHealth === 'unknown' ? 'connecting' : activePaneHealth}
        </div>
      </header>

      {/* Voice download banner — only shows on first startup when models need downloading */}
      <VoiceDownloadBanner
        show={!voiceModelsDownloaded && (voiceSidecarState === 'starting' || voiceSidecarState === 'error')}
        state={voiceSidecarState}
        error={voiceError}
      />

      {/* Vertical panel group: chat area on top, optional terminal at bottom */}
      <PanelGroup orientation="vertical" className="flex-1 min-h-0">
        {/* Top panel: sidebar | pane group | file viewer */}
        <Panel className="flex min-h-0">
          <div className="flex flex-1 min-h-0">
            {/* Fixed-width sidebar */}
            <div className={sidebarCollapsed ? 'w-10 flex-shrink-0' : 'w-72 min-w-[280px] max-w-[320px] flex-shrink-0'}>
              {sidebarEl}
            </div>

            {/* Unified horizontal PanelGroup */}
            <div className="flex flex-1 min-h-0 min-w-0">
              <div className="flex flex-1 min-h-0 min-w-0">
                {chatPaneGroup}
              </div>

              {fileViewerOpen && (
                <>
                  <div
                    role="separator"
                    aria-label="Resize file viewer"
                    aria-orientation="vertical"
                    onMouseDown={handleFileViewerResizeStart}
                    className="group flex w-2 flex-shrink-0 cursor-col-resize items-stretch justify-center bg-transparent"
                  >
                    <div className="w-px bg-border transition-colors group-hover:bg-accent/50" />
                  </div>
                  <div
                    className="flex min-h-0 flex-shrink-0 border-l border-border bg-bg-secondary"
                    style={{ width: `${fileViewerWidth}px` }}
                  >
                    <FileViewer paneId={activePaneId} onClose={() => setFileViewerOpen(false)} />
                  </div>
                </>
              )}
            </div>
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
        onOpenFile={handleOpenFile}
        isGenerating={activePaneGenerating}
        canSplit={paneCount < 4}
      />

      {/* Settings dialog — Cmd+, */}
      <Settings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        voicePttShortcut={voicePttShortcut}
        onVoicePttShortcutChange={setVoicePttShortcut}
      />

      {/* First-run onboarding overlay */}
      {showOnboarding && (
        <Onboarding onComplete={() => setShowOnboarding(false)} />
      )}

      {/* Toast notifications — bottom-right, dark theme */}
      <Toaster position="bottom-right" theme="dark" richColors />
    </div>
  )
}
