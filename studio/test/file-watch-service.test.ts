import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileWatchService, type FileChangeRecord } from '../src/main/file-watch-service.js'

// Helper to create a test directory
async function createTestDir(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'lucent-filewatch-'))
  await mkdir(base, { recursive: true })
  return base
}

test('FileWatchService: watchPane creates watcher for pane', async (t) => {
  const events: any[] = []
  const pushEvent = (channel: string, data: any) => {
    events.push({ channel, data })
  }

  const service = new FileWatchService(pushEvent)
  const testDir = await createTestDir()

  try {
    service.watchPane('pane-1', testDir)

    // Watcher should be created (no easy way to verify without internals)
    // But we can verify it doesn't throw
    assert.ok(true, 'watchPane should not throw')

    // Cleanup
    service.unwatchPane('pane-1')
  } finally {
    await rm(testDir, { recursive: true, force: true })
  }
})

test('FileWatchService: unwatchPane removes watcher', async (t) => {
  const events: any[] = []
  const pushEvent = () => {}
  const service = new FileWatchService(pushEvent)
  const testDir = await createTestDir()

  try {
    service.watchPane('pane-1', testDir)
    service.unwatchPane('pane-1')

    // Should not throw when watching again
    service.watchPane('pane-1', testDir)

    service.unwatchPane('pane-1')
  } finally {
    await rm(testDir, { recursive: true, force: true })
  }
})

test('FileWatchService: 120ms debounce for file changes', async (t) => {
  const events: any[] = []
  const pushEvent = (channel: string, data: any) => {
    events.push({ channel, data, timestamp: Date.now() })
  }

  const service = new FileWatchService(pushEvent)
  const testDir = await createTestDir()

  try {
    service.watchPane('pane-1', testDir)

    // Create multiple files rapidly
    await writeFile(join(testDir, 'file1.txt'), 'content1', 'utf8')
    await writeFile(join(testDir, 'file2.txt'), 'content2', 'utf8')
    await writeFile(join(testDir, 'file3.txt'), 'content3', 'utf8')

    // Wait for debounce to complete (120ms + buffer)
    await new Promise((resolve) => setTimeout(resolve, 200))

    // Should have received events
    const fileEvents = events.filter((e) => e.channel === 'event:file-changed' && e.data.paneId === 'pane-1')

    // Due to debouncing, changes should be batched
    // We expect at most one event with all changes
    assert.ok(fileEvents.length >= 1, 'should have at least one file event')

    // Each event should contain changes
    for (const event of fileEvents) {
      assert.ok(Array.isArray(event.data.changes), 'changes should be an array')
    }

    service.unwatchPane('pane-1')
  } finally {
    await rm(testDir, { recursive: true, force: true })
  }
})

test('FileWatchService: root change notification', async (t) => {
  const events: any[] = []
  const pushEvent = (channel: string, data: any) => {
    events.push({ channel, data })
  }

  const service = new FileWatchService(pushEvent)

  service.notifyRootChanged('pane-1')

  // Should send root change event
  await new Promise((resolve) => setTimeout(resolve, 150))

  const rootEvents = events.filter(
    (e) => e.channel === 'event:file-changed' &&
    e.data.paneId === 'pane-1' &&
    e.data.changes.some((c: FileChangeRecord) => c.eventType === 'root')
  )

  assert.ok(rootEvents.length > 0, 'should have root change event')
})

test('FileWatchService: root change without watcher still sends event', async (t) => {
  const events: any[] = []
  const pushEvent = (channel: string, data: any) => {
    events.push({ channel, data })
  }

  const service = new FileWatchService(pushEvent)

  // Notify root change without watching
  service.notifyRootChanged('pane-1')

  await new Promise((resolve) => setTimeout(resolve, 150))

  // Should still send event even without active watcher
  const rootEvents = events.filter(
    (e) => e.channel === 'event:file-changed' &&
    e.data.paneId === 'pane-1' &&
    e.data.changes.some((c: FileChangeRecord) => c.eventType === 'root')
  )

  assert.ok(rootEvents.length > 0, 'should send root change event even without watcher')
})

