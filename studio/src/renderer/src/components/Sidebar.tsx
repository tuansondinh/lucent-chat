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
  PanelLeftClose,
  PanelLeft,
  MoreHorizontal,
  Pencil,
  Trash2,
  MessageSquare,
} from 'lucide-react'
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
import { relativeTime } from '../lib/time'

// ============================================================================
// Types
// ============================================================================

export interface Session {
  path: string
  name: string
  modified: number
}

interface Props {
  collapsed: boolean
  onToggleCollapse: () => void
  currentSessionPath: string | null
  onNewSession: () => void
  onSwitchSession: (path: string) => void
  onRefresh: () => void
}

// ============================================================================
// Sidebar
// ============================================================================

export function Sidebar({
  collapsed,
  onToggleCollapse,
  currentSessionPath,
  onNewSession,
  onSwitchSession,
  onRefresh,
}: Props) {
  const [sessions, setSessions] = useState<Session[]>([])
  const bridge = window.bridge

  // -- Rename dialog state
  const [renameTarget, setRenameTarget] = useState<Session | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // -- Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null)

  // -------------------------------------------------------------------------
  // Load sessions
  // -------------------------------------------------------------------------

  const loadSessions = useCallback(async () => {
    try {
      const list = await bridge.getSessions()
      setSessions(list)
    } catch {
      // silently ignore
    }
  }, [bridge])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions, currentSessionPath])

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const handleNewSession = async () => {
    const result = await bridge.newSession()
    if (!result.cancelled) {
      await loadSessions()
      onNewSession()
    }
  }

  const handleSwitchSession = async (path: string) => {
    if (path === currentSessionPath) return
    const result = await bridge.switchSession(path)
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
        await bridge.switchSession(renameTarget.path)
      }
      await bridge.renameSession(renameValue.trim())
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
    try {
      await bridge.deleteSession(deleteTarget.path)
      await loadSessions()
      onRefresh()
    } catch {
      // ignore
    } finally {
      setDeleteTarget(null)
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (collapsed) {
    return (
      <div className="flex flex-col items-center py-3 gap-2 h-full border-r border-border bg-bg-secondary">
        {/* Traffic-light spacer */}
        <div className="h-7 flex-shrink-0" />

        {/* Expand button */}
        <button
          onClick={onToggleCollapse}
          title="Expand sidebar (⌘B)"
          className="flex items-center justify-center w-8 h-8 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <PanelLeft className="w-4 h-4" />
        </button>

        {/* New session */}
        <button
          onClick={() => void handleNewSession()}
          title="New session (⌘N)"
          className="flex items-center justify-center w-8 h-8 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Settings */}
        <button
          title="Settings"
          className="flex items-center justify-center w-8 h-8 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors mb-2"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col h-full border-r border-border bg-bg-secondary">
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-3 flex-shrink-0"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {/* Traffic-light spacer */}
          <div className="w-20 flex-shrink-0" />

          <span className="text-sm font-semibold text-text-primary tracking-tight">
            Voice Bridge
          </span>

          <button
            onClick={onToggleCollapse}
            title="Collapse sidebar (⌘B)"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        {/* New Session button */}
        <div className="px-3 pb-2 flex-shrink-0">
          <button
            onClick={() => void handleNewSession()}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover border border-border hover:border-border-active transition-colors"
          >
            <Plus className="w-4 h-4 flex-shrink-0" />
            <span>New Session</span>
          </button>
        </div>

        {/* Sessions list */}
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

        {/* Bottom area */}
        <div className="flex-shrink-0 border-t border-border px-3 py-2 flex items-center justify-between">
          <button
            title="Settings (Phase 3E)"
            className="flex items-center justify-center w-7 h-7 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
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
              className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-secondary hover:text-text-primary hover:border-border-active transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleRenameConfirm()}
              disabled={!renameValue.trim()}
              className="px-3 py-1.5 text-sm rounded-lg bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Rename
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
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
          <DialogFooter>
            <button
              onClick={() => setDeleteTarget(null)}
              className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-secondary hover:text-text-primary hover:border-border-active transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleDeleteConfirm()}
              className="px-3 py-1.5 text-sm rounded-lg bg-red-600/20 border border-red-600/40 text-red-400 hover:bg-red-600/30 transition-colors"
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
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
          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
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
              'flex items-center justify-center w-5 h-5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover flex-shrink-0 transition-colors',
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
