import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sanitizeSettingsForRenderer, validateSettingsPatch } from '../src/main/settings-contract.js'
import { resolveRemotePaneRoot } from '../src/main/pane-root-policy.js'

test('settings contract: sanitizes tavilyApiKey for renderer output', () => {
  const result = sanitizeSettingsForRenderer({
    theme: 'dark',
    fontSize: 14,
    sidebarCollapsed: true,
    tavilyApiKey: 'secret-key',
    remoteAccessEnabled: true,
    remoteAccessPort: 8788,
    remoteAccessToken: 'token-123',
    tailscaleServeEnabled: false,
  })

  assert.equal(result.hasTavilyKey, true)
  assert.equal('tavilyApiKey' in result, false)
  // remoteAccessToken is stripped for security — not passed to renderer
  assert.equal('remoteAccessToken' in result, false)
})

test('settings contract: validates remote access settings', () => {
  const token = 'token-secure-longkey-123'
  const result = validateSettingsPatch({
    remoteAccessEnabled: true,
    remoteAccessPort: 8788,
    remoteAccessToken: token,
    tailscaleServeEnabled: false,
  })

  assert.deepEqual(result, {
    remoteAccessEnabled: true,
    remoteAccessPort: 8788,
    remoteAccessToken: token,
    tailscaleServeEnabled: false,
  })
})

test('settings contract: rejects invalid remoteAccessPort', () => {
  assert.throws(
    () => validateSettingsPatch({ remoteAccessPort: 70_000 }),
    /Invalid remoteAccessPort setting/,
  )
})

test('settings contract: validates persisted project/file context', () => {
  const result = validateSettingsPatch({
    lastProjectRoot: '/tmp/project',
    lastActiveFilePath: 'src/App.tsx',
  })

  assert.deepEqual(result, {
    lastProjectRoot: '/tmp/project',
    lastActiveFilePath: 'src/App.tsx',
  })
})

// ============================================================================
// permissionMode tests
// ============================================================================

test('settings contract: validates permissionMode danger-full-access', () => {
  const result = validateSettingsPatch({ permissionMode: 'danger-full-access' })
  assert.deepEqual(result, { permissionMode: 'danger-full-access' })
})

test('settings contract: validates permissionMode accept-on-edit', () => {
  const result = validateSettingsPatch({ permissionMode: 'accept-on-edit' })
  assert.deepEqual(result, { permissionMode: 'accept-on-edit' })
})

test('settings contract: rejects invalid permissionMode value', () => {
  assert.throws(
    () => validateSettingsPatch({ permissionMode: 'invalid-mode' }),
    /Invalid permissionMode setting/,
  )
})

test('settings contract: sanitizeSettingsForRenderer passes permissionMode through', () => {
  const result = sanitizeSettingsForRenderer({
    theme: 'dark',
    fontSize: 14,
    sidebarCollapsed: true,
    permissionMode: 'accept-on-edit',
  })
  assert.equal((result as any).permissionMode, 'accept-on-edit')
})

test('settings contract: sanitizeSettingsForRenderer includes permissionMode when default', () => {
  const result = sanitizeSettingsForRenderer({
    theme: 'dark',
    fontSize: 14,
    sidebarCollapsed: true,
    permissionMode: 'danger-full-access',
  })
  assert.equal((result as any).permissionMode, 'danger-full-access')
})

test('remote pane root policy: allows descendants within scope root', async () => {
  const base = await mkdtemp(join(tmpdir(), 'studio-pane-root-'))
  try {
    const projectRoot = join(base, 'project')
    const nestedRoot = join(projectRoot, 'src', 'nested')
    await mkdir(nestedRoot, { recursive: true })

    const resolved = await resolveRemotePaneRoot(projectRoot, nestedRoot)
    assert.equal(resolved, await realpath(nestedRoot))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('remote pane root policy: rejects paths outside scope root', async () => {
  const base = await mkdtemp(join(tmpdir(), 'studio-pane-root-'))
  try {
    const projectRoot = join(base, 'project')
    const outsideRoot = join(base, 'outside')
    await mkdir(projectRoot, { recursive: true })
    await mkdir(outsideRoot, { recursive: true })

    await assert.rejects(
      () => resolveRemotePaneRoot(projectRoot, outsideRoot),
      /must stay within the pane project root/,
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
