/**
 * ModelPicker — dialog for browsing and switching the active LLM model.
 *
 * Opens via Cmd+M or clicking the model name in the status bar / sidebar.
 * Fetches models via window.bridge.getModels() on open, groups them by
 * provider, and calls window.bridge.switchModel(provider, id) on selection.
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { Check, Cpu, Search } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { ScrollArea } from './ui/scroll-area'
import { usePanesStore, getPaneStore } from '../store/pane-store'
import { cn } from '../lib/utils'
import { formatModelDisplay, formatProviderName, getModelRefFromState } from '../lib/models'

// ============================================================================
// Types
// ============================================================================

interface Model {
  provider: string
  id: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  paneId?: string
}

// ============================================================================
// Helpers
// ============================================================================

export function ModelPicker({ open, onOpenChange, paneId }: Props) {
  const { activePaneId } = usePanesStore()
  const targetPaneId = paneId ?? activePaneId
  const { currentModel } = getPaneStore(targetPaneId)()
  const bridge = window.bridge

  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // -------------------------------------------------------------------------
  // Fetch models when dialog opens
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!open) {
      // Reset search when closed
      setQuery('')
      return
    }
    setLoading(true)
    bridge
      .getModels(targetPaneId)
      .then((list: Model[]) => setModels(list))
      .catch(() => setModels([]))
      .finally(() => setLoading(false))

    // Auto-focus search after dialog animation settles
    const t = setTimeout(() => searchRef.current?.focus(), 80)
    return () => clearTimeout(t)
  }, [open, targetPaneId]) // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Filtering + grouping
  // -------------------------------------------------------------------------

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return models
    return models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q),
    )
  }, [models, query])

  const grouped = useMemo(() => {
    const map = new Map<string, Model[]>()
    for (const m of filtered) {
      const list = map.get(m.provider) ?? []
      list.push(m)
      map.set(m.provider, list)
    }
    // Sort providers alphabetically
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  // -------------------------------------------------------------------------
  // Switch model
  // -------------------------------------------------------------------------

  const handleSelect = async (model: Model) => {
    const requestedModel = `${model.provider}/${model.id}`
    try {
      await bridge.switchModel(targetPaneId, model.provider, model.id)
      const state = await bridge.getState(targetPaneId)
      const actualModel = getModelRefFromState(state)
      if (actualModel) {
        getPaneStore(targetPaneId).getState().setModel(actualModel)
      }
      if (actualModel && actualModel !== requestedModel) {
        toast.error(`Model switch did not apply. Active model is ${formatModelDisplay(actualModel, { includeProvider: true })}.`)
        return
      }
      if (!actualModel) {
        toast.error('Model switch completed, but the active model could not be confirmed.')
        return
      }
      toast.success(`Switched to ${formatModelDisplay(actualModel, { includeProvider: true })}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to switch model'
      toast.error(message)
      return
    }
    onOpenChange(false)
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg p-0 gap-0 overflow-hidden"
        showCloseButton={false}
      >
        <DialogHeader className="px-4 pt-4 pb-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Cpu className="w-4 h-4 text-accent flex-shrink-0" />
            Switch Model
          </DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="px-4 pt-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary pointer-events-none" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models..."
              className="pl-8 h-8 text-sm"
            />
          </div>
        </div>

        {/* Model list */}
        <ScrollArea className="max-h-[380px]">
          <div className="px-2 pb-2">
            {loading && (
              <p className="text-xs text-text-tertiary text-center py-6">
                Loading models...
              </p>
            )}

            {!loading && grouped.length === 0 && (
              <p className="text-xs text-text-tertiary text-center py-6">
                {query ? 'No models match your search.' : 'No models available.'}
              </p>
            )}

            {!loading &&
              grouped.map(([provider, providerModels]) => (
                <div key={provider} className="mb-1">
                  {/* Provider header */}
                  <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary select-none">
                    {formatProviderName(provider)}
                  </div>

                  {/* Model rows */}
                  {providerModels.map((model) => {
                    const fullId = `${model.provider}/${model.id}`
                    const isActive = currentModel === fullId
                    return (
                      <button
                        key={model.id}
                        onClick={() => void handleSelect(model)}
                        className={cn(
                          'w-full flex items-center gap-2 px-2 py-2 rounded-md text-left transition-colors',
                          isActive
                            ? 'bg-accent/15 text-accent'
                            : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                        )}
                      >
                        {/* Checkmark for active model */}
                        <span className="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center">
                          {isActive && <Check className="w-3.5 h-3.5 text-accent" />}
                        </span>

                        <span className="text-xs font-mono truncate flex-1">{model.id}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
          </div>
        </ScrollArea>

        {/* Footer hint */}
        <div className="border-t border-border px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] text-text-tertiary">
            {models.length > 0 ? `${models.length} model${models.length !== 1 ? 's' : ''} available` : ''}
          </span>
          <span className="text-[10px] text-text-tertiary">
            <kbd className="font-mono bg-bg-tertiary border border-border rounded px-1 py-0.5 text-[9px]">⌘M</kbd>
            {' '}to toggle
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
