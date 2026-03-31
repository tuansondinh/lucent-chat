/**
 * Sidebar — session list, new session button, and bottom controls.
 *
 * Shows a scrollable list of past sessions with relative timestamps.
 * Supports rename (dialog) and delete (confirmation dialog) via right-click context menu.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plus,
  Settings,
  PanelLeft,
  PanelLeftClose,
  FolderOpen,
  GitBranch,
  Pencil,
  Trash2,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Cpu,

} from 'lucide-react'
import { getPaneStore } from '../store/pane-store'
import { getFileTreeStore } from '../store/file-tree-store'
import { getBridge } from '../lib/bridge'
import { FileTree } from './FileTree'
import { ScrollArea } from './ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  project?: {
    projectRoot: string
    sessionPath: string
    sessionName?: string
    firstPrompt?: string
  } | null
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
  /** When generation transitions from true → false, reload sessions to pick up auto-named sessions. */
  isGenerating?: boolean
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
  isGenerating = false,
  onOpenModelPicker,
  onOpenSettings,
  onExplorerFileOpen,
  onOpenDiff,
}: Props) {
  const { currentModel, currentSessionName } = getPaneStore(activePaneId)()
  const changedFiles = getFileTreeStore(activePaneId)((s) => s.changedFiles)
  const [sessions, setSessions] = useState<Session[]>([])
  const bridge = getBridge()
  const prevIsGeneratingRef = useRef(false)
  const groupedSessions = groupSessionsByProject(sessions)

  // Ensure the group containing the current session is expanded
  const prevSessionPathRef = useRef(currentSessionPath)
  useEffect(() => {
    if (currentSessionPath && currentSessionPath !== prevSessionPathRef.current) {
      const group = groupedSessions.find((g) => g.sessions.some((s) => s.path === currentSessionPath))
      if (group) {
        setCollapsedGroups((prev) => ({ ...prev, [group.key]: false }))
      }
    }
    prevSessionPathRef.current = currentSessionPath
  }, [currentSessionPath, groupedSessions])

  // -- Rename dialog state
  const [renameTarget, setRenameTarget] = useState<Session | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // -- Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // -- Collapsed groups state
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  // -------------------------------------------------------------------------
  // Load sessions
  // -------------------------------------------------------------------------

  const loadSessions = useCallback(async () => {
    try {
      const list = await bridge.getSessions(activePaneId)
      const normalized = Array.isArray(list)
        ? list.map((session) => {
            const fallbackName = session.project?.sessionName
              || session.project?.firstPrompt
              || (session.path ? session.path.split(/[\\/]/).pop()?.replace(/\.jsonl$/, '') : '')
              || 'New session'

            return {
              ...session,
              name: typeof session.name === 'string' && session.name.trim().length > 0
                ? session.name
                : fallbackName,
            }
          })
        : []
      setSessions(normalized)
    } catch {
      // silently ignore
    }
  }, [bridge, activePaneId])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions, currentSessionPath, currentSessionName])

  // Reload sessions when generation ends — the agent may have just auto-named
  // the session (first prompt), and the sidebar needs to pick up the new name.
  useEffect(() => {
    const wasGenerating = prevIsGeneratingRef.current
    prevIsGeneratingRef.current = isGenerating
    if (wasGenerating && !isGenerating) {
      // Small delay to allow the agent to flush the session name to disk
      const timer = setTimeout(() => {
        void loadSessions()
      }, 400)
      return () => clearTimeout(timer)
    }
  }, [isGenerating, loadSessions])

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const handleNewSession = async () => {
    await onNewSession()
    await loadSessions()
  }

  const handleSwitchSession = async (path: string) => {
    if (path === currentSessionPath) return
    try {
      await onSwitchSession(path)
      await loadSessions()
    } catch {
      // ignore
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

  const handleDeleteImmediate = async (path: string) => {
    try {
      await bridge.deleteSession(activePaneId, path)
      await loadSessions()
      onRefresh()
    } catch {
      // silently ignore
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (collapsed) {
    return (
      <div className={`flex h-full w-10 flex-shrink-0 flex-col overflow-hidden ${chrome.bar}`}>
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
      <div className={`flex flex-col h-full w-full min-w-0 ${chrome.bar} overflow-hidden border-r border-border`}>
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
          <div className="flex-1 min-h-0 px-2 pb-2">
            <div className="h-full overflow-hidden rounded-lg border border-border/60 bg-bg-primary/30">
              <ScrollArea className="h-full">
                <div className="flex flex-col gap-0.5 p-1.5">
                  {sessions.length === 0 && (
                    <p className="text-xs text-text-tertiary px-2 py-4 text-center">
                      No saved sessions
                    </p>
                  )}
                  {groupedSessions.map((group) => {
                    const isCollapsed = collapsedGroups[group.key]
                    return (
                      <div key={group.key} className="pt-2 first:pt-0">
                        <button
                          onClick={() => toggleGroup(group.key)}
                          className="group/header flex w-full items-center gap-1.5 px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-text-tertiary transition-colors hover:text-text-secondary"
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-3 w-3 flex-shrink-0 opacity-60 group-hover/header:opacity-100" />
                          ) : (
                            <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-60 group-hover/header:opacity-100" />
                          )}
                          <span className="truncate">{group.label}</span>
                          <span className="ml-auto pr-1 text-[9px] font-medium opacity-40 group-hover/header:opacity-70">
                            {group.sessions.length}
                          </span>
                        </button>
                        {!isCollapsed && (
                          <div className="flex flex-col gap-0.5">
                            {group.sessions.map((session) => {
                              const isActive = session.path === currentSessionPath
                              return (
                                <SessionItem
                                  key={session.path}
                                  session={session}
                                  isActive={isActive}
                                  onSelect={() => void handleSwitchSession(session.path)}
                                  onRename={() => handleRenameOpen(session)}
                                  onDelete={() => setDeleteTarget(session)}
                                  onDeleteImmediate={() => void handleDeleteImmediate(session.path)}
                                  canDelete={!isActive}
                                  projectLabel={session.project?.projectRoot}
                                />
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            </div>
          </div>
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
          <div className="flex-1 min-h-0 px-2 pb-2">
            <div className="h-full overflow-hidden rounded-lg border border-border/60 bg-bg-primary/30">
              <ScrollArea className="h-full">
                <div className="flex flex-col gap-1 p-1.5">
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
            </div>
          </div>
        )}

        {/* Bottom area */}
        <div className="flex-shrink-0 border-t border-border px-3 py-2 flex items-center gap-2">
          {(isCompacting || autoCompactionEnabled) && (
            <div className="px-1 text-[10px] text-text-tertiary truncate flex-1">
              {isCompacting ? 'Compacting context...' : 'Auto-compact on'}
            </div>
          )}

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
            <DialogDescription>
              Choose a new name for this saved session.
            </DialogDescription>
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
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Session</DialogTitle>
            <DialogDescription>
              Permanently remove this saved session from disk.
            </DialogDescription>
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

function groupSessionsByProject(sessions: Session[]): Array<{ key: string; label: string; sessions: Session[] }> {
  const groups = new Map<string, { key: string; label: string; sessions: Session[] }>()

  for (const session of sessions) {
    const project = session.project
    const derivedRoot = project?.projectRoot
    const key = (derivedRoot ?? session.path.split(/[\\/]/).slice(0, -1).join('/')) || '__ungrouped__'
    const label = derivedRoot
      ? derivedRoot.split(/[\\/]/).filter(Boolean).pop() ?? derivedRoot
      : (session.path.split(/[\\/]/).slice(0, -1).filter(Boolean).pop() ?? 'Other sessions')

    const existing = groups.get(key)
    if (existing) {
      existing.sessions.push(session)
    } else {
      groups.set(key, { key, label, sessions: [session] })
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    const aModified = Math.max(...a.sessions.map((session) => session.modified))
    const bModified = Math.max(...b.sessions.map((session) => session.modified))
    return bModified - aModified
  })
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
  onDeleteImmediate: () => void
  canDelete: boolean
  projectLabel?: string
}

function SessionItem({ session, isActive, onSelect, onRename, onDelete, onDeleteImmediate, canDelete, projectLabel }: SessionItemProps) {
  const shortProjectLabel = projectLabel
    ? projectLabel.split(/[\\/]/).filter(Boolean).pop() ?? projectLabel
    : null
  const displayName = (typeof session.name === 'string' && session.name.trim().length > 0
    ? session.name
    : session.project?.sessionName || session.project?.firstPrompt || 'New session')

  return (
    <div
      className={cn(
        'group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-2 transition-colors',
        isActive
          ? 'bg-accent/15 border-l-2 border-accent text-text-primary pl-[6px]'
          : 'text-text-secondary hover:bg-accent/10 active:bg-accent/20',
      )}
      title={displayName}
    >
      <button
        onClick={onSelect}
        className="flex min-w-0 items-center gap-2 text-left"
        title={displayName}
      >
        <MessageSquare
          className={cn('h-3.5 w-3.5 flex-shrink-0', isActive ? 'text-accent' : 'text-text-tertiary')}
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium leading-tight text-text-primary">{displayName}</p>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            {shortProjectLabel && (
              <span className="truncate text-[10px] text-text-tertiary/90">
                {shortProjectLabel}
              </span>
            )}
            <span className="truncate text-[10px] leading-tight text-text-tertiary">
              {relativeTime(session.modified)}
            </span>
          </div>
        </div>
      </button>

      <div className="flex flex-shrink-0 items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRename()
          }}
          aria-label="Rename session"
          title="Rename session"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-border/70 bg-bg-primary/80 text-text-secondary opacity-0 pointer-events-none shadow-sm transition-all group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
        >
          <Pencil className="h-4 w-4" />
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation()
            onDeleteImmediate()
          }}
          aria-label="Delete session"
          title={canDelete ? 'Delete session' : 'Switch to another session to delete this one'}
          disabled={!canDelete}
          className={cn(
            'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border shadow-sm transition-all',
            canDelete
              ? 'border-red-500/40 bg-red-500/15 text-red-200 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto hover:bg-red-500/25 hover:text-red-100'
              : 'cursor-not-allowed border-border/60 bg-bg-primary/50 text-text-tertiary/60 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto',
          )}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
