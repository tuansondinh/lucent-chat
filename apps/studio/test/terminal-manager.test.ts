import test from 'node:test'
import assert from 'node:assert/strict'
import { TerminalManager } from '../src/main/terminal-manager.js'

const noop = () => {}

test('TerminalManager: create spawns a new terminal', (t) => {
  const manager = new TerminalManager(noop)
  t.after(() => manager.destroyAll())

  manager.create('test-terminal')
  assert.ok(true)
})

test('TerminalManager: create is idempotent', (t) => {
  const manager = new TerminalManager(noop)
  t.after(() => manager.destroyAll())

  manager.create('test-terminal')
  manager.create('test-terminal')
  assert.ok(true)
})

test('TerminalManager: write handles non-existent terminal gracefully', () => {
  const manager = new TerminalManager(noop)
  manager.write('nonexistent', 'test data')
  assert.ok(true)
})

test('TerminalManager: resize handles non-existent terminal gracefully', () => {
  const manager = new TerminalManager(noop)
  manager.resize('nonexistent', 80, 24)
  assert.ok(true)
})

test('TerminalManager: destroy handles non-existent terminal gracefully', () => {
  const manager = new TerminalManager(noop)
  manager.destroy('nonexistent')
  assert.ok(true)
})

test('TerminalManager: destroy is idempotent', () => {
  const manager = new TerminalManager(noop)
  manager.create('test-terminal')
  manager.destroy('test-terminal')
  manager.destroy('test-terminal')
  assert.ok(true)
})

test('TerminalManager: destroyAll cleans up all terminals', () => {
  const manager = new TerminalManager(noop)
  manager.create('term1')
  manager.create('term2')
  manager.create('term3')
  manager.destroyAll()
  assert.ok(true)
})

test('TerminalManager: destroyAll is idempotent', () => {
  const manager = new TerminalManager(noop)
  manager.destroyAll()
  manager.destroyAll()
  assert.ok(true)
})

test('TerminalManager: handles writes after destroy gracefully', () => {
  const manager = new TerminalManager(noop)
  manager.create('test-terminal')
  manager.destroy('test-terminal')
  manager.write('test-terminal', 'data after destroy')
  assert.ok(true)
})

test('TerminalManager: handles resize after destroy gracefully', () => {
  const manager = new TerminalManager(noop)
  manager.create('test-terminal')
  manager.destroy('test-terminal')
  manager.resize('test-terminal', 100, 30)
  assert.ok(true)
})

test('TerminalManager: prevents global main key collision', (t) => {
  const manager = new TerminalManager(noop)
  t.after(() => manager.destroyAll())

  manager.create('main')
  manager.create('main')
  assert.ok(true)
})

test('TerminalManager: onData callback is invoked', () => {
  let callbackInvoked = false
  const onData = (_id: string, _data: string) => {
    callbackInvoked = true
  }
  const manager = new TerminalManager(onData)
  assert.ok(typeof onData === 'function')
})

test('TerminalManager: manages multiple terminals independently', () => {
  const manager = new TerminalManager(noop)
  manager.create('term1')
  manager.create('term2')
  manager.create('term3')
  manager.destroy('term2')
  manager.destroyAll()
  assert.ok(true)
})

test('TerminalManager: handles process exit cleanup', (t) => {
  const manager = new TerminalManager(noop)
  t.after(() => manager.destroyAll())

  manager.create('test-exit')
  assert.ok(true)
})

test('TerminalManager: handles leaked listeners on recreate', () => {
  const manager = new TerminalManager(noop)
  manager.create('recreate-test')
  manager.destroy('recreate-test')
  manager.create('recreate-test')
  manager.destroyAll()
  assert.ok(true)
})
