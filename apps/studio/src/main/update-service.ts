/**
 * UpdateService — wraps electron-updater for automatic app updates.
 *
 * - Checks GitHub Releases for a newer version on startup (production only)
 * - Downloads the update silently in the background
 * - Notifies the renderer when an update is available / downloaded
 * - Supports a "quit and install" command from the renderer
 */

import { app } from 'electron'
import { createRequire } from 'node:module'

type BrowserWindow = import('electron').BrowserWindow

// electron-updater is a CommonJS module — load it via createRequire so it
// works inside our ESM main process build.
const require = createRequire(import.meta.url)

let _autoUpdater: any | null = null
function getAutoUpdater(): any {
  if (!_autoUpdater) {
    _autoUpdater = require('electron-updater').autoUpdater
  }
  return _autoUpdater
}

export interface UpdateInfo {
  version: string
  releaseNotes?: string | null
}

export class UpdateService {
  private getWindow: () => BrowserWindow | null

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow

    const autoUpdater = getAutoUpdater()

    // Download silently — don't interrupt the user until it's ready
    autoUpdater.autoDownload = true
    // Install automatically when the user quits the app
    autoUpdater.autoInstallOnAppQuit = true
    // Log update events for debugging
    autoUpdater.logger = {
      info:  (msg: string) => console.log(`[updater] ${msg}`),
      warn:  (msg: string) => console.warn(`[updater] ${msg}`),
      error: (msg: string) => console.error(`[updater] ${msg}`),
      debug: (_msg: string) => { /* suppress verbose debug */ },
    }

    autoUpdater.on('checking-for-update', () => {
      console.log('[updater] checking for update…')
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      console.log('[updater] update available:', info.version)
      this.send('event:update-available', info)
    })

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      console.log('[updater] already up to date:', info.version)
    })

    autoUpdater.on('download-progress', (progress: { percent: number }) => {
      console.log(`[updater] download progress: ${Math.round(progress.percent)}%`)
      this.send('event:update-progress', { percent: progress.percent })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      console.log('[updater] update downloaded:', info.version)
      this.send('event:update-downloaded', info)
    })

    autoUpdater.on('error', (err: Error) => {
      console.warn('[updater] error:', err.message)
    })
  }

  /** Check for updates. No-op in development (app.isPackaged = false). */
  checkForUpdates(): void {
    if (!app.isPackaged) {
      console.log('[updater] skipping update check in dev mode')
      return
    }
    getAutoUpdater()
      .checkForUpdatesAndNotify()
      .catch((err: Error) => console.warn('[updater] check failed:', err.message))
  }

  /** Quit the app and immediately install the downloaded update. */
  quitAndInstall(): void {
    getAutoUpdater().quitAndInstall()
  }

  private send(channel: string, data: unknown): void {
    const win = this.getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }
}
