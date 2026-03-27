/**
 * Onboarding — full-screen first-run overlay.
 *
 * Shown when settings.onboardingComplete is false/missing.
 * Three steps:
 *   1. Welcome — intro screen
 *   2. API Key Setup — optional Tavily key entry
 *   3. Ready — completion screen
 *
 * On completion sets onboardingComplete: true via bridge.setSettings().
 */

import { useState } from 'react'
import { Key, ArrowRight, Check, Sparkles } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Eye, EyeOff } from 'lucide-react'

// ============================================================================
// Types
// ============================================================================

interface OnboardingProps {
  onComplete: () => void
}

type Step = 1 | 2 | 3

// ============================================================================
// Onboarding
// ============================================================================

export function Onboarding({ onComplete }: OnboardingProps) {
  const bridge = window.bridge

  const [step, setStep] = useState<Step>(1)
  const [tavilyKey, setTavilyKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)

  // -------------------------------------------------------------------------
  // Step navigation
  // -------------------------------------------------------------------------

  const handleGetStarted = () => setStep(2)

  const handleApiKeyContinue = async () => {
    if (tavilyKey.trim()) {
      try {
        await bridge.setSettings({ tavilyApiKey: tavilyKey.trim() })
      } catch {
        // Non-fatal — user can set it later in Settings
      }
    }
    setStep(3)
  }

  const handleSkip = () => setStep(3)

  const handleFinish = async () => {
    setSaving(true)
    try {
      await bridge.setSettings({ onboardingComplete: true })
    } catch {
      // Best-effort
    } finally {
      setSaving(false)
      onComplete()
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-bg-primary">
      {/* Step indicator */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2">
        {([1, 2, 3] as Step[]).map((s) => (
          <div
            key={s}
            className={[
              'h-1.5 rounded-full transition-all duration-300',
              step === s
                ? 'w-6 bg-accent'
                : step > s
                  ? 'w-4 bg-accent/40'
                  : 'w-4 bg-bg-tertiary',
            ].join(' ')}
          />
        ))}
      </div>

      {/* Step content */}
      <div className="w-full max-w-md mx-auto px-8">
        {step === 1 && (
          <WelcomeStep onGetStarted={handleGetStarted} />
        )}
        {step === 2 && (
          <ApiKeyStep
            tavilyKey={tavilyKey}
            onTavilyKeyChange={setTavilyKey}
            showKey={showKey}
            onToggleShow={() => setShowKey((v) => !v)}
            onContinue={handleApiKeyContinue}
            onSkip={handleSkip}
          />
        )}
        {step === 3 && (
          <ReadyStep onFinish={handleFinish} saving={saving} />
        )}
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
      {/* Icon */}
      <div className="mx-auto w-16 h-16 rounded-2xl bg-accent/15 flex items-center justify-center">
        <Sparkles className="w-8 h-8 text-accent" />
      </div>

      {/* Heading */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-text-primary">
          Welcome to Lucent Chat
        </h1>
        <p className="text-sm text-text-secondary leading-relaxed">
          Your desktop AI assistant — powered by Claude and designed for productivity.
          Let's get you set up in a few quick steps.
        </p>
      </div>

      {/* CTA */}
      <Button
        size="lg"
        onClick={onGetStarted}
        className="w-full gap-2"
      >
        Get Started
        <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  )
}

// ============================================================================
// ApiKeyStep
// ============================================================================

interface ApiKeyStepProps {
  tavilyKey: string
  onTavilyKeyChange: (v: string) => void
  showKey: boolean
  onToggleShow: () => void
  onContinue: () => void
  onSkip: () => void
}

function ApiKeyStep({
  tavilyKey,
  onTavilyKeyChange,
  showKey,
  onToggleShow,
  onContinue,
  onSkip,
}: ApiKeyStepProps) {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      {/* Icon + heading */}
      <div className="text-center space-y-2">
        <div className="mx-auto w-12 h-12 rounded-xl bg-accent/15 flex items-center justify-center">
          <Key className="w-6 h-6 text-accent" />
        </div>
        <h2 className="text-xl font-semibold text-text-primary">API Key Setup</h2>
        <p className="text-sm text-text-secondary leading-relaxed">
          This enables web search capabilities. You can skip and add it later in{' '}
          <kbd className="font-mono text-xs bg-bg-secondary border border-border rounded px-1 py-0.5 text-text-tertiary">
            ⌘,
          </kbd>
          {' '}Settings.
        </p>
      </div>

      {/* Tavily key field */}
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
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onContinue()
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

      {/* Buttons */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={onSkip}
          className="flex-1 border-border text-text-secondary hover:text-text-primary"
        >
          Skip for now
        </Button>
        <Button
          onClick={() => void onContinue()}
          className="flex-1 gap-2"
        >
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
      {/* Icon */}
      <div className="mx-auto w-16 h-16 rounded-2xl bg-green-500/15 flex items-center justify-center">
        <Check className="w-8 h-8 text-green-400" />
      </div>

      {/* Heading */}
      <div className="space-y-3">
        <h2 className="text-2xl font-bold text-text-primary">You're all set!</h2>
        <p className="text-sm text-text-secondary leading-relaxed">
          Lucent Chat is ready to go. You can update your API keys and preferences
          anytime by pressing{' '}
          <kbd className="font-mono text-xs bg-bg-secondary border border-border rounded px-1.5 py-0.5 text-text-tertiary">
            ⌘,
          </kbd>
          .
        </p>
      </div>

      {/* Tips */}
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

      {/* CTA */}
      <Button
        size="lg"
        onClick={onFinish}
        disabled={saving}
        className="w-full gap-2"
      >
        {saving ? 'Starting...' : 'Start Chatting'}
        {!saving && <ArrowRight className="w-4 h-4" />}
      </Button>
    </div>
  )
}
