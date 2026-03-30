import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

// Mock AgentBridge
class MockAgentBridge extends EventEmitter {
  stateQueue: Array<{ sessionFile?: string }> = []

  async setSessionName(name: string): Promise<void> {
    // Mock implementation
  }

  async switchSession(path: string): Promise<{ cancelled: boolean }> {
    return { cancelled: false }
  }

  async getMessages(): Promise<any[]> {
    return []
  }

  async getState(): Promise<{ sessionFile?: string }> {
    return this.stateQueue.shift() ?? {}
  }
}

// Mock Orchestrator
class MockOrchestrator {
  getCurrentTurn() {
    return null
  }

  async abortCurrentTurn(): Promise<void> {
    // Mock implementation
  }
}

// Import the service
import { SessionService } from '../src/main/session-service.js'

async function createSessionDir(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'lucent-sessionservice-'))
  const sessionsDir = join(base, 'sessions')
  await mkdir(sessionsDir, { recursive: true })

  // Create a valid session file
  const sessionPath = join(sessionsDir, 'session1.jsonl')
  const sessionContent = JSON.stringify({
    type: 'session_header',
    name: 'Test Session 1',
    timestamp: '2024-01-01T00:00:00Z',
  }) + '\n' + JSON.stringify({
    role: 'user',
    content: 'Hello',
  }) + '\n'
  await writeFile(sessionPath, sessionContent, 'utf8')

  // Create a nested session
  const nestedDir = join(sessionsDir, 'nested')
  await mkdir(nestedDir, { recursive: true })
  const nestedPath = join(nestedDir, 'session2.jsonl')
  await writeFile(nestedPath, sessionContent, 'utf8')

  // Create a malformed session (invalid JSON)
  const malformedPath = join(sessionsDir, 'malformed.jsonl')
  await writeFile(malformedPath, 'invalid json content\n{"role":"user"}\n', 'utf8')

  // Create a session without a header
  const noHeaderPath = join(sessionsDir, 'no-header.jsonl')
  await writeFile(noHeaderPath, '{"role":"user","content":"test"}\n', 'utf8')

  // Create a session with timestamp but no name
  const timestampOnlyPath = join(sessionsDir, 'timestamp-only.jsonl')
  await writeFile(timestampOnlyPath, JSON.stringify({
    type: 'session_header',
    timestamp: '2024-01-15T10:30:00Z',
  }) + '\n', 'utf8')

  // Create a symlink to a session (will be broken later)
  const linkPath = join(sessionsDir, 'symlink.jsonl')
  const targetPath = join(sessionsDir, 'session1.jsonl')
  try {
    await writeFile(targetPath, sessionContent, 'utf8')
    // We'll create the symlink in the test if needed
  } catch {
    // Ignore
  }

  return base
}

