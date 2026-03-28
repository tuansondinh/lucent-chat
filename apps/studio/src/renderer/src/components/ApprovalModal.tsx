/**
 * ApprovalModal — shows a file change approval request from the agent.
 *
 * Displayed when GSD_STUDIO_PERMISSION_MODE = 'accept-on-edit' and the agent
 * attempts to edit or write a file.  The user can Allow or Deny the change.
 * The decision is sent back to the main process via IPC.
 *
 * ApprovalCard is the inline (chat-embedded) version.
 * ApprovalModal / ApprovalModalContainer are kept for any fallback usage.
 */

import { useState, useEffect, useCallback } from 'react'
import { ShieldAlert, Check, X } from 'lucide-react'
import { getBridge } from '../lib/bridge'
import { btn } from '../lib/theme'

// ============================================================================
// Types
// ============================================================================

export interface ApprovalRequest {
  paneId: string
  id: string
  action: 'write' | 'edit' | 'delete' | 'move'
  path: string
  message: string
}

// ============================================================================
// ApprovalModal
// ============================================================================

interface ApprovalModalProps {
  request: ApprovalRequest
  onRespond: (approved: boolean) => void
}

function ApprovalModal({ request, onRespond }: ApprovalModalProps) {
  const actionLabel = {
    write: 'Write File',
    edit: 'Edit File',
    delete: 'Delete File',
    move: 'Move File',
  }[request.action] ?? request.action

  // Extract diff preview from message (if present after a blank line)
  const parts = request.message.split('\n\n')
  const description = parts[0] ?? request.message
  const diffPreview = parts.length > 1 ? parts.slice(1).join('\n\n') : null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="File change approval request"
      data-testid="approval-modal"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="bg-bg-primary border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <ShieldAlert className="w-5 h-5 text-accent flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-text-primary">{actionLabel} — Approval Required</div>
            <div
              className="text-xs text-text-tertiary truncate mt-0.5 font-mono"
              title={request.path}
              data-testid="approval-modal-path"
            >
              {request.path}
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="px-5 pt-4 pb-2">
          <p className="text-sm text-text-secondary">{description}</p>
        </div>

        {/* Diff preview */}
        {diffPreview && (
          <div className="mx-5 mb-3 rounded-lg overflow-hidden border border-border">
            <div className="px-3 py-1.5 bg-bg-secondary text-xs text-text-tertiary font-medium">
              Diff preview
            </div>
            <pre
              className="px-3 py-2 text-[11px] font-mono overflow-auto max-h-48 bg-bg-tertiary text-text-secondary leading-relaxed"
              data-testid="approval-modal-diff"
            >
              {diffPreview.slice(0, 3000)}
            </pre>
          </div>
        )}

        {/* Buttons */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            className={`${btn.outline} px-4 py-1.5 text-sm`}
            onClick={() => onRespond(false)}
            data-testid="approval-modal-deny"
          >
            <X className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
            Deny
          </button>
          <button
            className={`${btn.primary} px-4 py-1.5 text-sm`}
            onClick={() => onRespond(true)}
            data-testid="approval-modal-allow"
          >
            <Check className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// ApprovalCard — inline chat card version (no overlay)
// ============================================================================

export function ApprovalCard({ request, onRespond }: ApprovalModalProps) {
  const actionLabel = {
    write: 'Write File',
    edit: 'Edit File',
    delete: 'Delete File',
    move: 'Move File',
  }[request.action] ?? request.action

  const parts = request.message.split('\n\n')
  const description = parts[0] ?? request.message
  const diffPreview = parts.length > 1 ? parts.slice(1).join('\n\n') : null

  return (
    <div
      role="group"
      aria-label="File change approval request"
      data-testid="approval-card"
      className="mx-4 mb-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        <ShieldAlert className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
        <span className="text-xs font-semibold text-yellow-400">{actionLabel}</span>
        <span
          className="text-[10px] text-text-tertiary font-mono truncate flex-1 min-w-0"
          title={request.path}
          data-testid="approval-card-path"
        >
          {request.path}
        </span>
      </div>

      {/* Description */}
      <div className="px-4 pb-2 text-xs text-text-secondary border-t border-yellow-500/10 pt-2">
        {description}
      </div>

      {/* Diff preview */}
      {diffPreview && (
        <div className="mx-4 mb-2 rounded overflow-hidden border border-border">
          <pre
            className="px-3 py-2 text-[10px] font-mono overflow-auto max-h-36 bg-bg-tertiary text-text-secondary leading-relaxed"
            data-testid="approval-card-diff"
          >
            {diffPreview.slice(0, 3000)}
          </pre>
        </div>
      )}

      {/* Buttons */}
      <div className="flex items-center gap-3 px-4 py-3 border-t border-yellow-500/10">
        <button
          className={`${btn.primary} px-4 py-2 text-sm font-medium flex items-center gap-2`}
          onClick={() => onRespond(true)}
          data-testid="approval-card-allow"
        >
          <Check className="w-3.5 h-3.5" />
          Allow
          <kbd className="text-[10px] opacity-70 font-mono bg-white/10 px-1 py-0.5 rounded">⌘↵</kbd>
        </button>
        <button
          className={`${btn.outline} px-4 py-2 text-sm font-medium flex items-center gap-2`}
          onClick={() => onRespond(false)}
          data-testid="approval-card-deny"
        >
          <X className="w-3.5 h-3.5" />
          Deny
          <kbd className="text-[10px] opacity-70 font-mono bg-white/10 px-1 py-0.5 rounded">esc</kbd>
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// ApprovalModalContainer — manages the queue of pending approval requests
// ============================================================================

export function ApprovalModalContainer() {
  const bridge = getBridge()
  const [queue, setQueue] = useState<ApprovalRequest[]>([])

  useEffect(() => {
    if (!bridge?.onApprovalRequest) return

    const unsubscribe = bridge.onApprovalRequest((req) => {
      setQueue((prev) => [...prev, req])
    })

    return unsubscribe
  }, [bridge])

  const handleRespond = useCallback(
    async (request: ApprovalRequest, approved: boolean) => {
      // Remove from queue immediately so UI is responsive
      setQueue((prev) => prev.filter((r) => r.id !== request.id))

      try {
        await bridge?.approvalRespond?.(request.paneId, request.id, approved)
      } catch (err) {
        console.error('[approval-modal] failed to send response:', err)
      }
    },
    [bridge],
  )

  const current = queue[0]
  if (!current) return null

  return (
    <ApprovalModal
      request={current}
      onRespond={(approved) => void handleRespond(current, approved)}
    />
  )
}
