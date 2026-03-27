import { watch, type FSWatcher } from 'node:fs'

export interface FileChangeRecord {
  relativePath: string | null
  eventType: 'change' | 'rename' | 'root'
}

interface WatchState {
  rootPath: string
  watcher: FSWatcher
  pendingChanges: Map<string, FileChangeRecord>
  flushTimer: ReturnType<typeof setTimeout> | null
}

export class FileWatchService {
  private readonly watchers = new Map<string, WatchState>()

  constructor(
    private readonly pushEvent: (channel: string, data: unknown) => void,
  ) {}

  watchPane(paneId: string, rootPath: string): void {
    const existing = this.watchers.get(paneId)
    if (existing?.rootPath === rootPath) return

    this.unwatchPane(paneId)

    try {
      const watcher = watch(rootPath, { recursive: true }, (eventType, filename) => {
        const normalized = this.normalizeFilename(filename)
        this.enqueueChange(paneId, {
          relativePath: normalized,
          eventType: eventType === 'rename' ? 'rename' : 'change',
        })
      })

      watcher.on('error', (err) => {
        console.warn(`[file-watch] watcher error for ${paneId}:`, err.message)
      })

      this.watchers.set(paneId, {
        rootPath,
        watcher,
        pendingChanges: new Map(),
        flushTimer: null,
      })
    } catch (err) {
      console.warn(
        `[file-watch] failed to watch ${paneId}:`,
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  notifyRootChanged(paneId: string): void {
    this.enqueueChange(paneId, { relativePath: null, eventType: 'root' })
  }

  unwatchPane(paneId: string): void {
    const state = this.watchers.get(paneId)
    if (!state) return
    if (state.flushTimer) clearTimeout(state.flushTimer)
    state.watcher.close()
    this.watchers.delete(paneId)
  }

  shutdown(): void {
    for (const paneId of this.watchers.keys()) {
      this.unwatchPane(paneId)
    }
  }

  private enqueueChange(paneId: string, change: FileChangeRecord): void {
    const state = this.watchers.get(paneId)
    if (!state) {
      if (change.eventType === 'root') {
        this.pushEvent('event:file-changed', { paneId, changes: [change] })
      }
      return
    }

    const key = `${change.eventType}:${change.relativePath ?? '__root__'}`
    state.pendingChanges.set(key, change)

    if (state.flushTimer) clearTimeout(state.flushTimer)
    state.flushTimer = setTimeout(() => {
      const current = this.watchers.get(paneId)
      if (!current) return
      const changes = Array.from(current.pendingChanges.values())
      current.pendingChanges.clear()
      current.flushTimer = null
      if (changes.length > 0) {
        this.pushEvent('event:file-changed', { paneId, changes })
      }
    }, 120)
  }

  private normalizeFilename(filename: string | Buffer | null): string | null {
    if (filename == null) return null
    const value = typeof filename === 'string' ? filename : filename.toString('utf8')
    const trimmed = value.trim()
    if (!trimmed) return null
    return trimmed.replace(/\\/g, '/')
  }
}
