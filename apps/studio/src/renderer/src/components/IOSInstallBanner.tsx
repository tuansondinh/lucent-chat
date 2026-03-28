/**
 * IOSInstallBanner — shown on iOS Safari when the app is not running in standalone
 * (home screen) mode. Instructs the user to tap Share → Add to Home Screen.
 *
 * Dismissal is remembered in localStorage under 'lc_ios_install_dismissed'.
 */

import { useState, useEffect } from 'react'
import { Share, X } from 'lucide-react'
import { shouldShowIOSInstallPrompt } from '../lib/capabilities'

const DISMISSED_KEY = 'lc_ios_install_dismissed'

export function IOSInstallBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Only show if the iOS install prompt condition is met AND the user hasn't dismissed it
    const alreadyDismissed = (() => {
      try { return localStorage.getItem(DISMISSED_KEY) === 'true' } catch { return false }
    })()

    if (!alreadyDismissed && shouldShowIOSInstallPrompt()) {
      setVisible(true)
    }
  }, [])

  const handleDismiss = () => {
    setVisible(false)
    try { localStorage.setItem(DISMISSED_KEY, 'true') } catch { /* ignore */ }
  }

  if (!visible) return null

  return (
    <div
      role="banner"
      aria-label="Add to Home Screen instructions"
      className="flex items-start gap-3 px-4 py-3 bg-bg-secondary border-b border-border text-sm text-text-secondary"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
    >
      {/* Share icon to hint at the Share button location */}
      <Share className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />

      <p className="flex-1 leading-snug">
        <span className="font-medium text-text-primary">Install Lucent Code</span>
        <br />
        Tap the{' '}
        <Share className="inline w-3.5 h-3.5 align-[-2px]" aria-hidden="true" />{' '}
        <strong className="text-text-primary">Share</strong> button then{' '}
        <strong className="text-text-primary">Add to Home Screen</strong>.
      </p>

      <button
        aria-label="Dismiss install banner"
        onClick={handleDismiss}
        className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg hover:bg-bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
