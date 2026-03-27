import test from 'node:test'
import assert from 'node:assert/strict'

test('node:test smoke test passes', () => {
  assert.equal(1 + 1, 2)
  assert.ok(true)
})

test('async smoke test passes', async () => {
  const result = await Promise.resolve(42)
  assert.equal(result, 42)
})