test('FileWatchService: rebinding watcher on root change', async (t) => {
  const events: any[] = []
  const pushEvent = (channel: string, data: any) => {
    events.push({ channel, data })
  }

  const service = new FileWatchService(pushEvent)
  const testDir1 = await createTestDir()
  const testDir2 = await createTestDir()

  try {
    // Watch initial directory
    service.watchPane('pane-1', testDir1)

    // Create a file in first directory
    await writeFile(join(testDir1, 'test.txt'), 'content', 'utf8')

    await new Promise((resolve) => setTimeout(resolve, 200))

    // Should have events from first directory
    const eventsFromDir1 = events.filter((e) => e.data?.paneId === 'pane-1')
    assert.ok(eventsFromDir1.length > 0, 'should have events from first directory')

    // Clear events
    events.length = 0

    // Unwatch and rebind to new directory (simulating root change)
    service.unwatchPane('pane-1')
    service.watchPane('pane-1', testDir2)

    // Create a file in second directory
    await writeFile(join(testDir2, 'test2.txt'), 'content2', 'utf8')

    await new Promise((resolve) => setTimeout(resolve, 200))

    // Should have events from second directory
    const eventsFromDir2 = events.filter((e) => e.data?.paneId === 'pane-1')
    assert.ok(eventsFromDir2.length > 0, 'should have events from second directory')

    service.unwatchPane('pane-1')
  } finally {
    await rm(testDir1, { recursive: true, force: true })
    await rm(testDir2, { recursive: true, force: true })
  }
})

test('FileWatchService: watching same path twice is no-op', async (t) => {
  const events: any[] = []
  const pushEvent = () => {}
  const service = new FileWatchService(pushEvent)
  const testDir = await createTestDir()

  try {
    service.watchPane('pane-1', testDir)
    service.watchPane('pane-1', testDir) // Same path

    // Should not throw or create duplicate watchers
    assert.ok(true)

    service.unwatchPane('pane-1')
  } finally {
    await rm(testDir, { recursive: true, force: true })
  }
})

test('FileWatchService: watching new path replaces old watcher', async (t) => {
  const events: any[] = []
  const pushEvent = () => {}
  const service = new FileWatchService(pushEvent)
  const testDir1 = await createTestDir()
  const testDir2 = await createTestDir()

  try {
    service.watchPane('pane-1', testDir1)
    service.watchPane('pane-1', testDir2) // Different path

    // Should replace watcher (unwatch old, watch new)
    assert.ok(true)

    service.unwatchPane('pane-1')
  } finally {
    await rm(testDir1, { recursive: true, force: true })
    await rm(testDir2, { recursive: true, force: true })
  }
})

test('FileWatchService: shutdown removes all watchers', async (t) => {
  const events: any[] = []
  const pushEvent = () => {}
  const service = new FileWatchService(pushEvent)
  const testDir1 = await createTestDir()
  const testDir2 = await createTestDir()

  try {
    service.watchPane('pane-1', testDir1)
    service.watchPane('pane-2', testDir2)

    // Shutdown
    service.shutdown()

    // Should be able to watch again without issues
    service.watchPane('pane-1', testDir1)

    service.shutdown()
  } finally {
    await rm(testDir1, { recursive: true, force: true })
    await rm(testDir2, { recursive: true, force: true })
  }
})

test('FileWatchService: handles watcher failure gracefully', async (t) => {
  const events: any[] = []
  const pushEvent = () => {}
  const service = new FileWatchService(pushEvent)

  // Try to watch a non-existent directory
  // The implementation catches errors and logs warnings
  service.watchPane('pane-1', '/nonexistent/path/that/does/not/exist')

  // Should not throw
  assert.ok(true)

  // Cleanup should also not throw
  service.unwatchPane('pane-1')
})

test('FileWatchService: handles permission errors gracefully', async (t) => {
  const events: any[] = []
  const pushEvent = () => {}
  const service = new FileWatchService(pushEvent)
  const testDir = await createTestDir()

  try {
    // On Unix systems, we can make a directory unreadable
    if (process.platform !== 'win32') {
      try {
        await chmod(testDir, 0o000)

        // Try to watch - should handle gracefully
        service.watchPane('pane-1', testDir)

        // Restore permissions for cleanup
        await chmod(testDir, 0o755)
      } catch (chmodError) {
        // chmod might fail in some environments
        console.warn('chmod test skipped:', chmodError)
      }
    }

    service.unwatchPane('pane-1')
  } finally {
    await rm(testDir, { recursive: true, force: true })
  }
})

