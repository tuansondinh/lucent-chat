/**
 * UpdateBanner — shows a toast when a new version has been downloaded and is
 * ready to install.  Uses Sonner's persistent toast with an "Install now"
 * action button.
 *
 * Mount this once near the top of the component tree (e.g. in App.tsx).
 * It manages its own subscriptions and is a pure side-effect component
 * (renders nothing itself — Toaster is already rendered by App).
 */

import { useEffect } from 'react'
import { toast } from 'sonner'
import { getCapabilities } from '../lib/capabilities'

export function UpdateBanner(): null {
  const caps = getCapabilities()

  useEffect(() => {
    // Only available inside Electron
    if (!caps.isElectron) return

    const bridge = (window as any).bridge

    // Update available — brief informational toast
    const unsubAvailable = bridge?.onUpdateAvailable?.(
      (info: { version: string }) => {
        toast.info(`Update v${info.version} found`, {
          description: 'Downloading in the background…',
          duration: 5_000,
        })
      },
    )

    // Update downloaded — persistent toast with install action
    const unsubDownloaded = bridge?.onUpdateDownloaded?.(
      (info: { version: string }) => {
        toast.success(`v${info.version} ready to install`, {
          description: 'Restart Lucent Code to apply the update.',
          duration: Infinity,
          action: {
            label: 'Restart now',
            onClick: () => {
              bridge.updaterInstallNow?.().catch((err: Error) =>
                console.warn('[updater] install-now failed:', err.message),
              )
            },
          },
        })
      },
    )

    return () => {
      unsubAvailable?.()
      unsubDownloaded?.()
    }
  }, [caps.isElectron])

  return null
}
