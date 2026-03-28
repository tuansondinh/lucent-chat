/**
 * Sidebar — session list, new session button, and bottom controls.
 *
 * Shows a scrollable list of past sessions with relative timestamps.
 * Supports rename (dialog) and delete (confirmation dialog) via right-click context menu.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Plus,
  Settings,
  PanelLeft,
  PanelLeftClose,
  FolderOpen,
  GitBranch,
  MoreHorizontal,
  Pencil,
  Trash2,
  MessageSquare,
  Cpu,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { getPaneStore } from '../store/pane-store'
import { getFileTreeStore } from '../store/file-tree-store'
import { getBridge } from '../lib/bridge'
import { FileTree } from './FileTree'
import { ScrollArea } from './ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { cn } from '../lib/utils'
import { btn, chrome } from '../lib/theme'
import { relativeTime } from '../lib/time'
import { formatModelDisplay } from '../lib/models'
import type { GitChangeStatus } from '../../../preload'

// ============================================================================
// Types
// ============================================================================

export interface Session {
  path: string
  name: string
  modified: number
}

export type SidebarView = 'sessions' | 'explorer' | 'changes'

interface Props {
  collapsed: boolean
  onToggleCollapse: () => void
  currentSessionPath: string | null
  /** The pane whose sessions this sidebar manages. */
  activePaneId: string
  view: SidebarView
  onViewChange: (view: SidebarView) => void
  onNewSession: () => Promise<void> | void
  onSwitchSession: (path: string) => void
  onRefresh: () => void
  isCompacting?: boolean
  autoCompactionEnabled?: boolean
  voiceAudioEnabled: boolean
  onVoiceAudioEnabledChange: (enabled: boolean) => void
  onOpenModelPicker?: () => void
  onOpenSettings?: () => void
  onExplorerFileOpen?: () => void
  onOpenDiff?: (paneId: string, relativePath: string) => Promise<void>
}

// ============================================================================
// Sidebar
// ============================================================================

