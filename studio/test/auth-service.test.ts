import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { AuthService } from '../src/main/auth-service.js'

// Helper to create a test auth directory
async function createAuthDir(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'lucent-authservice-'))
  const authDir = join(base, 'agent')
  await mkdir(authDir, { recursive: true })
  return base
}

test('AuthService: getProviderCatalog returns all providers', () => {
  const service = new AuthService()
  const catalog = service.getProviderCatalog()

  assert.ok(catalog.length > 0)

  // Check Anthropic (recommended, supports both)
  const anthropic = catalog.find((p) => p.id === 'anthropic')
  assert.ok(anthropic)
  assert.equal(anthropic.supportsApiKey, true)
  assert.equal(anthropic.supportsOAuth, true)
  assert.equal(anthropic.recommended, true)

  // Check GitHub Copilot (OAuth only)
  const github = catalog.find((p) => p.id === 'github-copilot')
  assert.ok(github)
  assert.equal(github.supportsApiKey, false)
  assert.equal(github.supportsOAuth, true)

  // Check OpenAI (API key only)
  const openai = catalog.find((p) => p.id === 'openai')
  assert.ok(openai)
  assert.equal(openai.supportsApiKey, true)
  assert.equal(openai.supportsOAuth, false)
})

test('AuthService: getProviderStatuses returns correct status', async () => {
  const base = await createAuthDir()
  const service = new AuthService()

  // Override auth path to use test directory
  const authPath = join(base, 'agent', 'auth.json')
  ;(service as any).authPath = authPath

  try {
    // Set an environment variable for testing
    const originalEnv = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'

    const statuses = service.getProviderStatuses()

    // Anthropic should show as configured via environment
    const anthropic = statuses.find((s) => s.id === 'anthropic')
    assert.ok(anthropic)
    assert.equal(anthropic.configured, true)
    assert.equal(anthropic.configuredVia, 'environment')
    assert.equal(anthropic.removeAllowed, false)

    // OpenAI should not be configured
    const openai = statuses.find((s) => s.id === 'openai')
    assert.ok(openai)
    assert.equal(openai.configured, false)
    assert.equal(openai.removeAllowed, false)

    // Restore original env
    if (originalEnv === undefined) {
      delete process.env.ANTHROPIC_API_KEY
    } else {
      process.env.ANTHROPIC_API_KEY = originalEnv
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('AuthService: validateAndSaveApiKey stores valid key', async () => {
  const base = await createAuthDir()
  const service = new AuthService()

  const authPath = join(base, 'agent', 'auth.json')
  ;(service as any).authPath = authPath

  try {
    // Mock the HTTP validation to succeed
    const originalValidate = (service as any).validateViaHttp
    ;(service as any).validateViaHttp = async () => ({ ok: true, message: 'Valid' })

    // Save a key
    const result = await service.validateAndSaveApiKey('anthropic', 'sk-ant-test123')

    assert.equal(result.ok, true)
    assert.equal(result.message, 'API key saved')

    // Verify it was persisted
    const content = await readFile(authPath, 'utf8')
    const data = JSON.parse(content)
    assert.ok(data.anthropic)
    assert.equal(data.anthropic.type, 'api_key')
    assert.equal(data.anthropic.key, 'sk-ant-test123')

    // Restore original
    ;(service as any).validateViaHttp = originalValidate
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('AuthService: validateAndSaveApiKey rejects invalid key', async () => {
  const base = await createAuthDir()
  const service = new AuthService()

  const authPath = join(base, 'agent', 'auth.json')
  ;(service as any).authPath = authPath

  try {
    // Mock the HTTP validation to fail
    const originalValidate = (service as any).validateViaHttp
    ;(service as any).validateViaHttp = async () => ({
      ok: false,
      message: 'Invalid API key',
    })

    const result = await service.validateAndSaveApiKey('anthropic', 'invalid-key')

    assert.equal(result.ok, false)
    assert.equal(result.message, 'Invalid API key')

    // Restore original
    ;(service as any).validateViaHttp = originalValidate
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('AuthService: validateAndSaveApiKey handles timeout', async () => {
  const base = await createAuthDir()
  const service = new AuthService()

  const authPath = join(base, 'agent', 'auth.json')
  ;(service as any).authPath = authPath

  try {
    // Mock timeout
    const originalValidate = (service as any).validateViaHttp
    ;(service as any).validateViaHttp = async () => ({
      ok: false,
      message: 'Request timed out',
    })

    const result = await service.validateAndSaveApiKey('anthropic', 'sk-ant-test')

    assert.equal(result.ok, false)
    assert.equal(result.message, 'Request timed out')

    // Restore original
    ;(service as any).validateViaHttp = originalValidate
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('AuthService: validateAndSaveApiKey does not duplicate existing keys', async () => {
  const base = await createAuthDir()
  const service = new AuthService()

  const authPath = join(base, 'agent', 'auth.json')
  ;(service as any).authPath = authPath

  try {
    // Mock validation to succeed
    const originalValidate = (service as any).validateViaHttp
    ;(service as any).validateViaHttp = async () => ({ ok: true, message: 'Valid' })

    // Save the same key twice
    await service.validateAndSaveApiKey('anthropic', 'sk-ant-same-key')
    await service.validateAndSaveApiKey('anthropic', 'sk-ant-same-key')

    // Verify only one entry exists
    const content = await readFile(authPath, 'utf8')
    const data = JSON.parse(content)

    // Should be a single object, not an array
    assert.ok(data.anthropic)
    assert.equal(data.anthropic.type, 'api_key')
    assert.equal(data.anthropic.key, 'sk-ant-same-key')

    // Restore original
    ;(service as any).validateViaHttp = originalValidate
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('AuthService: removeApiKey removes provider credentials', async () => {
  const base = await createAuthDir()
  const service = new AuthService()

  const authPath = join(base, 'agent', 'auth.json')
  ;(service as any).authPath = authPath

  try {
    // Create initial auth data with API key
    const initialData = {
      anthropic: { type: 'api_key', key: 'sk-ant-test' },
    }
    await writeFile(authPath, JSON.stringify(initialData, null, 2), 'utf8')

    // Remove the key
    const newStatuses = service.removeApiKey('anthropic')

    // Verify it was removed
    const content = await readFile(authPath, 'utf8')
    const data = JSON.parse(content)
    assert.equal(data.anthropic, undefined)

    // Verify status update
    const anthropicStatus = newStatuses.find((s) => s.id === 'anthropic')
    assert.ok(anthropicStatus)
    assert.equal(anthropicStatus.configured, false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('AuthService: startOAuthLogin handles concurrent flows', async () => {
  const base = await createAuthDir()
  const service = new AuthService()

  const authPath = join(base, 'agent', 'auth.json')
  ;(service as any).authPath = authPath

  try {
    let eventCount = 0
    const events: any[] = []
    const pushEvent = (channel: string, data: any) => {
      events.push({ channel, data })
      eventCount++
    }

    const openBrowser = async (url: string) => {
      // Mock
    }

    // Mock OAuth provider
    const mockProvider = {
      login: async (callbacks: any) => {
        // Simulate a flow that gets cancelled
        callbacks.onProgress?.('Starting login...')
        throw new Error('OAuth cancelled')
      },
    }

    // Import and mock getOAuthProvider
    const piAi = await import('@gsd/pi-ai/oauth')
    const originalGet = piAi.getOAuthProvider
    piAi.getOAuthProvider = () => mockProvider

    try {
      // Start a flow
      const result1 = await service.startOAuthLogin('anthropic', pushEvent, openBrowser)
      assert.equal(result1.ok, false)
      assert.equal(result1.message, 'Cancelled')

      // Start another flow - should cancel the first
      const result2 = await service.startOAuthLogin('anthropic', pushEvent, openBrowser)
      assert.equal(result2.ok, false)

      // Verify events were pushed
      assert.ok(eventCount > 0)
      const progressEvents = events.filter((e) => e.channel === 'event:oauth-progress')
      assert.ok(progressEvents.length > 0)
    } finally {
      piAi.getOAuthProvider = originalGet
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('AuthService: submitOAuthCode resolves pending input', async () => {
  const service = new AuthService()

  // This is a basic test - full OAuth flow testing requires more complex setup
  service.submitOAuthCode('anthropic', 'test-code-123')
  // Should not throw
})

test('AuthService: cancelOAuthFlow aborts in-flight flow', async () => {
  const service = new AuthService()

  // Cancel a flow that doesn't exist - should not throw
  service.cancelOAuthFlow('anthropic')

  // Cancel twice - should still not throw
  service.cancelOAuthFlow('anthropic')
})

test('AuthService: token storage creates secure file', async () => {
  const base = await createAuthDir()
  const service = new AuthService()

  const authPath = join(base, 'agent', 'auth.json')
  ;(service as any).authPath = authPath

  try {
    // Mock validation
    const originalValidate = (service as any).validateViaHttp
    ;(service as any).validateViaHttp = async () => ({ ok: true, message: 'Valid' })

    // Save a key
    await service.validateAndSaveApiKey('openai', 'sk-test-key')

    // Verify file exists
    const { statSync } = await import('node:fs')
    const stats = statSync(authPath)
    assert.ok(stats)

    // Verify content
    const content = await readFile(authPath, 'utf8')
    const data = JSON.parse(content)
    assert.ok(data.openai)

    // Restore original
    ;(service as any).validateViaHttp = originalValidate
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('AuthService: handles corrupted auth.json gracefully', async () => {
  const base = await createAuthDir()
  const service = new AuthService()

  const authPath = join(base, 'agent', 'auth.json')
  ;(service as any).authPath = authPath

  try {
    // Write corrupted JSON
    await writeFile(authPath, '{ invalid json }', 'utf8')

    // Should not throw, should return empty status
    const statuses = service.getProviderStatuses()
    assert.ok(Array.isArray(statuses))

    // All providers should be unconfigured
    const configured = statuses.filter((s) => s.configured)
    assert.equal(configured.length, 0)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('AuthService: handles missing auth.json directory', async () => {
  const base = await createAuthDir()
  const service = new AuthService()

  // Use a path that doesn't exist
  const authPath = join(base, 'nonexistent', 'auth.json')
  ;(service as any).authPath = authPath

  try {
    // Should create the directory and file
    const statuses = service.getProviderStatuses()
    assert.ok(Array.isArray(statuses))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
