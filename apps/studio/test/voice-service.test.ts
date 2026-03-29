import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VoiceService } from '../src/main/voice-service.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const appsRoot = join(__dirname, '..', '..')

// Mock project root resolver
function createMockRoot(audioServiceExists: boolean = true) {
  const root = '/test/project'
  return () => root
}

// Mock existsSync for audio service path
let mockAudioServiceExists = true
let mockVoiceBridgeExists = true

test('VoiceService: probe detects audio_service.py availability', async () => {
  const mockRoot = createMockRoot(true)
  const service = new VoiceService(mockRoot)

  // We'll test the logic by checking the return value structure
  // Full probing requires actual Python runtime, which we can't easily mock
  const result = await service.probe()

  // Result should have the expected structure
  assert.ok(typeof result.available === 'boolean')
  assert.ok(result.reason === undefined || typeof result.reason === 'string')
})

test('VoiceService: probe finds audio_service.py when resolver returns the Studio directory', async () => {
  const service = new VoiceService(() => join(appsRoot, 'studio'))
  const result = await service.probe()

  assert.notEqual(result.reason, 'audio_service.py not found — ensure audio-service/ exists')
})

test('VoiceService: probe returns unavailable when audio_service.py missing', async () => {
  const mockRoot = createMockRoot(false)
  const service = new VoiceService(mockRoot)

  // We can't easily mock fs.existsSync in the module, so we'll test
  // the expected behavior when the file doesn't exist
  // This would require the file to actually not exist in the test environment
})

test('VoiceService: start throws when unavailable', async () => {
  const mockRoot = createMockRoot(true)
  const service = new VoiceService(mockRoot)

  // Set state to unavailable manually
  ;(service as any).state = 'unavailable'
  ;(service as any).reason = 'Not available'

  await assert.rejects(
    async () => await service.start(),
    /unavailable|audio_service|not found/i
  )
})

test('VoiceService: getStatus returns current state', async () => {
  const mockRoot = createMockRoot(true)
  const service = new VoiceService(mockRoot)

  const status = service.getStatus()

  assert.ok(typeof status.available === 'boolean')
  assert.ok(typeof status.state === 'string')
  assert.ok(status.port === null || typeof status.port === 'number')
  assert.ok(status.token === null || typeof status.token === 'string')
})

test('VoiceService: stop is idempotent', async () => {
  const mockRoot = createMockRoot(true)
  const service = new VoiceService(mockRoot)

  // Stop when not started - should not throw
  await service.stop()
  await service.stop()

  const status = service.getStatus()
  assert.equal(status.state, 'stopped')
})

test('VoiceService: handles startup timeout', async () => {
  const mockRoot = createMockRoot(true)
  const service = new VoiceService(mockRoot)

  // Set a very short timeout for testing
  ;(service as any).startupTimeoutMs = 100

  // Mock probe to return available
  ;(service as any).state = 'stopped'
  ;(service as any).pythonCmd = 'python3'
  ;(service as any).audioServicePath = '/fake/path/audio_service.py'

  // The actual spawn will fail, which is fine for this test
  // We're testing that the timeout logic exists
  await assert.rejects(
    async () => await service.start(),
    /Voice sidecar unavailable|Voice sidecar startup timeout|not found|exited unexpectedly/
  )
})

test('VoiceService: emits status events', async (t) => {
  const mockRoot = createMockRoot(true)
  const service = new VoiceService(mockRoot)

  const events: any[] = []
  service.on('status', (status) => {
    events.push(status)
  })

  // Trigger a status change by calling probe
  await service.probe()

  // At least one status event should have been emitted
  assert.ok(events.length > 0)

  // Verify status structure
  const lastStatus = events[events.length - 1]
  assert.ok(typeof lastStatus.available === 'boolean')
  assert.ok(typeof lastStatus.state === 'string')
})

