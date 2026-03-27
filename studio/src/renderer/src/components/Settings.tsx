/**
 * Settings — tabbed settings dialog for Lucent Chat Desktop.
 *
 * Tabs:
 *   - General:    font size
 *   - API Keys:   Tavily API key (password input with show/hide)
 *   - Models:     default model picker
 *   - Shortcuts:  read-only keyboard shortcut reference table
 *
 * Opens via Cmd+, or Command Palette → Settings.
 * Loads settings on open; saves each field on change (debounced) or blur.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Settings as SettingsIcon,
  Key,
  Cpu,
  Keyboard,
  Eye,
  EyeOff,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Globe,
  Lock,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { cn } from '../lib/utils'

// ============================================================================
// Types
// ============================================================================

interface SettingsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Tab = 'general' | 'apikeys' | 'models' | 'shortcuts'

interface Model {
  provider: string
  id: string
}

interface ProviderStatus {
  id: string
  label: string
  configured: boolean
  configuredVia: 'auth_file' | 'environment' | null
  removeAllowed: boolean
  recommended?: boolean
}

interface TabItem {
  id: Tab
  label: string
  icon: React.ReactNode
}

// ============================================================================
// Constants
// ============================================================================

const TABS: TabItem[] = [
  { id: 'general',   label: 'General',   icon: <SettingsIcon className="w-3.5 h-3.5" /> },
  { id: 'apikeys',   label: 'API Keys',  icon: <Key          className="w-3.5 h-3.5" /> },
  { id: 'models',    label: 'Models',    icon: <Cpu          className="w-3.5 h-3.5" /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard     className="w-3.5 h-3.5" /> },
]

const SHORTCUTS = [
  { shortcut: '⌘N', action: 'New session' },
  { shortcut: '⌘B', action: 'Toggle sidebar' },
  { shortcut: '⌘M', action: 'Model picker' },
  { shortcut: '⌘K', action: 'Command palette' },
  { shortcut: '⌘,', action: 'Settings' },
  { shortcut: 'Esc', action: 'Stop generation / close modal' },
]

// ============================================================================
// Settings
// ============================================================================

export function Settings({ open, onOpenChange }: SettingsProps) {
  const bridge = window.bridge

  const [activeTab, setActiveTab] = useState<Tab>('general')

  // ---- form state ----
  const [fontSize, setFontSize] = useState(14)
  const [tavilyKey, setTavilyKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [keySaved, setKeySaved] = useState(false)
  const [models, setModels] = useState<Model[]>([])
  const [defaultModel, setDefaultModel] = useState<string>('')
  const [loadingModels, setLoadingModels] = useState(false)
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([])

  // Debounce timer ref for font size saves
  const fontSizeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // -------------------------------------------------------------------------
  // Load settings + models when dialog opens
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!open) {
      // Reset tab to general when re-opened
      setActiveTab('general')
      setShowKey(false)
      setKeySaved(false)
      return
    }

    bridge
      .getSettings()
      .then((s) => {
        if (typeof s.fontSize === 'number') setFontSize(s.fontSize)
        if (typeof s.tavilyApiKey === 'string') setTavilyKey(s.tavilyApiKey)
        if (s.defaultModel) {
          setDefaultModel(`${s.defaultModel.provider}/${s.defaultModel.modelId}`)
        } else {
          setDefaultModel('')
        }
      })
      .catch(() => {})

    if (typeof bridge.getProviderAuthStatus === 'function') {
      bridge.getProviderAuthStatus()
        .then((s) => setProviderStatuses(s as ProviderStatus[]))
        .catch(() => {})
    }

    // Fetch models for the Models tab
    setLoadingModels(true)
    bridge
      .getModels('pane-0')
      .then((list: Model[]) => setModels(list ?? []))
      .catch(() => setModels([]))
      .finally(() => setLoadingModels(false))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Save helpers
  // -------------------------------------------------------------------------

  const handleFontSizeChange = useCallback((value: number) => {
    const clamped = Math.max(10, Math.min(24, value))
    setFontSize(clamped)
    // Debounce saves by 400ms
    if (fontSizeDebounce.current) clearTimeout(fontSizeDebounce.current)
    fontSizeDebounce.current = setTimeout(() => {
      bridge.setSettings({ fontSize: clamped }).catch(() => {})
    }, 400)
  }, [bridge])

  const handleSaveTavilyKey = useCallback(() => {
    bridge
      .setSettings({ tavilyApiKey: tavilyKey })
      .then(() => {
        setKeySaved(true)
        setTimeout(() => setKeySaved(false), 2000)
      })
      .catch(() => {})
  }, [bridge, tavilyKey])

  const handleDefaultModelChange = useCallback((value: string) => {
    setDefaultModel(value)
    const [provider, ...rest] = value.split('/')
    const modelId = rest.join('/')
    bridge.setSettings({ defaultModel: { provider, modelId } }).catch(() => {})
  }, [bridge])

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl p-0 gap-0 overflow-hidden"
        showCloseButton={true}
        aria-describedby={undefined}
      >
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-base">
            <SettingsIcon className="w-4 h-4 text-accent flex-shrink-0" />
            Settings
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-[400px]">
          {/* Sidebar tabs */}
          <nav className="w-44 border-r border-border bg-bg-primary flex-shrink-0 py-3 px-2">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left mb-0.5',
                  activeTab === tab.id
                    ? 'bg-accent/15 text-accent font-medium'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                )}
              >
                <span className="flex-shrink-0">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'general' && (
              <GeneralTab fontSize={fontSize} onFontSizeChange={handleFontSizeChange} />
            )}
            {activeTab === 'apikeys' && (
              <ApiKeysTab
                tavilyKey={tavilyKey}
                onTavilyKeyChange={setTavilyKey}
                showKey={showKey}
                onToggleShow={() => setShowKey((v) => !v)}
                onSave={handleSaveTavilyKey}
                saved={keySaved}
                providerStatuses={providerStatuses}
                onRefreshProviders={() => {
                  if (typeof bridge.getProviderAuthStatus === 'function') {
                    bridge.getProviderAuthStatus()
                      .then((s) => setProviderStatuses(s as ProviderStatus[]))
                      .catch(() => {})
                  }
                }}
              />
            )}
            {activeTab === 'models' && (
              <ModelsTab
                models={models}
                loading={loadingModels}
                defaultModel={defaultModel}
                onDefaultModelChange={handleDefaultModelChange}
              />
            )}
            {activeTab === 'shortcuts' && <ShortcutsTab />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// GeneralTab
// ============================================================================

interface GeneralTabProps {
  fontSize: number
  onFontSizeChange: (v: number) => void
}

function GeneralTab({ fontSize, onFontSizeChange }: GeneralTabProps) {
  return (
    <div className="p-6 space-y-6">
      <Section title="Appearance">
        <Field
          label="Font size"
          hint="Chat and code font size in pixels (10–24)"
        >
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={10}
              max={24}
              value={fontSize}
              onChange={(e) => onFontSizeChange(Number(e.target.value))}
              className="w-20 h-8 text-sm"
            />
            <span className="text-xs text-text-tertiary">px</span>
          </div>
        </Field>

        <Field label="Theme" hint="Additional themes coming soon">
          <div className="flex items-center gap-2 h-8 px-3 rounded-md border border-border bg-bg-tertiary text-sm text-text-secondary select-none w-fit">
            Dark
          </div>
        </Field>
      </Section>
    </div>
  )
}

// ============================================================================
// ApiKeysTab
// ============================================================================

interface ApiKeysTabProps {
  tavilyKey: string
  onTavilyKeyChange: (v: string) => void
  showKey: boolean
  onToggleShow: () => void
  onSave: () => void
  saved: boolean
  providerStatuses: ProviderStatus[]
  onRefreshProviders: () => void
}

function ApiKeysTab({
  tavilyKey,
  onTavilyKeyChange,
  showKey,
  onToggleShow,
  onSave,
  saved,
  providerStatuses,
  onRefreshProviders,
}: ApiKeysTabProps) {
  return (
    <div className="p-6 space-y-6">
      <ProvidersSection
        providerStatuses={providerStatuses}
        onRefresh={onRefreshProviders}
      />
      <Section title="Web Search">
        <Field
          label="Tavily API key"
          hint={
            <>
              Required for web search.{' '}
              <a
                href="https://tavily.com"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                Get a key at tavily.com
              </a>
            </>
          }
        >
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-xs">
              <Input
                type={showKey ? 'text' : 'password'}
                value={tavilyKey}
                onChange={(e) => onTavilyKeyChange(e.target.value)}
                placeholder="tvly-..."
                className="h-8 text-sm pr-9 font-mono"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSave()
                }}
              />
              <button
                type="button"
                onClick={onToggleShow}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary transition-colors"
                tabIndex={-1}
                aria-label={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey
                  ? <EyeOff className="w-3.5 h-3.5" />
                  : <Eye    className="w-3.5 h-3.5" />
                }
              </button>
            </div>
            <Button
              size="sm"
              variant={saved ? 'secondary' : 'default'}
              onClick={onSave}
              className="h-8 gap-1.5 text-xs"
            >
              {saved ? (
                <>
                  <Check className="w-3 h-3" />
                  Saved
                </>
              ) : (
                'Save'
              )}
            </Button>
          </div>
        </Field>
      </Section>
    </div>
  )
}

