/**
 * StatusBar — fixed bar at the bottom of the app.
 *
 * Shows: current model name | session name | file viewer toggle | permission mode | health dot + status
 */

import { FileText, MessageSquare } from 'lucide-react'
import { formatModelDisplay } from '../lib/models'
import { btn, chrome } from '../lib/theme'

interface HealthDotProps {
  health: string
}

function HealthDot({ health }: HealthDotProps) {
  const colorClass =
    health === 'ready'
      ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.5)]'
      : health === 'starting'
        ? 'bg-accent shadow-[0_0_4px_rgba(249,115,22,0.5)] animate-pulse'
        : health === 'crashed' || health === 'degraded'
          ? 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.5)]'
          : 'bg-bg-tertiary'
  return <span className={`h-1 w-1.5 rounded-full flex-shrink-0 ${colorClass}`} />
}

interface Props {
  model: string
  sessionName: string
  health: string
  fileViewerOpen?: boolean
  onToggleFileViewer?: () => void
  onOpenModelPicker?: () => void
  /** When true, hide secondary info and file viewer toggle (mobile compact mode). */
  isMobile?: boolean
}

export function StatusBar({
  model,
  sessionName,
  health,
  fileViewerOpen,
  onToggleFileViewer,
  onOpenModelPicker,
  isMobile = false,
}: Props) {
  const APP_VERSION = '0.9.0'
  const healthLabel = health === 'ready' ? `v${APP_VERSION}` : health === 'unknown' ? 'connecting' : health

  return (
    <div className={`flex items-center justify-between px-2 py-0.5 border-t border-border ${chrome.bar} ${chrome.text} flex-shrink-0`}>
      {/* Left: model — clickable to open model picker */}
      <button
        onClick={onOpenModelPicker}
        title="Switch model (⌘P)"
        className={`${btn.ghost} truncate max-w-[160px] text-left cursor-pointer disabled:cursor-default`}
        disabled={!onOpenModelPicker}
      >
        {formatModelDisplay(model, { includeProvider: true })}
      </button>

      {/* Center: session name + context usage + file viewer toggle */}
      <div className="flex items-center gap-2 min-w-0">
        {!isMobile && (
          <div 
            className="flex items-center text-text-primary/80 cursor-help"
            title={sessionName || 'New session'}
          >
            <MessageSquare className="w-3 h-3" />
          </div>
        )}
        {!isMobile && (
          <button
            onClick={onToggleFileViewer}
            title={fileViewerOpen ? 'Hide Files (⌘⇧F)' : 'Show Files (⌘⇧F)'}
            className={`${btn.ghost} flex items-center justify-center p-0.5 cursor-pointer disabled:cursor-default mobile-status-bar-file-toggle`}
            disabled={!onToggleFileViewer}
          >
            <FileText className="w-3 h-3" />
          </button>
        )}

      </div>

      {/* Right: health */}
      <div className="flex items-center gap-1.5 cursor-help" title={healthLabel}>
        <HealthDot health={health} />
      </div>
    </div>
  )
}
