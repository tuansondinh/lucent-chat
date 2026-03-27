/**
 * Settings — tabbed settings dialog for Lucent Chat Desktop.
 *
 * Tabs:
 *   - General:    font size
 *   - API Keys:   LLM provider keys + Tavily API key (password input with show/hide)
 *   - Models:     default model picker
 *   - Shortcuts:  read-only keyboard shortcut reference table
 *
 * Opens via Cmd+, or Command Palette → Settings.
 * Loads settings on open; saves each field on change (debounced) or blur.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { getBridge } from '../lib/bridge'
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
  LogIn,
  X,
  Zap,
  Wifi,
  Copy,
  RefreshCw,
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
  voicePttShortcut: 'space' | 'alt+space' | 'cmd+shift+space'
  onVoicePttShortcutChange: (value: 'space' | 'alt+space' | 'cmd+shift+space') => void
  voiceAudioEnabled: boolean
  onVoiceAudioEnabledChange: (enabled: boolean) => void
}

type Tab = 'general' | 'apikeys' | 'models' | 'shortcuts' | 'skills' | 'remote-access'

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
  supportsApiKey: boolean
  supportsOAuth: boolean
}

interface TabItem {
  id: Tab
  label: string
  icon: React.ReactNode
}

type OAuthFlowState =
  | { phase: 'idle' }
  | { phase: 'running'; message?: string }
  | { phase: 'open_browser'; url: string; instructions?: string }
  | { phase: 'awaiting_input'; message: string; placeholder?: string; allowEmpty?: boolean }
  | { phase: 'awaiting_code'; message: string; placeholder?: string }
  | { phase: 'success' }
  | { phase: 'error'; message: string }

// ============================================================================
// Constants
// ============================================================================

const TABS: TabItem[] = [
  { id: 'general',   label: 'General',   icon: <SettingsIcon className="w-3.5 h-3.5" /> },
  { id: 'apikeys',   label: 'API Keys',  icon: <Key          className="w-3.5 h-3.5" /> },
  { id: 'models',    label: 'Models',    icon: <Cpu          className="w-3.5 h-3.5" /> },
  { id: 'skills',        label: 'Skills',        icon: <Zap      className="w-3.5 h-3.5" /> },
  { id: 'shortcuts',     label: 'Shortcuts',     icon: <Keyboard className="w-3.5 h-3.5" /> },
  { id: 'remote-access', label: 'Remote Access', icon: <Wifi     className="w-3.5 h-3.5" /> },
]

const VOICE_SHORTCUT_OPTIONS = [
  { value: 'space', label: 'Hold Space' },
  { value: 'alt+space', label: 'Hold Option+Space' },
  { value: 'cmd+shift+space', label: 'Hold Command+Shift+Space' },
] as const

const SHORTCUTS = [
  { shortcut: '⌘B', action: 'Toggle sidebar' },
  { shortcut: '⌘M', action: 'Model picker' },
  { shortcut: '⌘K', action: 'Command palette' },
  { shortcut: '⌘,', action: 'Settings' },
  { shortcut: 'Esc', action: 'Stop generation / close modal' },
]

const SETTINGS_MODELS_PANE_ID = 'pane-0'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// Settings
// ============================================================================

export function Settings({
  open,
  onOpenChange,
  voicePttShortcut,
  onVoicePttShortcutChange,
  voiceAudioEnabled,
  onVoiceAudioEnabledChange,
}: SettingsProps) {
  const bridge = getBridge()

  const [activeTab, setActiveTab] = useState<Tab>('general')

  // ---- form state ----
  const [fontSize, setFontSize] = useState(14)
  const [tavilyKey, setTavilyKey] = useState('')
  const [hasStoredTavilyKey, setHasStoredTavilyKey] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [keySaved, setKeySaved] = useState(false)
  const [models, setModels] = useState<Model[]>([])
  const [defaultModel, setDefaultModel] = useState<string>('')
  const [localVoiceAudioEnabled, setLocalVoiceAudioEnabled] = useState(voiceAudioEnabled)
  const [localVoicePttShortcut, setLocalVoicePttShortcut] = useState<'space' | 'alt+space' | 'cmd+shift+space'>(voicePttShortcut)
  const [loadingModels, setLoadingModels] = useState(false)
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([])
  const [skills, setSkills] = useState<Array<{ name: string; description: string; trigger: string; stepCount: number }>>([])
  const [loadingSkills, setLoadingSkills] = useState(false)

  // ---- Remote Access state ----
  const [remoteAccessEnabled, setRemoteAccessEnabled] = useState(false)
  const [remoteAccessPort, setRemoteAccessPort] = useState(8788)
  const [remoteAccessToken, setRemoteAccessToken] = useState('')
  const [tailscaleServeEnabled, setTailscaleServeEnabled] = useState(false)
  const [showRemoteToken, setShowRemoteToken] = useState(false)
  const [remoteCopied, setRemoteCopied] = useState(false)
  const [tailscaleUrl, setTailscaleUrl] = useState<string | null>(null)

  // Debounce timer ref for font size saves
  const fontSizeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refreshProviderStatuses = useCallback(async () => {
    if (typeof bridge.getProviderAuthStatus !== 'function') return
    try {
      const statuses = await bridge.getProviderAuthStatus()
      setProviderStatuses(statuses as ProviderStatus[])
    } catch {
      // Ignore transient refresh errors while the settings dialog is open.
    }
  }, [bridge])

  const refreshModels = useCallback(async (options?: { waitForRestart?: boolean }) => {
    const waitForRestart = options?.waitForRestart ?? false
    setLoadingModels(true)
    try {
      const attempts = waitForRestart ? 6 : 1
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          const list = await bridge.getModels(SETTINGS_MODELS_PANE_ID)
          setModels(list ?? [])
          return
        } catch {
          if (attempt === attempts - 1) {
            setModels([])
            return
          }
          await sleep(300)
        }
      }
    } finally {
      setLoadingModels(false)
    }
  }, [bridge])

  const refreshProviderDependentState = useCallback(async () => {
    await Promise.allSettled([
      refreshProviderStatuses(),
      refreshModels({ waitForRestart: true }),
    ])
  }, [refreshModels, refreshProviderStatuses])

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
        setHasStoredTavilyKey(s.hasTavilyKey === true)
        setTavilyKey('')
        setLocalVoiceAudioEnabled(s.voiceAudioEnabled !== false)
        if (s.voicePttShortcut === 'space' || s.voicePttShortcut === 'alt+space' || s.voicePttShortcut === 'cmd+shift+space') {
          setLocalVoicePttShortcut(s.voicePttShortcut)
        } else {
          setLocalVoicePttShortcut(voicePttShortcut)
        }
        if (s.defaultModel) {
          setDefaultModel(`${s.defaultModel.provider}/${s.defaultModel.modelId}`)
        } else {
          setDefaultModel('')
        }
        // Remote Access
        if (typeof s.remoteAccessEnabled === 'boolean') setRemoteAccessEnabled(s.remoteAccessEnabled)
        if (typeof s.remoteAccessPort === 'number') setRemoteAccessPort(s.remoteAccessPort)
        if (typeof s.remoteAccessToken === 'string') setRemoteAccessToken(s.remoteAccessToken)
        if (typeof s.tailscaleServeEnabled === 'boolean') setTailscaleServeEnabled(s.tailscaleServeEnabled)
      })
      .catch(() => {})

    void refreshProviderStatuses()
    void refreshModels()

    // Load skills
    if (bridge.skillList) {
      setLoadingSkills(true)
      bridge.skillList().then((list) => {
        setSkills(list)
      }).catch(() => {}).finally(() => setLoadingSkills(false))
    }
  }, [open, bridge, refreshModels, refreshProviderStatuses, voiceAudioEnabled, voicePttShortcut])

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
        setHasStoredTavilyKey(tavilyKey.trim().length > 0)
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

  const handleVoicePttShortcutChange = useCallback((value: 'space' | 'alt+space' | 'cmd+shift+space') => {
    setLocalVoicePttShortcut(value)
    onVoicePttShortcutChange(value)
    bridge.setSettings({ voicePttShortcut: value }).catch(() => {})
  }, [bridge, onVoicePttShortcutChange])

  const handleVoiceAudioEnabledChange = useCallback((enabled: boolean) => {
    setLocalVoiceAudioEnabled(enabled)
    onVoiceAudioEnabledChange(enabled)
  }, [onVoiceAudioEnabledChange])

  // Remote Access handlers
  const handleRemoteAccessToggle = useCallback((enabled: boolean) => {
    setRemoteAccessEnabled(enabled)
    bridge.setSettings({ remoteAccessEnabled: enabled }).catch(() => {})
  }, [bridge])

  const handleRemoteAccessPortChange = useCallback((port: number) => {
    setRemoteAccessPort(port)
    bridge.setSettings({ remoteAccessPort: port }).catch(() => {})
  }, [bridge])

  const handleTailscaleServeToggle = useCallback((enabled: boolean) => {
    setTailscaleServeEnabled(enabled)
    bridge.setSettings({ tailscaleServeEnabled: enabled }).catch(() => {})
  }, [bridge])

  const handleRotateToken = useCallback(() => {
    const newToken = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    setRemoteAccessToken(newToken)
    bridge.setSettings({ remoteAccessToken: newToken }).catch(() => {})
  }, [bridge])

  const handleCopyToken = useCallback(() => {
    navigator.clipboard.writeText(remoteAccessToken).then(() => {
      setRemoteCopied(true)
      setTimeout(() => setRemoteCopied(false), 2000)
    }).catch(() => {})
  }, [remoteAccessToken])

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-5xl w-full p-0 gap-0 overflow-hidden"
        showCloseButton={true}
        aria-describedby={undefined}
      >
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <SettingsIcon className="w-4 h-4 text-accent flex-shrink-0" />
            Settings
          </DialogTitle>
        </DialogHeader>

        <div className="flex" style={{ height: 'min(680px, 80vh)' }}>
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
              <GeneralTab
                fontSize={fontSize}
                onFontSizeChange={handleFontSizeChange}
                voiceAudioEnabled={localVoiceAudioEnabled}
                onVoiceAudioEnabledChange={handleVoiceAudioEnabledChange}
              />
            )}
            {activeTab === 'apikeys' && (
              <ApiKeysTab
                tavilyKey={tavilyKey}
                hasStoredTavilyKey={hasStoredTavilyKey}
                onTavilyKeyChange={setTavilyKey}
                showKey={showKey}
                onToggleShow={() => setShowKey((v) => !v)}
                onSave={handleSaveTavilyKey}
                saved={keySaved}
                providerStatuses={providerStatuses}
                onRefreshProviders={() => {
                  void refreshProviderDependentState()
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
            {activeTab === 'skills' && (
              <SkillsTab skills={skills} loading={loadingSkills} />
            )}
            {activeTab === 'shortcuts' && (
              <ShortcutsTab
                voicePttShortcut={localVoicePttShortcut}
                onVoicePttShortcutChange={handleVoicePttShortcutChange}
              />
            )}
            {activeTab === 'remote-access' && (
              <RemoteAccessTab
                enabled={remoteAccessEnabled}
                port={remoteAccessPort}
                token={remoteAccessToken}
                tailscaleEnabled={tailscaleServeEnabled}
                tailscaleUrl={tailscaleUrl}
                showToken={showRemoteToken}
                copied={remoteCopied}
                onToggle={handleRemoteAccessToggle}
                onPortChange={handleRemoteAccessPortChange}
                onTailscaleToggle={handleTailscaleServeToggle}
                onRotateToken={handleRotateToken}
                onCopyToken={handleCopyToken}
                onToggleShowToken={() => setShowRemoteToken((v) => !v)}
              />
            )}
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
  voiceAudioEnabled: boolean
  onVoiceAudioEnabledChange: (enabled: boolean) => void
}

function GeneralTab({
  fontSize,
  onFontSizeChange,
  voiceAudioEnabled,
  onVoiceAudioEnabledChange,
}: GeneralTabProps) {
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

      <Section title="Voice">
        <Field
          label="Speech audio"
          hint="Turns assistant voice playback on or off. Voice input still works when speech audio is off."
        >
          <div className="inline-flex rounded-lg border border-border bg-bg-tertiary p-1">
            <button
              onClick={() => onVoiceAudioEnabledChange(true)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                voiceAudioEnabled
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              On
            </button>
            <button
              onClick={() => onVoiceAudioEnabledChange(false)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                !voiceAudioEnabled
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              Off
            </button>
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
  hasStoredTavilyKey: boolean
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
  hasStoredTavilyKey,
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
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  bridge.openExternal('https://tavily.com').catch(() => {})
                }}
              >
                Get a key at tavily.com
              </a>
            </>
          }
        >
          {hasStoredTavilyKey && !tavilyKey && (
            <p className="mb-2 text-xs text-text-tertiary">
              A Tavily key is already stored. Enter a new key only if you want to replace it.
            </p>
          )}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-xs">
              <Input
                type={showKey ? 'text' : 'password'}
                value={tavilyKey}
                onChange={(e) => onTavilyKeyChange(e.target.value)}
                placeholder={hasStoredTavilyKey ? 'Enter new Tavily key to replace existing one' : 'tvly-...'}
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
  const bridge = getBridge()

  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})
  const [showKeyFor, setShowKeyFor] = useState<Record<string, boolean>>({})
  const [savingProvider, setSavingProvider] = useState<string | null>(null)
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({})
  const [removingProvider, setRemovingProvider] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [oauthStates, setOAuthStates] = useState<Record<string, OAuthFlowState>>({})
  const [authMethods, setAuthMethods] = useState<Record<string, 'api_key' | 'oauth'>>({})

  // Subscribe to OAuth progress events from main process
  useEffect(() => {
    if (typeof bridge.onOAuthProgress !== 'function') return
    const unsub = bridge.onOAuthProgress((data) => {
      setOAuthStates((prev) => ({
        ...prev,
        [data.providerId]:
          data.type === 'open_browser'
            ? { phase: 'open_browser', url: data.url!, instructions: data.instructions }
            : data.type === 'awaiting_input'
              ? { phase: 'awaiting_input', message: data.message!, placeholder: data.placeholder, allowEmpty: data.allowEmpty }
              : data.type === 'awaiting_code'
                ? { phase: 'awaiting_code', message: data.message!, placeholder: data.placeholder }
                : { phase: 'running', message: data.message },
      }))
    })
    return unsub
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const getAuthMethod = (status: ProviderStatus): 'api_key' | 'oauth' => {
    if (authMethods[status.id]) return authMethods[status.id]
    return status.supportsApiKey ? 'api_key' : 'oauth'
  }

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

  const handleOAuthStart = (providerId: string) => {
    if (typeof bridge.oauthStart !== 'function') return
    setOAuthStates((prev) => ({ ...prev, [providerId]: { phase: 'running' } }))
    bridge.oauthStart(providerId)
      .then((result) => {
        if (result.ok) {
          onRefresh()
          setOAuthStates((prev) => ({ ...prev, [providerId]: { phase: 'success' } }))
        } else if (result.message !== 'Cancelled') {
          setOAuthStates((prev) => ({ ...prev, [providerId]: { phase: 'error', message: result.message } }))
        } else {
          setOAuthStates((prev) => ({ ...prev, [providerId]: { phase: 'idle' } }))
        }
      })
      .catch((err: unknown) => {
        setOAuthStates((prev) => ({
          ...prev,
          [providerId]: { phase: 'error', message: err instanceof Error ? err.message : 'OAuth failed' },
        }))
      })
  }

  const handleOAuthSubmitCode = (providerId: string, code: string) => {
    if (typeof bridge.oauthSubmitCode === 'function') {
      void bridge.oauthSubmitCode(providerId, code)
    }
  }

  const handleOAuthCancel = (providerId: string) => {
    if (typeof bridge.oauthCancel === 'function') {
      void bridge.oauthCancel(providerId)
    }
    setOAuthStates((prev) => ({ ...prev, [providerId]: { phase: 'idle' } }))
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
          const oauthState = oauthStates[status.id] ?? { phase: 'idle' }
          const currentMethod = getAuthMethod(status)
          const isOAuthActive = oauthState.phase !== 'idle' && oauthState.phase !== 'success'

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
                  {!status.supportsApiKey && status.supportsOAuth && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-purple-400 bg-purple-400/15 px-1.5 py-0.5 rounded">
                      OAuth
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
                  {!status.configured && !isOAuthActive && (
                    <span className="text-xs text-text-tertiary">Not configured</span>
                  )}
                  {isOAuthActive && (
                    <span className="flex items-center gap-1 text-xs text-purple-400">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Signing in...
                    </span>
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
                      {/* Method selector — only shown when provider supports both */}
                      {status.supportsApiKey && status.supportsOAuth && (
                        <div className="flex gap-1 rounded-md border border-border p-0.5 bg-bg-tertiary">
                          <button
                            type="button"
                            onClick={() => setAuthMethods((prev) => ({ ...prev, [status.id]: 'api_key' }))}
                            className={[
                              'flex-1 flex items-center justify-center gap-1.5 text-xs py-1 rounded transition-colors',
                              currentMethod === 'api_key'
                                ? 'bg-bg-primary text-text-primary font-medium shadow-sm'
                                : 'text-text-tertiary hover:text-text-secondary',
                            ].join(' ')}
                          >
                            <Key className="w-3 h-3" />
                            API Key
                          </button>
                          <button
                            type="button"
                            onClick={() => setAuthMethods((prev) => ({ ...prev, [status.id]: 'oauth' }))}
                            className={[
                              'flex-1 flex items-center justify-center gap-1.5 text-xs py-1 rounded transition-colors',
                              currentMethod === 'oauth'
                                ? 'bg-bg-primary text-text-primary font-medium shadow-sm'
                                : 'text-text-tertiary hover:text-text-secondary',
                            ].join(' ')}
                          >
                            <LogIn className="w-3 h-3" />
                            OAuth
                          </button>
                        </div>
                      )}

                      {/* API Key form */}
                      {status.supportsApiKey && (!status.supportsOAuth || currentMethod === 'api_key') && (
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

                      {/* OAuth form */}
                      {status.supportsOAuth && (!status.supportsApiKey || currentMethod === 'oauth') && (
                        <div className="space-y-2">
                          <SettingsOAuthWidget
                            state={oauthState}
                            onStart={() => handleOAuthStart(status.id)}
                            onSubmitCode={(code) => handleOAuthSubmitCode(status.id, code)}
                            onCancel={() => handleOAuthCancel(status.id)}
                          />
                          {/* Remove button for OAuth-configured providers */}
                          {status.removeAllowed && oauthState.phase !== 'running' && oauthState.phase !== 'open_browser' && oauthState.phase !== 'awaiting_input' && oauthState.phase !== 'awaiting_code' && (
                            <div className="flex items-center gap-2 pt-1">
                              {confirmRemove === status.id ? (
                                <div className="flex items-center gap-1.5 text-xs">
                                  <span className="text-text-secondary">Remove credentials?</span>
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
                                  Remove credentials
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
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
// SettingsOAuthWidget — inline OAuth widget for the Settings panel
// ============================================================================

interface SettingsOAuthWidgetProps {
  state: OAuthFlowState
  onStart: () => void
  onSubmitCode: (code: string) => void
  onCancel: () => void
}

function SettingsOAuthWidget({ state, onStart, onSubmitCode, onCancel }: SettingsOAuthWidgetProps) {
  const [codeInput, setCodeInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus the input when waiting for user code
  useEffect(() => {
    if ((state.phase === 'awaiting_input' || state.phase === 'awaiting_code') && inputRef.current) {
      inputRef.current.focus()
    }
  }, [state.phase])

  // Reset code input when phase changes away from input
  useEffect(() => {
    if (state.phase !== 'awaiting_input' && state.phase !== 'awaiting_code') {
      setCodeInput('')
    }
  }, [state.phase])

  const handleSubmit = () => {
    if (!codeInput.trim() && state.phase === 'awaiting_input' && !(state as { allowEmpty?: boolean }).allowEmpty) return
    onSubmitCode(codeInput)
    setCodeInput('')
  }

  switch (state.phase) {
    case 'idle':
      return (
        <Button size="sm" onClick={onStart} className="h-7 text-xs gap-1.5">
          <LogIn className="w-3 h-3" />
          Sign in with OAuth
        </Button>
      )

    case 'running':
      return (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-text-secondary bg-bg-tertiary rounded p-2">
            <Loader2 className="w-3 h-3 animate-spin flex-shrink-0 text-purple-400" />
            <span>{state.message ?? 'Starting OAuth flow...'}</span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-text-tertiary hover:text-text-secondary underline"
          >
            Cancel
          </button>
        </div>
      )

    case 'open_browser':
      return (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-text-secondary bg-bg-tertiary rounded p-2">
            <Loader2 className="w-3 h-3 animate-spin flex-shrink-0 text-purple-400" />
            <span>Opening browser...</span>
          </div>
          {state.instructions && (
            <div className="text-xs font-semibold text-purple-300 bg-purple-400/10 border border-purple-400/20 rounded p-2">
              {state.instructions}
            </div>
          )}
          <p className="text-xs text-text-tertiary break-all">{state.url}</p>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-text-tertiary hover:text-text-secondary underline"
          >
            Cancel
          </button>
        </div>
      )

    case 'awaiting_input':
    case 'awaiting_code': {
      const placeholder = state.placeholder ?? (state.phase === 'awaiting_code' ? 'http://localhost:...' : 'Paste code...')
      const allowEmpty = state.phase === 'awaiting_input' ? ((state as { allowEmpty?: boolean }).allowEmpty ?? false) : false
      const canSubmit = allowEmpty || codeInput.trim().length > 0

      return (
        <div className="space-y-1.5">
          <p className="text-xs text-text-secondary">{state.message}</p>
          <div className="flex gap-1.5">
            <Input
              ref={inputRef}
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder={placeholder}
              className="h-8 font-mono text-sm flex-1"
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
            />
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="h-8 text-xs flex-shrink-0"
            >
              Submit
            </Button>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-text-tertiary hover:text-text-secondary underline"
          >
            Cancel
          </button>
        </div>
      )
    }

    case 'success':
      return (
        <div className="flex items-center gap-2 text-xs text-green-400 bg-green-400/10 rounded p-2">
          <Check className="w-3 h-3 flex-shrink-0" />
          Authentication successful
        </div>
      )

    case 'error':
      return (
        <div className="space-y-1.5">
          <div className="flex items-start gap-2 text-xs text-red-400 bg-red-400/10 rounded p-2">
            <X className="w-3 h-3 flex-shrink-0 mt-0.5" />
            <span>{state.message}</span>
          </div>
          <Button size="sm" onClick={onStart} className="h-7 text-xs gap-1.5">
            <LogIn className="w-3 h-3" />
            Try Again
          </Button>
        </div>
      )
  }
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
// SkillsTab
// ============================================================================

function SkillsTab({
  skills,
  loading,
}: {
  skills: Array<{ name: string; description: string; trigger: string; stepCount: number }>
  loading: boolean
}) {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">Available Skills</h3>
        <p className="text-xs text-text-tertiary mb-4">
          Skills are multi-step workflows invoked with <code className="bg-bg-tertiary px-1 py-0.5 rounded text-accent">/trigger</code> in the chat input.
        </p>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading skills...
        </div>
      ) : skills.length === 0 ? (
        <div className="text-xs text-text-tertiary">No skills available.</div>
      ) : (
        <div className="space-y-2">
          {skills.map((skill) => (
            <div
              key={skill.trigger}
              className="flex items-start gap-3 rounded-lg border border-border bg-bg-secondary px-3 py-2.5"
            >
              <Zap className="w-3.5 h-3.5 flex-shrink-0 text-accent mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{skill.name}</span>
                  <code className="text-xs text-accent bg-accent/10 px-1.5 py-0.5 rounded">/{skill.trigger}</code>
                  <span className="text-xs text-text-tertiary ml-auto">{skill.stepCount} step{skill.stepCount !== 1 ? 's' : ''}</span>
                </div>
                <p className="text-xs text-text-secondary mt-0.5">{skill.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// ShortcutsTab
// ============================================================================

function ShortcutsTab({
  voicePttShortcut,
  onVoicePttShortcutChange,
}: {
  voicePttShortcut: 'space' | 'alt+space' | 'cmd+shift+space'
  onVoicePttShortcutChange: (value: 'space' | 'alt+space' | 'cmd+shift+space') => void
}) {
  const shortcutRows = [
    ...SHORTCUTS.slice(0, 5),
    {
      shortcut: VOICE_SHORTCUT_OPTIONS.find((option) => option.value === voicePttShortcut)?.label ?? 'Hold Space',
      action: 'Push to talk in active pane',
    },
    ...SHORTCUTS.slice(5),
  ]

  return (
    <div className="p-6 space-y-6">
      <Section title="Voice Push-To-Talk">
        <Field
          label="Shortcut"
          hint="Starts voice input while held, then stops when released. Quick taps still type a normal space in the composer."
        >
          <Select value={voicePttShortcut} onValueChange={(value) => onVoicePttShortcutChange(value as 'space' | 'alt+space' | 'cmd+shift+space')}>
            <SelectTrigger className="w-72 h-8 text-sm">
              <SelectValue placeholder="Select a push-to-talk shortcut..." />
            </SelectTrigger>
            <SelectContent>
              {VOICE_SHORTCUT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Section>

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
              {shortcutRows.map((row, i) => (
                <tr
                  key={row.shortcut}
                  className={cn(
                    'transition-colors',
                    i < shortcutRows.length - 1 && 'border-b border-border',
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

// ============================================================================
// RemoteAccessTab
// ============================================================================

interface RemoteAccessTabProps {
  enabled: boolean
  port: number
  token: string
  tailscaleEnabled: boolean
  tailscaleUrl: string | null
  showToken: boolean
  copied: boolean
  onToggle: (enabled: boolean) => void
  onPortChange: (port: number) => void
  onTailscaleToggle: (enabled: boolean) => void
  onRotateToken: () => void
  onCopyToken: () => void
  onToggleShowToken: () => void
}

function RemoteAccessTab({
  enabled,
  port,
  token,
  tailscaleEnabled,
  tailscaleUrl,
  showToken,
  copied,
  onToggle,
  onPortChange,
  onTailscaleToggle,
  onRotateToken,
  onCopyToken,
  onToggleShowToken,
}: RemoteAccessTabProps) {
  const localUrl = `http://localhost:${port}`

  return (
    <div className="p-6 space-y-8">
      <Section title="Remote Access">
        <Field
          label="Enable Remote Access"
          hint="Allow PWA clients (e.g. your phone) to connect to this instance over the network."
        >
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => onToggle(!enabled)}
            className={cn(
              'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg-primary',
              enabled ? 'bg-accent' : 'bg-bg-tertiary border border-border',
            )}
          >
            <span
              className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                enabled ? 'translate-x-4' : 'translate-x-0.5',
              )}
            />
          </button>
        </Field>

        {enabled && (
          <>
            <Field label="Server Port" hint="Port the bridge server listens on (restart required after change).">
              <Input
                type="number"
                min={1024}
                max={65535}
                value={port}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10)
                  if (!isNaN(v) && v >= 1024 && v <= 65535) onPortChange(v)
                }}
                className="w-32 h-7 text-xs font-mono"
              />
            </Field>

            <Field label="Local URL">
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono text-text-secondary bg-bg-tertiary px-2 py-1 rounded border border-border select-all">
                  {localUrl}
                </code>
              </div>
            </Field>

            <Field
              label="Bearer Token"
              hint="Clients must present this token in the Authorization header. Keep it secret."
            >
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    value={token || '(not set — save settings to generate)'}
                    readOnly
                    className="pr-8 text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={onToggleShowToken}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
                  >
                    {showToken ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onCopyToken}
                  className="h-7 text-xs gap-1.5 flex-shrink-0"
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onRotateToken}
                  className="h-7 text-xs gap-1.5 flex-shrink-0"
                  title="Rotate token (disconnects all existing sessions)"
                >
                  <RefreshCw className="w-3 h-3" />
                  Rotate
                </Button>
              </div>
            </Field>
          </>
        )}
      </Section>

      {enabled && (
        <Section title="Tailscale Tunnel">
          <Field
            label="Expose via Tailscale HTTPS"
            hint="Runs `tailscale serve` to give this instance a public HTTPS URL accessible on your tailnet."
          >
            <button
              type="button"
              role="switch"
              aria-checked={tailscaleEnabled}
              onClick={() => onTailscaleToggle(!tailscaleEnabled)}
              className={cn(
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none',
                tailscaleEnabled ? 'bg-accent' : 'bg-bg-tertiary border border-border',
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                  tailscaleEnabled ? 'translate-x-4' : 'translate-x-0.5',
                )}
              />
            </button>
          </Field>

          {tailscaleEnabled && tailscaleUrl && (
            <Field label="Tailscale HTTPS URL">
              <div className="space-y-3">
                <code className="block text-xs font-mono text-text-secondary bg-bg-tertiary px-2 py-1 rounded border border-border select-all">
                  {tailscaleUrl}
                </code>
                <div className="text-xs text-text-tertiary">
                  Scan the QR code below on your phone to open the PWA:
                </div>
                <div className="flex items-center justify-center p-4 bg-white rounded-lg w-36 h-36">
                  {/* QR code placeholder — requires qrcode.react to be installed */}
                  <div className="text-center text-gray-400 text-xs">
                    <div className="text-2xl mb-1">QR</div>
                    <div>qrcode.react</div>
                  </div>
                </div>
              </div>
            </Field>
          )}

          {tailscaleEnabled && !tailscaleUrl && (
            <div className="text-xs text-text-tertiary bg-bg-tertiary border border-border rounded p-3">
              Tailscale URL will appear here once the tunnel is active. Make sure Tailscale is installed and signed in.
            </div>
          )}
        </Section>
      )}

      <Section title="Connecting from your phone">
        <div className="text-xs text-text-secondary space-y-2 bg-bg-tertiary rounded-lg p-4 border border-border">
          <p className="font-medium text-text-primary">How to connect:</p>
          <ol className="list-decimal list-inside space-y-1 text-text-tertiary">
            <li>Enable Remote Access above and note the server URL</li>
            <li>Open the URL on your phone and enter the Bearer Token when prompted</li>
            <li>Or use the Tailscale HTTPS URL if on your tailnet</li>
            <li>Bookmark the page and add it to your home screen as a PWA</li>
          </ol>
          <p className="text-text-tertiary pt-1">
            The PWA provides read access to your agent sessions. Terminal and folder picker are not available remotely.
          </p>
        </div>
      </Section>
    </div>
  )
}