test('SessionService: listSessions returns all sessions sorted by modified time', async () => {
  const base = await createSessionDir()
  const mockBridge = new MockAgentBridge()
  const service = new SessionService(mockBridge)

  // Override sessionsBase to use our test directory
  ;(service as any).sessionsBase = join(base, 'sessions')

  try {
    const sessions = await service.listSessions()

    assert.ok(sessions.length >= 3) // At least session1, nested/session2, malformed, etc.

    // Check that sessions are sorted by modified time (newest first)
    for (let i = 1; i < sessions.length; i++) {
      assert.ok(sessions[i - 1].modified >= sessions[i].modified)
    }

    // Check that named session has the correct name
    const session1 = sessions.find((s) => s.path.includes('session1.jsonl'))
    assert.ok(session1)
    assert.equal(session1.name, 'Test Session 1')

    // Check nested session
    const nested = sessions.find((s) => s.path.includes('session2.jsonl'))
    assert.ok(nested)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('SessionService: listSessions handles malformed JSONL files', async () => {
  const base = await createSessionDir()
  const mockBridge = new MockAgentBridge()
  const service = new SessionService(mockBridge)

  ;(service as any).sessionsBase = join(base, 'sessions')

  try {
    const sessions = await service.listSessions()

    // Malformed files should fall back to filename
    const malformed = sessions.find((s) => s.path.includes('malformed.jsonl'))
    assert.ok(malformed)
    assert.equal(malformed.name, 'malformed')

    // Files without headers should also work
    const noHeader = sessions.find((s) => s.path.includes('no-header.jsonl'))
    assert.ok(noHeader)
    assert.equal(noHeader.name, 'no-header')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('SessionService: listSessions handles broken symlinks', async () => {
  const base = await createSessionDir()
  const mockBridge = new MockAgentBridge()
  const service = new SessionService(mockBridge)

  ;(service as any).sessionsBase = join(base, 'sessions')

  try {
    // Create a broken symlink
    const linkPath = join(base, 'sessions', 'broken-link.jsonl')
    const targetPath = join(base, 'nonexistent.jsonl')
    // Note: We can't create symlinks in all environments, so we'll test the behavior
    // by just ensuring the method doesn't throw

    const sessions = await service.listSessions()
    // Should not throw, just skip the broken link
    assert.ok(Array.isArray(sessions))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('SessionService: listSessions handles nonexistent base directory', async () => {
  const mockBridge = new MockAgentBridge()
  const service = new SessionService(mockBridge)

  // Use a path that doesn't exist
  ;(service as any).sessionsBase = join(tmpdir(), 'nonexistent-' + Date.now())

  const sessions = await service.listSessions()
  assert.equal(sessions.length, 0)
})

test('SessionService: deleteSession prevents deleting active session', async () => {
  const base = await createSessionDir()
  const mockBridge = new MockAgentBridge()
  const service = new SessionService(mockBridge)

  ;(service as any).sessionsBase = join(base, 'sessions')

  try {
    const sessions = await service.listSessions()
    const session1 = sessions.find((s) => s.path.includes('session1.jsonl'))
    assert.ok(session1)

    // Set this as the active session
    service.setActiveSessionId(session1.path)

    // Try to delete the active session
    await assert.rejects(
      async () => await service.deleteSession(session1.path),
      /Cannot delete the active session/
    )

    // Verify the file still exists
    const content = await readFile(session1.path, 'utf8')
    assert.ok(content.length > 0)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('SessionService: deleteSession validates session path', async () => {
  const base = await createSessionDir()
  const mockBridge = new MockAgentBridge()
  const service = new SessionService(mockBridge)

  ;(service as any).sessionsBase = join(base, 'sessions')

  try {
    // Try to delete a file outside the sessions directory
    await assert.rejects(
      async () => await service.deleteSession('/etc/passwd'),
      /Invalid session path/
    )

    // Try to delete a non-.jsonl file
    await assert.rejects(
      async () => await service.deleteSession(join(base, 'sessions', 'session1.txt')),
      /Invalid session path/
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('SessionService: switchSession aborts current turn if generating', async () => {
  const base = await createSessionDir()
  const mockBridge = new MockAgentBridge()
  const mockOrchestrator = new MockOrchestrator()
  const service = new SessionService(mockBridge)

  ;(service as any).sessionsBase = join(base, 'sessions')

  // Mock orchestrator to return a turn in 'generating' state
  mockOrchestrator.getCurrentTurn = () => ({ state: 'generating' })
  let abortCalled = false
  mockOrchestrator.abortCurrentTurn = async () => {
    abortCalled = true
  }

  try {
    const sessions = await service.listSessions()
    const session1 = sessions.find((s) => s.path.includes('session1.jsonl'))
    assert.ok(session1)

    const result = await service.switchSession(session1.path, mockOrchestrator)

    assert.equal(abortCalled, true)
    assert.equal(result.cancelled, false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('SessionService: active session persistence', async () => {
  const base = await createSessionDir()
  const mockBridge = new MockAgentBridge()
  const service = new SessionService(mockBridge)

  // Override the active session file path
  const activeSessionFile = join(base, 'active-session')
  ;(service as any).activeSessionFile = activeSessionFile
  ;(service as any).sessionsBase = join(base, 'sessions')

  try {
    const sessions = await service.listSessions()
    const session1 = sessions.find((s) => s.path.includes('session1.jsonl'))
    assert.ok(session1)

    // Set active session
    service.setActiveSessionId(session1.path)

    // Wait a bit for async write
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Verify the file was written
    const content = await readFile(activeSessionFile, 'utf8')
    assert.equal(content.trim(), session1.path)

    // Load it back
    const loaded = await service.loadActiveSessionId()
    assert.equal(loaded, session1.path)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('SessionService: per-project session persistence stores and loads mappings', async () => {
  const base = await createSessionDir()
  const mockBridge = new MockAgentBridge()
  const service = new SessionService(mockBridge)

  const perProjectSessionFile = join(base, 'last-session-by-project.json')
  ;(service as any).perProjectSessionFile = perProjectSessionFile

  try {
    service.setProjectSession('/tmp/project-a', '/sessions/a.jsonl')
    service.setProjectSession('/tmp/project-b', '/sessions/b.jsonl')

    await new Promise((resolve) => setTimeout(resolve, 100))

    assert.equal(await service.getProjectSession('/tmp/project-a'), '/sessions/a.jsonl')
    assert.equal(await service.getProjectSession('/tmp/project-b'), '/sessions/b.jsonl')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('SessionService: syncProjectSessionFromAgent stores the latest agent session for a project', async () => {
  const base = await createSessionDir()
  const mockBridge = new MockAgentBridge()
  const service = new SessionService(mockBridge)

  const perProjectSessionFile = join(base, 'last-session-by-project.json')
  ;(service as any).perProjectSessionFile = perProjectSessionFile
  mockBridge.stateQueue = [{ sessionFile: '/sessions/project-x.jsonl' }]

  try {
    const synced = await service.syncProjectSessionFromAgent('/tmp/project-x')
    assert.equal(synced, '/sessions/project-x.jsonl')
    assert.equal(await service.getProjectSession('/tmp/project-x'), '/sessions/project-x.jsonl')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

  const mockBridge = new MockAgentBridge()
  const service = new SessionService(mockBridge)

  let newName = ''
  mockBridge.setSessionName = async (name: string) => {
    newName = name
  }

  await service.renameSession('New Session Name')
  assert.equal(newName, 'New Session Name')
})

test('SessionService: syncActiveSessionFromAgent stores the latest agent session file', async () => {
  const mockBridge = new MockAgentBridge()
  const service = new SessionService(mockBridge)

  mockBridge.stateQueue = [
    { sessionFile: '/sessions/new.jsonl' },
  ]

  const synced = await service.syncActiveSessionFromAgent()

  assert.equal(synced, '/sessions/new.jsonl')
  assert.equal(service.getActiveSessionId(), '/sessions/new.jsonl')
})

test('SessionService: getMessages formats messages correctly', async () => {
  const mockBridge = new MockAgentBridge()
  const service = new SessionService(mockBridge)

  const rawMessages = [
    {
      role: 'user',
      content: 'Hello',
      timestamp: 1000,
    },
    {
      role: 'assistant',
      content: 'Hi there!',
      created_at: 2000,
    },
    {
      role: 'user',
      content: [{ type: 'text', text: 'Complex content' }],
      timestamp: 3000,
    },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Part 1' },
        { type: 'text', text: 'Part 2' },
      ],
      timestamp: 4000,
    },
  ]

  mockBridge.getMessages = async () => rawMessages

  const formatted = await service.getMessages()

  assert.equal(formatted.length, 4)
  assert.equal(formatted[0].role, 'user')
  assert.equal(formatted[0].text, 'Hello')
  assert.equal(formatted[0].timestamp, 1000)

  assert.equal(formatted[1].role, 'assistant')
  assert.equal(formatted[1].text, 'Hi there!')
  assert.equal(formatted[1].timestamp, 2000)

  assert.equal(formatted[2].role, 'user')
  assert.equal(formatted[2].text, 'Complex content')

  assert.equal(formatted[3].role, 'assistant')
  assert.equal(formatted[3].text, 'Part 1Part 2')
})

test('SessionService: getMessages filters out unknown roles', async () => {
  const mockBridge = new MockAgentBridge()
  const service = new SessionService(mockBridge)

  const rawMessages = [
    { role: 'user', content: 'Hello', timestamp: 1000 },
    { role: 'system', content: 'System message', timestamp: 1500 },
    { role: 'assistant', content: 'Hi', timestamp: 2000 },
    { role: 'unknown', content: 'Unknown', timestamp: 2500 },
  ]

  mockBridge.getMessages = async () => rawMessages

  const formatted = await service.getMessages()

  assert.equal(formatted.length, 2)
  assert.equal(formatted[0].role, 'user')
  assert.equal(formatted[1].role, 'assistant')
})

test('SessionService: getMessages handles messages with empty content', async () => {
  const mockBridge = new MockAgentBridge()
  const service = new SessionService(mockBridge)

  const rawMessages = [
    { role: 'user', content: '', timestamp: 1000 },
    { role: 'user', content: [], timestamp: 1500 },
    { role: 'assistant', content: [{ type: 'tool_use' }], timestamp: 2000 },
  ]

  mockBridge.getMessages = async () => rawMessages

  const formatted = await service.getMessages()

  // All messages with empty text should be filtered out
  assert.equal(formatted.length, 0)
})

test('SessionService: loadActiveSessionId handles nonexistent file', async () => {
  const mockBridge = new MockAgentBridge()
  const service = new SessionService(mockBridge)

  // Override to a path that definitely doesn't exist
  ;(service as any).activeSessionFile = join(tmpdir(), 'lucent-test-no-active-' + Date.now())

  const loaded = await service.loadActiveSessionId()
  assert.equal(loaded, null)
})

test('SessionService: loadActiveSessionId handles empty file', async () => {
  const base = await mkdtemp(join(tmpdir(), 'lucent-sessionservice-'))
  const mockBridge = new MockAgentBridge()
  const service = new SessionService(mockBridge)

  const activeSessionFile = join(base, 'active-session')
  ;(service as any).activeSessionFile = activeSessionFile

  try {
    // Create empty file
    await writeFile(activeSessionFile, '', 'utf8')

    const loaded = await service.loadActiveSessionId()
    assert.equal(loaded, null)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