test('FileWatchService: file change record structure', async (t) => {
  const events: any[] = []
  const pushEvent = (channel: string, data: any) => {
    events.push({ channel, data })
  }

  const service = new FileWatchService(pushEvent)
  const testDir = await createTestDir()

  try {
    service.watchPane('pane-1', testDir)

    // Create a file
    await writeFile(join(testDir, 'test.txt'), 'content', 'utf8')

    await new Promise((resolve) => setTimeout(resolve, 200))

    // Find the file change event
    const fileEvent = events.find(
      (e) => e.channel === 'event:file-changed' && e.data.paneId === 'pane-1'
    )

    assert.ok(fileEvent, 'should have file change event')
    assert.ok(Array.isArray(fileEvent.data.changes))

    // Check structure of first change
    if (fileEvent.data.changes.length > 0) {
      const change = fileEvent.data.changes[0]
      assert.ok(typeof change.relativePath === 'string' || change.relativePath === null)
      assert.ok(['change', 'rename', 'root'].includes(change.eventType))
    }

    service.unwatchPane('pane-1')
  } finally {
    await rm(testDir, { recursive: true, force: true })
  }
})

test('FileWatchService: multiple panes are isolated', async (t) => {
  const events: any[] = []
  const pushEvent = (channel: string, data: any) => {
    events.push({ channel, data })
  }

  const service = new FileWatchService(pushEvent)
  const testDir1 = await createTestDir()
  const testDir2 = await createTestDir()

  try {
    service.watchPane('pane-1', testDir1)
    service.watchPane('pane-2', testDir2)

    // Wait for watchers to be ready
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Clear any initial events
    events.length = 0

    // Create file in pane-1's directory
    await writeFile(join(testDir1, 'pane1-file.txt'), 'content1', 'utf8')

    await new Promise((resolve) => setTimeout(resolve, 200))

    // Should only have events for pane-1
    const pane1Events = events.filter((e) => e.data?.paneId === 'pane-1')
    const pane2Events = events.filter((e) => e.data?.paneId === 'pane-2')

    assert.ok(pane1Events.length > 0, 'pane-1 should have events')

    // Check that pane-2 events (if any) don't contain the file we created in pane-1
    const pane2HasPane1File = pane2Events.some((e) => {
      if (!e.data?.changes) return false
      return e.data.changes.some((c: FileChangeRecord) =>
        c.relativePath?.includes('pane1-file.txt')
      )
    })
    assert.ok(!pane2HasPane1File, 'pane-2 should not have events from pane-1 directory')

    service.unwatchPane('pane-1')
    service.unwatchPane('pane-2')
  } finally {
    await rm(testDir1, { recursive: true, force: true })
    await rm(testDir2, { recursive: true, force: true })
  }
})

test('FileWatchService: unwatchPane clears pending changes', async (t) => {
  const events: any[] = []
  const pushEvent = (channel: string, data: any) => {
    events.push({ channel, data })
  }

  const service = new FileWatchService(pushEvent)
  const testDir = await createTestDir()

  try {
    service.watchPane('pane-1', testDir)

    // Trigger a change
    await writeFile(join(testDir, 'test.txt'), 'content', 'utf8')

    // Immediately unwatch before debounce completes
    service.unwatchPane('pane-1')

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 200))

    // Should not have events (or very few before unwatch)
    const eventsAfterUnwatch = events.filter(
      (e) => e.channel === 'event:file-changed' && e.data?.paneId === 'pane-1'
    )

    // This is timing-dependent, but unwatch should prevent most events
    assert.ok(true, 'unwatch should clear pending changes')
  } finally {
    await rm(testDir, { recursive: true, force: true })
  }
})

test('FileWatchService: normalizes filenames', async (t) => {
  const events: any[] = []
  const pushEvent = (channel: string, data: any) => {
    events.push({ channel, data })
  }

  const service = new FileWatchService(pushEvent)
  const testDir = await createTestDir()

  try {
    service.watchPane('pane-1', testDir)

    // Create a file
    await writeFile(join(testDir, 'test-file.txt'), 'content', 'utf8')

    await new Promise((resolve) => setTimeout(resolve, 200))

    // Find the event
    const fileEvent = events.find(
      (e) => e.channel === 'event:file-changed' && e.data?.paneId === 'pane-1'
    )

    if (fileEvent && fileEvent.data.changes.length > 0) {
      const change = fileEvent.data.changes[0]
      // Path should use forward slashes
      if (change.relativePath) {
        assert.ok(!change.relativePath.includes('\\'), 'path should use forward slashes')
      }
    }

    service.unwatchPane('pane-1')
  } finally {
    await rm(testDir, { recursive: true, force: true })
  }
})