// ============================================================================
// ProvidersSection
// ============================================================================

interface ProvidersSectionProps {
  providerStatuses: ProviderStatus[]
  onRefresh: () => void
}

function ProvidersSection({ providerStatuses, onRefresh }: ProvidersSectionProps) {
  const bridge = window.bridge

  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})
  const [showKeyFor, setShowKeyFor] = useState<Record<string, boolean>>({})
  const [savingProvider, setSavingProvider] = useState<string | null>(null)
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({})
  const [removingProvider, setRemovingProvider] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  const handleSave = async (providerId: string) => {
    const key = (keyInputs[providerId] ?? '').trim()
    if (!key) return
    setSavingProvider(providerId)
    setSaveErrors((prev) => ({ ...prev, [providerId]: '' }))
    try {
      const result = await bridge.validateAndSaveProviderKey(providerId, key)
      if (result.ok) {
        onRefresh()
        setExpandedProvider(null)
        setKeyInputs((prev) => ({ ...prev, [providerId]: '' }))
      } else {
        setSaveErrors((prev) => ({ ...prev, [providerId]: result.message }))
      }
    } catch (err: unknown) {
      setSaveErrors((prev) => ({
        ...prev,
        [providerId]: err instanceof Error ? err.message : 'Failed to save key',
      }))
    } finally {
      setSavingProvider(null)
    }
  }

  const handleRemove = async (providerId: string) => {
    setRemovingProvider(providerId)
    setConfirmRemove(null)
    try {
      await bridge.removeProviderKey(providerId)
      onRefresh()
    } finally {
      setRemovingProvider(null)
    }
  }

  if (providerStatuses.length === 0) return null

  return (
    <Section title="LLM Providers">
      <div className="space-y-2">
        {providerStatuses.map((status) => {
          const isExpanded = expandedProvider === status.id
          const isSaving = savingProvider === status.id
          const isRemoving = removingProvider === status.id
          const error = saveErrors[status.id] ?? ''

          return (
            <div
              key={status.id}
              className={[
                'rounded-lg border transition-colors',
                status.configured
                  ? 'border-accent/40 bg-accent/5'
                  : isExpanded
                    ? 'border-border bg-bg-secondary'
                    : 'border-border',
              ].join(' ')}
            >
              {/* Row header */}
              <div className="flex items-center justify-between px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setExpandedProvider((prev) => {
                      setSaveErrors((e) => ({ ...e, [status.id]: '' }))
                      setConfirmRemove(null)
                      return prev === status.id ? null : status.id
                    })
                  }}
                  className="flex items-center gap-2 flex-1 text-left"
                >
                  <span className="text-sm font-medium text-text-primary">{status.label}</span>
                  {status.recommended && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-accent bg-accent/15 px-1.5 py-0.5 rounded">
                      Recommended
                    </span>
                  )}
                </button>
                <div className="flex items-center gap-2 ml-2">
                  {status.configured && status.configuredVia === 'auth_file' && (
                    <span className="flex items-center gap-1 text-xs text-green-400">
                      <Check className="w-3 h-3" />
                      Added
                    </span>
                  )}
                  {status.configured && status.configuredVia === 'environment' && (
                    <span className="flex items-center gap-1 text-xs text-blue-400">
                      <Globe className="w-3 h-3" />
                      via env
                    </span>
                  )}
                  {!status.configured && (
                    <span className="text-xs text-text-tertiary">Not configured</span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedProvider((prev) => {
                        setSaveErrors((e) => ({ ...e, [status.id]: '' }))
                        setConfirmRemove(null)
                        return prev === status.id ? null : status.id
                      })
                    }}
                    className="text-text-tertiary"
                  >
                    {isExpanded
                      ? <ChevronUp className="w-3.5 h-3.5" />
                      : <ChevronDown className="w-3.5 h-3.5" />
                    }
                  </button>
                </div>
              </div>

              {/* Expanded form */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-2.5">
                  {status.configuredVia === 'environment' ? (
                    <div className="flex items-center gap-2 text-xs text-text-secondary bg-bg-tertiary rounded p-2.5">
                      <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                      Configured via environment variable — managed outside the app.
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <Input
                          type={showKeyFor[status.id] ? 'text' : 'password'}
                          value={keyInputs[status.id] ?? ''}
                          onChange={(e) =>
                            setKeyInputs((prev) => ({ ...prev, [status.id]: e.target.value }))
                          }
                          placeholder={status.configured ? 'Enter new key to replace...' : 'Paste your API key...'}
                          className="h-8 text-sm pr-9 font-mono"
                          disabled={isSaving}
                          onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(status.id) }}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowKeyFor((prev) => ({ ...prev, [status.id]: !prev[status.id] }))
                          }
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
                          tabIndex={-1}
                        >
                          {showKeyFor[status.id]
                            ? <EyeOff className="w-3.5 h-3.5" />
                            : <Eye className="w-3.5 h-3.5" />
                          }
                        </button>
                      </div>
                      {error && <p className="text-xs text-red-400">{error}</p>}
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => void handleSave(status.id)}
                          disabled={isSaving || !(keyInputs[status.id] ?? '').trim()}
                          className="h-7 text-xs gap-1.5"
                        >
                          {isSaving ? (
                            <><Loader2 className="w-3 h-3 animate-spin" />Validating...</>
                          ) : (
                            status.configured ? 'Save New Key' : 'Validate & Save'
                          )}
                        </Button>
                        {status.removeAllowed && (
                          <>
                            {confirmRemove === status.id ? (
                              <div className="flex items-center gap-1.5 text-xs">
                                <span className="text-text-secondary">Remove key?</span>
                                <button
                                  onClick={() => void handleRemove(status.id)}
                                  disabled={isRemoving}
                                  className="text-red-400 hover:text-red-300 underline"
                                >
                                  {isRemoving ? 'Removing...' : 'Yes'}
                                </button>
                                <button
                                  onClick={() => setConfirmRemove(null)}
                                  className="text-text-tertiary hover:text-text-secondary underline"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmRemove(status.id)}
                                className="text-xs text-red-400/70 hover:text-red-400 transition-colors"
                              >
                                Remove
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Section>
  )
}

// ============================================================================
// ModelsTab
// ============================================================================

interface ModelsTabProps {
  models: Model[]
  loading: boolean
  defaultModel: string
  onDefaultModelChange: (v: string) => void
}

function ModelsTab({ models, loading, defaultModel, onDefaultModelChange }: ModelsTabProps) {
  return (
    <div className="p-6 space-y-6">
      <Section title="Default Model">
        <Field
          label="Startup model"
          hint="Model used when opening a new session. You can always switch models mid-session."
        >
          {loading ? (
            <div className="text-xs text-text-tertiary h-9 flex items-center">Loading models...</div>
          ) : models.length === 0 ? (
            <div className="text-xs text-text-tertiary h-9 flex items-center">No models available</div>
          ) : (
            <Select value={defaultModel} onValueChange={onDefaultModelChange}>
              <SelectTrigger className="w-72 h-8 text-sm">
                <SelectValue placeholder="Select a default model..." />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => {
                  const fullId = `${m.provider}/${m.id}`
                  return (
                    <SelectItem key={fullId} value={fullId}>
                      <span className="font-mono text-xs">{m.provider} / {m.id}</span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          )}
        </Field>
      </Section>
    </div>
  )
}

// ============================================================================
// ShortcutsTab
// ============================================================================

function ShortcutsTab() {
  return (
    <div className="p-6 space-y-6">
      <Section title="Keyboard Shortcuts">
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-primary">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider">
                  Shortcut
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-text-tertiary uppercase tracking-wider">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUTS.map((row, i) => (
                <tr
                  key={row.shortcut}
                  className={cn(
                    'transition-colors',
                    i < SHORTCUTS.length - 1 && 'border-b border-border',
                    'hover:bg-bg-hover',
                  )}
                >
                  <td className="px-4 py-2.5">
                    <kbd className="font-mono text-xs bg-bg-tertiary border border-border rounded px-1.5 py-0.5 text-text-secondary">
                      {row.shortcut}
                    </kbd>
                  </td>
                  <td className="px-4 py-2.5 text-text-secondary text-xs">
                    {row.action}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-text-tertiary mt-2">
          Shortcuts are not configurable in this version.
        </p>
      </Section>
    </div>
  )
}

// ============================================================================
// Layout primitives
// ============================================================================

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
        {title}
      </h3>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-text-primary">{label}</label>
      {children}
      {hint && (
        <p className="text-xs text-text-tertiary">{hint}</p>
      )}
    </div>
  )
}
