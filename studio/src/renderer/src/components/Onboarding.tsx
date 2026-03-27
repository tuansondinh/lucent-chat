/**
 * Onboarding — full-screen first-run overlay.
 *
 * Four steps:
 *   1. Welcome          — intro screen
 *   2. LLM Provider     — required: configure at least one API key or OAuth
 *   3. Tavily           — optional web-search key
 *   4. Ready            — completion screen
 *
 * On completion sets onboardingComplete: true via bridge.setSettings().
 */

import { useState, useEffect, useRef } from 'react'
import {
  Key, ArrowRight, Check, Sparkles, ChevronDown, ChevronUp,
  Loader2, Eye, EyeOff, Globe, Lock, LogIn, X,
} from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'

// ============================================================================
// Types
// ============================================================================

interface OnboardingProps {
  onComplete: () => void
}

type Step = 1 | 2 | 3 | 4

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

interface ProviderCatalogEntry {
  id: string
  label: string
  keyPlaceholder?: string
  recommended?: boolean
  supportsApiKey: boolean
  supportsOAuth: boolean
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
// Onboarding
// ============================================================================

export function Onboarding({ onComplete }: OnboardingProps) {
  const bridge = window.bridge

  const [step, setStep] = useState<Step>(1)
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>([])
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([])
  const [tavilyKey, setTavilyKey] = useState('')
  const [showTavilyKey, setShowTavilyKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [restarting, setRestarting] = useState(false)

  // Load catalog on mount so it's ready when step 2 renders
  useEffect(() => {
    bridge.getProviderCatalog()
      .then((c) => setCatalog(c as ProviderCatalogEntry[]))
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to health events while agent is restarting after a key save
  useEffect(() => {
    if (!restarting) return
    const unsub = bridge.onHealth((data) => {
      if (data.paneId === 'pane-0' && data.states.agent === 'ready') {
        setRestarting(false)
      }
    })
    const fallback = setTimeout(() => setRestarting(false), 10_000)
    return () => { unsub(); clearTimeout(fallback) }
  }, [restarting]) // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Step navigation
  // -------------------------------------------------------------------------

  const handleGetStarted = () => {
    bridge.getProviderAuthStatus()
      .then((s) => setProviderStatuses(s as ProviderStatus[]))
      .catch(() => {})
    setStep(2)
  }

  const handleProviderStatusUpdate = (statuses: ProviderStatus[]) => {
    setProviderStatuses(statuses)
    setRestarting(true)
  }

  const handleTavilyContinue = async () => {
    if (tavilyKey.trim()) {
      try { await bridge.setSettings({ tavilyApiKey: tavilyKey.trim() }) } catch { /* non-fatal */ }
    }
    setStep(4)
  }

  const handleFinish = async () => {
    setSaving(true)
    try { await bridge.setSettings({ onboardingComplete: true }) } catch { /* best-effort */ }
    setSaving(false)
    onComplete()
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const stepNums: Step[] = [1, 2, 3, 4]

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-bg-primary">
      {/* Step dots */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2">
        {stepNums.map((s) => (
          <div
            key={s}
            className={[
              'h-1.5 rounded-full transition-all duration-300',
              step === s ? 'w-6 bg-accent' : step > s ? 'w-4 bg-accent/40' : 'w-4 bg-bg-tertiary',
            ].join(' ')}
          />
        ))}
      </div>

      <div className="w-full max-w-lg mx-auto px-8">
        {step === 1 && <WelcomeStep onGetStarted={handleGetStarted} />}
        {step === 2 && (
          <ProviderSetupStep
            catalog={catalog}
            providerStatuses={providerStatuses}
            restarting={restarting}
            onStatusUpdate={handleProviderStatusUpdate}
            onContinue={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <TavilyStep
            tavilyKey={tavilyKey}
            onTavilyKeyChange={setTavilyKey}
            showKey={showTavilyKey}
            onToggleShow={() => setShowTavilyKey((v) => !v)}
            onContinue={() => void handleTavilyContinue()}
            onSkip={() => setStep(4)}
          />
        )}
        {step === 4 && <ReadyStep onFinish={() => void handleFinish()} saving={saving} />}
      </div>
    </div>
  )
}

// ============================================================================
// WelcomeStep
// ============================================================================

function WelcomeStep({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <div className="text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="mx-auto w-16 h-16 rounded-2xl bg-accent/15 flex items-center justify-center">
        <Sparkles className="w-8 h-8 text-accent" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-text-primary">Welcome to Lucent Chat</h1>
        <p className="text-sm text-text-secondary leading-relaxed">
          Your desktop AI assistant — powered by Claude and designed for productivity.
          Let's get you set up in a few quick steps.
        </p>
      </div>
      <Button size="lg" onClick={onGetStarted} className="w-full gap-2">
        Get Started
        <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  )
}

// ============================================================================
// ProviderSetupStep
// ============================================================================

interface ProviderSetupStepProps {
  catalog: ProviderCatalogEntry[]
  providerStatuses: ProviderStatus[]
  restarting: boolean
  onStatusUpdate: (statuses: ProviderStatus[]) => void
  onContinue: () => void
}

function ProviderSetupStep({
  catalog, providerStatuses, restarting, onStatusUpdate, onContinue,
}: ProviderSetupStepProps) {
  const bridge = window.bridge

  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})
  const [showKeyFor, setShowKeyFor] = useState<Record<string, boolean>>({})
  const [savingProvider, setSavingProvider] = useState<string | null>(null)
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({})
  const [oauthStates, setOAuthStates] = useState<Record<string, OAuthFlowState>>({})

  const anyConfigured = providerStatuses.some((s) => s.configured)

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

  const handleSave = async (providerId: string) => {
    const key = (keyInputs[providerId] ?? '').trim()
    if (!key) return
    setSavingProvider(providerId)
    setSaveErrors((prev) => ({ ...prev, [providerId]: '' }))
    try {
      const result = await bridge.validateAndSaveProviderKey(providerId, key)
      if (result.ok) {
        onStatusUpdate(result.providerStatuses as ProviderStatus[])
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

  const handleOAuthStart = (providerId: string) => {
    if (typeof bridge.oauthStart !== 'function') return
    setOAuthStates((prev) => ({ ...prev, [providerId]: { phase: 'running' } }))
    bridge.oauthStart(providerId)
      .then((result) => {
        if (result.ok) {
          onStatusUpdate(result.providerStatuses as ProviderStatus[])
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

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="text-center space-y-1.5">
        <div className="mx-auto w-12 h-12 rounded-xl bg-accent/15 flex items-center justify-center">
          <Key className="w-6 h-6 text-accent" />
        </div>
        <h2 className="text-xl font-semibold text-text-primary">Connect an AI Provider</h2>
        <p className="text-sm text-text-secondary leading-relaxed">
          Add at least one API key or sign in with OAuth to start chatting. Keys are stored in{' '}
          <span className="font-mono text-xs text-text-tertiary bg-bg-secondary px-1 py-0.5 rounded">
            ~/.lucent/agent/auth.json
          </span>
          .
        </p>
      </div>

      {/* Provider cards */}
      {catalog.length === 0 ? (
        <div className="flex items-center justify-center py-6 text-text-tertiary text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading providers...
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-0.5">
          {catalog.map((entry) => {
            const status = providerStatuses.find((s) => s.id === entry.id) ?? null
            const oauthState = oauthStates[entry.id] ?? { phase: 'idle' }
            return (
              <ProviderCard
                key={entry.id}
                entry={entry}
                status={status}
                isExpanded={expandedProvider === entry.id}
                isSaving={savingProvider === entry.id}
                error={saveErrors[entry.id] ?? ''}
                keyValue={keyInputs[entry.id] ?? ''}
                showKey={showKeyFor[entry.id] ?? false}
                oauthState={oauthState}
                onToggleExpand={() =>
                  setExpandedProvider((prev) => {
                    setSaveErrors((e) => ({ ...e, [entry.id]: '' }))
                    return prev === entry.id ? null : entry.id
                  })
                }
                onKeyChange={(v) => setKeyInputs((prev) => ({ ...prev, [entry.id]: v }))}
                onToggleShowKey={() =>
                  setShowKeyFor((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))
                }
                onSave={() => void handleSave(entry.id)}
                onOAuthStart={() => handleOAuthStart(entry.id)}
                onOAuthSubmitCode={(code) => handleOAuthSubmitCode(entry.id, code)}
                onOAuthCancel={() => handleOAuthCancel(entry.id)}
              />
            )
          })}
        </div>
      )}

      {/* Restart banner */}
      {restarting && (
        <div className="flex items-center gap-2 text-xs text-text-secondary bg-bg-secondary rounded-lg px-3 py-2.5 border border-border">
          <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0 text-accent" />
          Restarting agent with new credentials...
        </div>
      )}

      <Button size="lg" onClick={onContinue} disabled={!anyConfigured} className="w-full gap-2">
        {anyConfigured ? 'Continue' : 'Add a key to continue'}
        {anyConfigured && <ArrowRight className="w-4 h-4" />}
      </Button>
    </div>
  )
}

// ============================================================================
// ProviderCard
// ============================================================================

interface ProviderCardProps {
  entry: ProviderCatalogEntry
  status: ProviderStatus | null
  isExpanded: boolean
  isSaving: boolean
  error: string
  keyValue: string
  showKey: boolean
  oauthState: OAuthFlowState
  onToggleExpand: () => void
  onKeyChange: (v: string) => void
  onToggleShowKey: () => void
  onSave: () => void
  onOAuthStart: () => void
  onOAuthSubmitCode: (code: string) => void
  onOAuthCancel: () => void
}

function ProviderCard({
  entry, status, isExpanded, isSaving, error,
  keyValue, showKey, oauthState,
  onToggleExpand, onKeyChange, onToggleShowKey, onSave,
  onOAuthStart, onOAuthSubmitCode, onOAuthCancel,
}: ProviderCardProps) {
  const configured = status?.configured ?? false
  const configuredVia = status?.configuredVia ?? null

  // When provider supports both methods, track which one the user wants to use
  const [authMethod, setAuthMethod] = useState<'api_key' | 'oauth'>(
    entry.supportsApiKey ? 'api_key' : 'oauth'
  )

  const isOAuthActive = oauthState.phase !== 'idle' && oauthState.phase !== 'success'

  return (
    <div
      className={[
        'rounded-lg border transition-colors',
        configured
          ? 'border-accent/40 bg-accent/5'
          : isExpanded
            ? 'border-border bg-bg-secondary'
            : 'border-border bg-bg-primary hover:bg-bg-hover',
      ].join(' ')}
    >
      {/* Header */}
      <button
        type="button"
        onClick={onToggleExpand}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">{entry.label}</span>
          {entry.recommended && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-accent bg-accent/15 px-1.5 py-0.5 rounded">
              Recommended
            </span>
          )}
          {!entry.supportsApiKey && entry.supportsOAuth && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-purple-400 bg-purple-400/15 px-1.5 py-0.5 rounded">
              OAuth
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(configured || oauthState.phase === 'success') && configuredVia === 'auth_file' && (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <Check className="w-3.5 h-3.5" />
              Added
            </span>
          )}
          {configured && configuredVia === 'environment' && (
            <span className="flex items-center gap-1 text-xs text-blue-400">
              <Globe className="w-3.5 h-3.5" />
              via env
            </span>
          )}
          {!configured && oauthState.phase !== 'success' && (
            <span className="text-xs text-text-tertiary">Not configured</span>
          )}
          {isOAuthActive && (
            <span className="flex items-center gap-1 text-xs text-purple-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Signing in...
            </span>
          )}
          {isExpanded
            ? <ChevronUp className="w-4 h-4 text-text-tertiary" />
            : <ChevronDown className="w-4 h-4 text-text-tertiary" />
          }
        </div>
      </button>

      {/* Inline form */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3">
          {configuredVia === 'environment' ? (
            <div className="flex items-center gap-2 text-xs text-text-secondary bg-bg-tertiary rounded p-2.5">
              <Lock className="w-3.5 h-3.5 flex-shrink-0" />
              Configured via environment variable — managed outside the app.
            </div>
          ) : (
            <>
              {/* Method selector — only shown when provider supports both */}
              {entry.supportsApiKey && entry.supportsOAuth && (
                <div className="flex gap-1 rounded-md border border-border p-0.5 bg-bg-tertiary">
                  <button
                    type="button"
                    onClick={() => setAuthMethod('api_key')}
                    className={[
                      'flex-1 flex items-center justify-center gap-1.5 text-xs py-1 rounded transition-colors',
                      authMethod === 'api_key'
                        ? 'bg-bg-primary text-text-primary font-medium shadow-sm'
                        : 'text-text-tertiary hover:text-text-secondary',
                    ].join(' ')}
                  >
                    <Key className="w-3 h-3" />
                    API Key
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthMethod('oauth')}
                    className={[
                      'flex-1 flex items-center justify-center gap-1.5 text-xs py-1 rounded transition-colors',
                      authMethod === 'oauth'
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
              {entry.supportsApiKey && (!entry.supportsOAuth || authMethod === 'api_key') && (
                <>
                  <div className="relative">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      value={keyValue}
                      onChange={(e) => onKeyChange(e.target.value)}
                      placeholder={entry.keyPlaceholder ?? 'Paste your API key...'}
                      className="pr-9 font-mono text-sm"
                      disabled={isSaving}
                      onKeyDown={(e) => { if (e.key === 'Enter') onSave() }}
                    />
                    <button
                      type="button"
                      onClick={onToggleShowKey}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
                      tabIndex={-1}
                    >
                      {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {error && <p className="text-xs text-red-400">{error}</p>}
                  <Button
                    size="sm"
                    onClick={onSave}
                    disabled={isSaving || !keyValue.trim()}
                    className="w-full gap-2"
                  >
                    {isSaving ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" />Validating...</>
                    ) : (
                      'Validate & Save'
                    )}
                  </Button>
                </>
              )}

              {/* OAuth form */}
              {entry.supportsOAuth && (!entry.supportsApiKey || authMethod === 'oauth') && (
                <OAuthWidget
                  state={oauthState}
                  onStart={onOAuthStart}
                  onSubmitCode={onOAuthSubmitCode}
                  onCancel={onOAuthCancel}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// OAuthWidget — renders the appropriate UI for each OAuth flow phase
// ============================================================================

interface OAuthWidgetProps {
  state: OAuthFlowState
  onStart: () => void
  onSubmitCode: (code: string) => void
  onCancel: () => void
}

function OAuthWidget({ state, onStart, onSubmitCode, onCancel }: OAuthWidgetProps) {
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
        <Button size="sm" onClick={onStart} className="w-full gap-2">
          <LogIn className="w-3.5 h-3.5" />
          Sign in with OAuth
        </Button>
      )

    case 'running':
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-text-secondary bg-bg-tertiary rounded p-2.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0 text-purple-400" />
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
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-text-secondary bg-bg-tertiary rounded p-2.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0 text-purple-400" />
            <span>Opening browser...</span>
          </div>
          {state.instructions && (
            <div className="text-xs font-semibold text-purple-300 bg-purple-400/10 border border-purple-400/20 rounded p-2.5">
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
        <div className="space-y-2">
          <p className="text-xs text-text-secondary">{state.message}</p>
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder={placeholder}
              className="font-mono text-sm flex-1"
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
            />
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="gap-1.5 flex-shrink-0"
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
        <div className="flex items-center gap-2 text-xs text-green-400 bg-green-400/10 rounded p-2.5">
          <Check className="w-3.5 h-3.5 flex-shrink-0" />
          Authentication successful
        </div>
      )

    case 'error':
      return (
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-xs text-red-400 bg-red-400/10 rounded p-2.5">
            <X className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{state.message}</span>
          </div>
          <Button size="sm" onClick={onStart} className="w-full gap-2">
            <LogIn className="w-3.5 h-3.5" />
            Try Again
          </Button>
        </div>
      )
  }
}

// ============================================================================
// TavilyStep
// ============================================================================

interface TavilyStepProps {
  tavilyKey: string
  onTavilyKeyChange: (v: string) => void
  showKey: boolean
  onToggleShow: () => void
  onContinue: () => void
  onSkip: () => void
}

function TavilyStep({
  tavilyKey, onTavilyKeyChange, showKey, onToggleShow, onContinue, onSkip,
}: TavilyStepProps) {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="text-center space-y-2">
        <div className="mx-auto w-12 h-12 rounded-xl bg-accent/15 flex items-center justify-center">
          <Globe className="w-6 h-6 text-accent" />
        </div>
        <h2 className="text-xl font-semibold text-text-primary">Web Search</h2>
        <p className="text-sm text-text-secondary leading-relaxed">
          Optional: add a Tavily key to enable web search. You can skip and add it later in{' '}
          <kbd className="font-mono text-xs bg-bg-secondary border border-border rounded px-1 py-0.5 text-text-tertiary">
            ⌘,
          </kbd>{' '}
          Settings.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-text-primary block">
          Tavily API key{' '}
          <span className="text-text-tertiary font-normal">(optional)</span>
        </label>
        <div className="relative">
          <Input
            type={showKey ? 'text' : 'password'}
            value={tavilyKey}
            onChange={(e) => onTavilyKeyChange(e.target.value)}
            placeholder="tvly-..."
            className="pr-9 font-mono text-sm"
            onKeyDown={(e) => { if (e.key === 'Enter') onContinue() }}
          />
          <button
            type="button"
            onClick={onToggleShow}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
            tabIndex={-1}
          >
            {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <p className="text-xs text-text-tertiary">
          Get a free key at{' '}
          <a
            href="https://tavily.com"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            tavily.com
          </a>
        </p>
      </div>

      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={onSkip}
          className="flex-1 border-border text-text-secondary hover:text-text-primary"
        >
          Skip for now
        </Button>
        <Button onClick={onContinue} className="flex-1 gap-2">
          Continue
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}

// ============================================================================
// ReadyStep
// ============================================================================

function ReadyStep({ onFinish, saving }: { onFinish: () => void; saving: boolean }) {
  return (
    <div className="text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="mx-auto w-16 h-16 rounded-2xl bg-green-500/15 flex items-center justify-center">
        <Check className="w-8 h-8 text-green-400" />
      </div>
      <div className="space-y-3">
        <h2 className="text-2xl font-bold text-text-primary">You're all set!</h2>
        <p className="text-sm text-text-secondary leading-relaxed">
          Lucent Chat is ready to go. Update your API keys and preferences anytime by pressing{' '}
          <kbd className="font-mono text-xs bg-bg-secondary border border-border rounded px-1.5 py-0.5 text-text-tertiary">
            ⌘,
          </kbd>
          .
        </p>
      </div>
      <div className="rounded-xl border border-border bg-bg-secondary p-4 text-left space-y-2">
        <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">
          Quick tips
        </p>
        {[
          { key: '⌘K', tip: 'Open command palette' },
          { key: '⌘N', tip: 'Start a new session' },
          { key: '⌘M', tip: 'Switch AI model' },
        ].map(({ key, tip }) => (
          <div key={key} className="flex items-center gap-3 text-sm">
            <kbd className="font-mono text-xs bg-bg-tertiary border border-border rounded px-1.5 py-0.5 text-text-secondary w-10 text-center flex-shrink-0">
              {key}
            </kbd>
            <span className="text-text-secondary">{tip}</span>
          </div>
        ))}
      </div>
      <Button size="lg" onClick={onFinish} disabled={saving} className="w-full gap-2">
        {saving ? 'Starting...' : 'Start Chatting'}
        {!saving && <ArrowRight className="w-4 h-4" />}
      </Button>
    </div>
  )
}