export function Sidebar({
  collapsed,
  onToggleCollapse,
  currentSessionPath,
  activePaneId,
  view,
  onViewChange,
  onNewSession,
  onSwitchSession,
  onRefresh,
  isCompacting = false,
  autoCompactionEnabled = true,
  voiceAudioEnabled,
  onVoiceAudioEnabledChange,
  onOpenModelPicker,
  onOpenSettings,
  onExplorerFileOpen,
  onOpenDiff,
}: Props) {
  const { currentModel } = getPaneStore(activePaneId)()
  const changedFiles = getFileTreeStore(activePaneId)((s) => s.changedFiles)
  const [sessions, setSessions] = useState<Session[]>([])
  const bridge = getBridge()

  // -- Rename dialog state
  const [renameTarget, setRenameTarget] = useState<Session | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // -- Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // -------------------------------------------------------------------------
  // Load sessions
  // -------------------------------------------------------------------------

  const loadSessions = useCallback(async () => {
    try {
      const list = await bridge.getSessions(activePaneId)
      setSessions(list)
    } catch {
      // silently ignore
    }
  }, [bridge, activePaneId])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions, currentSessionPath])

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const handleNewSession = async () => {
    await onNewSession()
    await loadSessions()
  }

  const handleSwitchSession = async (path: string) => {
    if (path === currentSessionPath) return
    const result = await bridge.switchSession(activePaneId, path)
    if (!result.cancelled) {
      await loadSessions()
      onSwitchSession(path)
    }
  }

  const handleRenameOpen = (session: Session) => {
    setRenameTarget(session)
    setRenameValue(session.name)
  }

  const handleRenameConfirm = async () => {
    if (!renameTarget || !renameValue.trim()) return
    try {
      // Switch to the session first if it's not current, then rename
      if (renameTarget.path !== currentSessionPath) {
        await bridge.switchSession(activePaneId, renameTarget.path)
      }
      await bridge.renameSession(activePaneId, renameValue.trim())
      await loadSessions()
      onRefresh()
    } catch {
      // ignore
    } finally {
      setRenameTarget(null)
      setRenameValue('')
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeleteError(null)
    try {
      await bridge.deleteSession(activePaneId, deleteTarget.path)
      setDeleteTarget(null)
      await loadSessions()
      onRefresh()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete session')
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (collapsed) {
    return (
      <div className={`flex h-full w-10 flex-shrink-0 flex-col overflow-hidden border-r border-border ${chrome.bar}`}>
        <div className="flex flex-1 flex-col items-center gap-1.5 px-1 py-2">
          <button
            onClick={onToggleCollapse}
            title="Expand sidebar (⌘B)"
            className={cn(btn.icon, 'w-7 h-7')}
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => void handleNewSession()}
            title="New session"
            className={cn(btn.icon, 'w-7 h-7')}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => {
              onViewChange('explorer')
              onToggleCollapse()
            }}
            title="Open explorer (⌘E)"
            className={cn(btn.icon, 'w-7 h-7')}
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => {
              onViewChange('changes')
              onToggleCollapse()
            }}
            title="Open changes"
            className={cn(btn.icon, 'w-7 h-7')}
          >
            <GitBranch className="w-3.5 h-3.5" />
          </button>

          <div className="flex-1" />

          {isCompacting && (
            <div
              title="Compacting conversation context"
              className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500/15 text-amber-300"
            >
              <span className="text-[9px] font-semibold">CMP</span>
            </div>
          )}

          <button
            onClick={() => onVoiceAudioEnabledChange(!voiceAudioEnabled)}
            title={voiceAudioEnabled ? 'Turn speech audio off' : 'Turn speech audio on'}
            className={cn(
              'flex items-center justify-center w-7 h-7 rounded-lg transition-colors',
              voiceAudioEnabled
                ? 'bg-accent/15 text-accent hover:bg-accent/25'
                : 'text-text-tertiary hover:text-accent hover:bg-accent/10 active:bg-accent/20',
            )}
          >
            {voiceAudioEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={onOpenSettings}
            title="Settings (⌘,)"
            className={cn(btn.icon, 'w-7 h-7')}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className={`flex flex-col h-full w-full min-w-0 border-r border-border ${chrome.bar} overflow-hidden`}>
        {/* Header actions */}
        <div className="px-3 py-2 flex-shrink-0 flex items-center gap-2">
          <button
            onClick={onToggleCollapse}
            title="Collapse sidebar (⌘B)"
            className={cn(btn.icon, 'w-8 h-8 flex-shrink-0')}
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>

          <button
            onClick={() => void handleNewSession()}
            className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-accent hover:bg-accent/10 border border-border hover:border-accent/40 transition-colors min-w-0"
          >
            <Plus className="w-4 h-4 flex-shrink-0" />
            <span>New Session</span>
          </button>
        </div>

        <div className="px-3 pb-2 flex-shrink-0">
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-bg-tertiary/70 p-1">
            <button
              onClick={() => onViewChange('sessions')}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors',
                view === 'sessions'
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-tertiary hover:text-text-secondary',
              )}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Sessions</span>
            </button>
            <button
              onClick={() => onViewChange('explorer')}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors',
                view === 'explorer'
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-tertiary hover:text-text-secondary',
              )}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>Explorer</span>
            </button>
            <button
              onClick={() => onViewChange('changes')}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors',
                view === 'changes'
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-tertiary hover:text-text-secondary',
              )}
            >
              <GitBranch className="h-3.5 w-3.5" />
              <span>Changes</span>
            </button>
          </div>
        </div>

        {view === 'sessions' ? (
          <ScrollArea className="flex-1 px-2">
            <div className="flex flex-col gap-0.5 pb-2">
              {sessions.length === 0 && (
                <p className="text-xs text-text-tertiary px-2 py-4 text-center">
                  No saved sessions
                </p>
              )}
              {sessions.map((session) => {
                const isActive = session.path === currentSessionPath
                return (
                  <SessionItem
                    key={session.path}
                    session={session}
                    isActive={isActive}
                    onSelect={() => void handleSwitchSession(session.path)}
                    onRename={() => handleRenameOpen(session)}
                    onDelete={() => setDeleteTarget(session)}
                  />
                )
              })}
            </div>
          </ScrollArea>
        ) : view === 'explorer' ? (
          <div className="flex-1 min-h-0 px-2 pb-2">
            <div className="h-full overflow-hidden rounded-lg border border-border/60 bg-bg-primary/30">
              <FileTree
                paneId={activePaneId}
                onFileOpen={onExplorerFileOpen}
                embedded
              />
            </div>
          </div>
        ) : (
          <ScrollArea className="flex-1 px-2">
            <div className="flex flex-col gap-1 pb-2">
              {changedFiles.length === 0 ? (
                <p className="text-xs text-text-tertiary px-2 py-4 text-center">
                  No local changes
                </p>
              ) : (
                changedFiles.map((file) => (
                  <button
                    key={`${file.path}:${file.status}`}
                    onClick={() => { void onOpenDiff?.(activePaneId, file.path) }}
                    className={cn(btn.ghost, 'flex items-center gap-2 rounded-lg px-2 py-2 text-left')}
                    title={file.path}
                  >
                    <span className={cn(
                      'inline-flex min-w-7 items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold',
                      getChangeBadgeClass(file.status),
                    )}
                    >
                      {file.status}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{file.path}</div>
                      {file.previousPath && (
                        <div className="truncate text-[10px] text-text-tertiary">
                          from {file.previousPath}
                        </div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        )}

        {/* Bottom area */}
        <div className="flex-shrink-0 border-t border-border px-3 py-2 flex items-center gap-2">
          {(isCompacting || autoCompactionEnabled) && (
            <div className="px-1 text-[10px] text-text-tertiary truncate flex-1">
              {isCompacting ? 'Compacting context...' : 'Auto-compact on'}
            </div>
          )}

          <button
            onClick={() => onVoiceAudioEnabledChange(!voiceAudioEnabled)}
            title={voiceAudioEnabled ? 'Turn speech audio off' : 'Turn speech audio on'}
            className={cn(
              'flex items-center justify-center w-7 h-7 rounded-lg border transition-colors flex-shrink-0',
              voiceAudioEnabled
                ? 'border-accent/40 bg-accent/15 text-accent hover:bg-accent/25'
                : 'border-border text-text-tertiary hover:text-accent hover:bg-accent/10 hover:border-accent/40 active:bg-accent/20',
            )}
          >
            {voiceAudioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <button
            onClick={onOpenSettings}
            title="Settings (⌘,)"
            className={cn(btn.icon, 'w-7 h-7 flex-shrink-0')}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename Session</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleRenameConfirm()
              if (e.key === 'Escape') setRenameTarget(null)
            }}
            placeholder="Session name"
            autoFocus
          />
          <DialogFooter>
            <button
              onClick={() => setRenameTarget(null)}
              className={cn(btn.outline, 'px-3 py-1.5 text-sm')}
            >
              Cancel
            </button>
            <button
              onClick={() => void handleRenameConfirm()}
              disabled={!renameValue.trim()}
              className={cn(btn.primary, 'px-3 py-1.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed')}
            >
              Rename
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteError(null) } }}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Delete Session</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-secondary">
            Are you sure you want to delete{' '}
            <span className="font-medium text-text-primary">
              &ldquo;{deleteTarget?.name}&rdquo;
            </span>
            ? This cannot be undone.
          </p>
          {deleteError && (
            <p className="text-xs text-red-400 bg-red-900/20 rounded px-3 py-2">{deleteError}</p>
          )}
          <DialogFooter>
            <button
              onClick={() => { setDeleteTarget(null); setDeleteError(null) }}
              className={cn(btn.outline, 'px-3 py-1.5 text-sm')}
            >
              Cancel
            </button>
            <button
              onClick={() => void handleDeleteConfirm()}
              className={cn(btn.danger, 'px-3 py-1.5 text-sm')}
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function getChangeBadgeClass(status: GitChangeStatus): string {
  switch (status) {
    case 'A':
    case '??':
      return 'bg-emerald-500/15 text-emerald-300'
    case 'D':
      return 'bg-red-500/15 text-red-300'
    case 'R':
      return 'bg-sky-500/15 text-sky-300'
    case 'U':
      return 'bg-amber-400/15 text-amber-200'
    default:
      return 'bg-amber-500/15 text-amber-300'
  }
}

// ============================================================================
// SessionItem
// ============================================================================

interface SessionItemProps {
  session: Session
  isActive: boolean
  onSelect: () => void
  onRename: () => void
  onDelete: () => void
}

function SessionItem({ session, isActive, onSelect, onRename, onDelete }: SessionItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div
      className={cn(
        'group relative flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors',
        isActive
          ? 'bg-accent/15 border-l-2 border-accent text-text-primary pl-[6px]'
          : 'text-text-secondary hover:bg-accent/10 hover:text-accent active:bg-accent/20',
      )}
      onClick={onSelect}
    >
      <MessageSquare
        className={cn('w-3.5 h-3.5 flex-shrink-0', isActive ? 'text-accent' : 'text-text-tertiary')}
      />

      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate leading-tight">{session.name}</p>
        <p className="text-[10px] text-text-tertiary leading-tight mt-0.5">
          {relativeTime(session.modified)}
        </p>
      </div>

      {/* Context menu trigger — visible on hover or when menu is open */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            onClick={(e) => e.stopPropagation()}
            className={cn(
              cn(btn.icon, 'w-5 h-5 flex-shrink-0'),
              menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="right" sideOffset={4}>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              onRename()
            }}
          >
            <Pencil className="w-3.5 h-3.5" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