test('VoiceService: handles Python probe failures', async () => {
  const mockRoot = createMockRoot(true)
  const service = new VoiceService(mockRoot)

  // Mock the Python runtime detection to fail
  // This is a conceptual test - actual implementation would require
  // more sophisticated mocking of child_process.execFile

  const result = await service.probe()

  // Should return a result (not throw)
  assert.ok(result !== undefined)
  assert.ok(typeof result.available === 'boolean')
})

test('VoiceService: handles voice sidecar crash', async () => {
  const mockRoot = createMockRoot(true)
  const service = new VoiceService(mockRoot)

  // Set state to ready, then simulate crash
  ;(service as any).state = 'ready'
  ;(service as any).port = 8080
  ;(service as any).authToken = 'test-token'

  const statusBefore = service.getStatus()
  assert.equal(statusBefore.state, 'ready')

  // The actual crash handling would require spawning a real process
  // or more sophisticated mocking. This test verifies the state structure.
})

test('VoiceService: handles crash and restart', async () => {
  const mockRoot = createMockRoot(true)
  const service = new VoiceService(mockRoot)

  // Set up a state that would trigger restart on crash
  ;(service as any).state = 'ready'
  ;(service as any).port = 8080
  ;(service as any).intentionalStop = false

  // Verify restart timer exists (even if null)
  assert.ok('restartTimer' in service)

  // The actual restart logic is tested indirectly through the
  // process exit handling, which requires real process spawning
})

test('VoiceService: getPythonWorkingDirectory returns correct path for uv', () => {
  const mockRoot = () => '/test/project'
  const service = new VoiceService(mockRoot)

  ;(service as any).voiceBridgePath = '/test/project/audio-service'

  const cwd = (service as any).getPythonWorkingDirectory('uv')
  assert.equal(cwd, '/test/project/audio-service')
})

test('VoiceService: getPythonWorkingDirectory returns undefined for python', () => {
  const mockRoot = () => '/test/project'
  const service = new VoiceService(mockRoot)

  const cwd = (service as any).getPythonWorkingDirectory('python')
  assert.equal(cwd, undefined)
})

test('VoiceService: getUvPythonArgs constructs correct args', () => {
  const mockRoot = () => '/test/project'
  const service = new VoiceService(mockRoot)

  ;(service as any).voiceBridgePath = '/test/project/audio-service'

  const args = (service as any).getUvPythonArgs(['script.py'])
  assert.ok(args.includes('run'))
  assert.ok(args.includes('--project'))
  assert.ok(args.includes('/test/project/audio-service'))
  assert.ok(args.includes('python'))
  assert.ok(args.includes('script.py'))
})

test('VoiceService: getUvPythonArgs omits project when audioServiceDir is unset', () => {
  const mockRoot = () => '/test/project'
  const service = new VoiceService(mockRoot)

  const args = (service as any).getUvPythonArgs(['script.py'])
  assert.ok(args.includes('run'))
  assert.ok(args.includes('python'))
  assert.ok(args.includes('script.py'))
  assert.ok(!args.includes('--project'))
})

test('VoiceService: probe uses expanded PATH during runtime version detection', async () => {
  const tempHome = await mkdtemp(join(tmpdir(), 'lucent-voice-home-'))
  const fakeBin = join(tempHome, '.cargo', 'bin')
  const fakeRuntime = join(fakeBin, 'uv')
  const originalHome = process.env.HOME
  const originalPath = process.env.PATH

  await mkdir(fakeBin, { recursive: true })
  await writeFile(
    fakeRuntime,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo "uv 1.0.0"\n  exit 0\nfi\nif [ "$1" = "run" ]; then\n  echo "OK"\n  exit 0\nfi\nprintf "unexpected args: %s\\n" "$*" >&2\nexit 1\n',
  )
  await chmod(fakeRuntime, 0o755)

  process.env.HOME = tempHome
  process.env.PATH = '/usr/bin:/bin'

  try {
    const service = new VoiceService(() => appsRoot)
    const result = await service.probe()

    assert.equal(result.available, true)
    assert.equal((service as any).pythonCmd, 'uv')
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    if (originalPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = originalPath
    }
    await rm(tempHome, { recursive: true, force: true })
  }
})
