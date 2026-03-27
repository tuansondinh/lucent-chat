import test from 'node:test'
import assert from 'node:assert/strict'

// Electron mock boundary smoke tests
// These verify that the mock boundary works for CI without Electron runtime

test('Electron mock boundary - app path', () => {
  // Test that mock app path is available
  assert.ok(process.mockData?.appPath)
  assert.equal(typeof process.mockData.appPath, 'string')
})

test('Electron mock boundary - ipcRenderer', () => {
  // Test that mock ipcRenderer is available
  assert.ok(process.mockData?.ipcRenderer)
  assert.equal(typeof process.mockData.ipcRenderer, 'object')
})

test('Electron mock boundary - shell', () => {
  // Test that mock shell is available
  assert.ok(process.mockData?.shell)
  assert.equal(typeof process.mockData.shell, 'object')
})

test('Node.js environment variables', () => {
  // Verify we're in a test environment
  assert.ok(process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development')
  assert.ok(process.env.VITEST)
})

test('Dependencies loaded correctly', () => {
  // Test that node:test works
  assert.equal(1 + 1, 2)
  assert.ok(true)
})

test('Async operations work', async () => {
  const result = await Promise.resolve(42)
  assert.equal(result, 42)
})
