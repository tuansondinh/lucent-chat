import test from 'node:test'
import assert from 'node:assert/strict'

// Studio-specific smoke tests that verify basic functionality
// without requiring full Electron runtime

test('Studio package.json has correct structure', () => {
  // Import package.json to verify structure
  import('../package.json').then(pkg => {
    assert.ok(pkg.name, 'Package has name')
    assert.ok(pkg.version, 'Package has version')
    assert.ok(pkg.scripts, 'Package has scripts')
    assert.ok(pkg.scripts['test:renderer'], 'Has renderer test script')
    assert.ok(pkg.scripts['test:main'], 'Has main test script')
    assert.ok(pkg.scripts['test:coverage'], 'Has coverage script')
  })
})

test('Node.js environment variables set correctly', () => {
  // Verify we're in a test environment
  assert.ok(process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development')
  assert.ok(process.env.VITEST || process.env.NODE_ENV === 'test')
})

test('Basic Node.js functionality works', () => {
  // Test that basic Node.js features work
  const obj = { a: 1, b: 2 }
  const result = { ...obj, c: 3 }
  assert.deepEqual(result, { a: 1, b: 2, c: 3 })
})

test('Async operations work', async () => {
  const result = await Promise.resolve(42)
  assert.equal(result, 42)
})