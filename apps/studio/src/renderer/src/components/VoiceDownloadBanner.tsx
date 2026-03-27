/**
 * VoiceDownloadBanner — shows non-intrusive banner on first startup when downloading voice models
 *
 * This banner only appears on the very first app launch when voice models need to be
 * downloaded (~1GB). Once models are cached, the banner will not appear on subsequent startups.
 */

interface Props {
  show: boolean
  state: 'starting' | 'ready' | 'error'
  error?: string
}

export function VoiceDownloadBanner({ show, state, error }: Props) {
  // Don't show banner when service is ready or when we shouldn't show at all
  if (!show || state === 'ready') return null

  return (
    <div className="mx-4 mt-2 px-3 py-2 bg-accent/10 border border-accent/30 rounded-lg flex items-center gap-3 text-sm">
      {/* Spinner */}
      {state === 'starting' && (
        <svg className="h-4 w-4 animate-spin text-accent" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
          <path d="M8 2.5A5.5 5.5 0 0 1 13.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}

      {/* Icon for error */}
      {state === 'error' && (
        <svg className="h-4 w-4 text-red-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3M8 10v.01" strokeLinecap="round" />
        </svg>
      )}

      {/* Message */}
      <div className="flex-1 text-text-secondary">
        {state === 'starting' && (
          <span>Downloading voice models (~1GB). This only happens once…</span>
        )}
        {state === 'error' && (
          <span className="text-red-400">Voice service unavailable: {error || 'Unknown error'}</span>
        )}
      </div>

      {/* No dismiss button — banner dismisses automatically when state changes */}
    </div>
  )
}
