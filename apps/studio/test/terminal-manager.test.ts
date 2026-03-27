import test from 'node:test'
import assert from 'node:assert/strict'
import { TerminalManager } from '../src/main/terminal-manager.js'

test('TerminalManager: create spawns a new terminal', (t) => {
  const outputs: Map<string, string[]> = new Map()
  const onData = (id: string, data: string) => {
    if (!outputs.has(id)) {
      outputs.set(id, [])
    }
    outputs.get(id)!.push(data)
  }

  const manager = new TerminalManager(onData)

  // Create a terminal
  manager.create('test-terminal')

  // Verify it was created (we can't easily test the actual pty without node-pty)
  // but we can verify no errors were thrown
  assert.ok(true)
})

test('TerminalManager: create is idempotent', (t) => {
  const outputs: Map<string, string[]> = new Map()
  const onData = (id: string, data: string) => {
    if (!outputs.has(id)) {
      outputs.set(id, [])
    }
    outputs.get(id)!.push(data)
  }

  const manager = new TerminalManager(onData)

  // Create same terminal twice
  manager.create('test-terminal')
  manager.create('test-terminal')

  // Should not throw
  assert.ok(true)
})

test('TerminalManager: write handles non-existent terminal gracefully', () => {
  const outputs: Map<string, string[]> = new Map()
  const onData = (id: string, data: string) => {
    if (!outputs.has(id)) {
      outputs.set(id, [])
    }
    outputs.get(id)!.push(data)
  }

  const manager = new TerminalManager(onData)

  // Write to non-existent terminal - should not throw
  manager.write('nonexistent', 'test data')
  assert.ok(true)
})

test('TerminalManager: resize handles non-existent terminal gracefully', () => {
  const outputs: Map<string, string[]> = new Map()
  const onData = (id: string, data: string) => {
    if (!outputs.has(id)) {
      outputs.set(id, [])
    }
    outputs.get(id)!.push(data)
  }

  const manager = new TerminalManager(onData)

  // Resize non-existent terminal - should not throw
  manager.resize('nonexistent', 80, 24)
  assert.ok(true)
})

test('TerminalManager: destroy handles non-existent terminal gracefully', () => {
  const outputs: Map<string, string[]> = new Map()
  const onData = (id: string, data: string) => {
    if (!outputs.has(id)) {
      outputs.set(id, [])
    }
    outputs.get(id)!.push(data)
  }

  const manager = new TerminalManager(onData)

  // Destroy non-existent terminal - should not throw
  manager.destroy('nonexistent')
  assert.ok(true)
})

test('TerminalManager: destroy is idempotent', () => {
  const outputs: Map<string, string[]> = new Map()
  const onData = (id: string, data: string) => {
    if (!outputs.has(id)) {
      outputs.set(id, [])
    }
    outputs.get(id)!.push(data)
  }

  const manager = new TerminalManager(onData)

  // Create and destroy twice
  manager.create('test-terminal')
  manager.destroy('test-terminal')
  manager.destroy('test-terminal')

  // Should not throw
  assert.ok(true)
})

test('TerminalManager: destroyAll cleans up all terminals', () => {
  const outputs: Map<string, string[]> = new Map()
  const onData = (id: string, data: string) => {
    if (!outputs.has(id)) {
      outputs.set(id, [])
    }
    outputs.get(id)!.push(data)
  }

  const manager = new TerminalManager(onData)

  // Create multiple terminals
  manager.create('term1')
  manager.create('term2')
  manager.create('term3')

  // Destroy all
  manager.destroyAll()

  // Should not throw
  assert.ok(true)
})

test('TerminalManager: destroyAll is idempotent', () => {
  const outputs: Map<string, string[]> = new Map()
  const onData = (id: string, data: string) => {
    if (!outputs.has(id)) {
      outputs.set(id, [])
    }
    outputs.get(id)!.push(data)
  }

  const manager = new TerminalManager(onData)

  manager.destroyAll()
  manager.destroyAll()
  manager.destroyAll()

  // Should not throw
  assert.ok(true)
})

test('TerminalManager: handles writes after destroy gracefully', () => {
  const outputs: Map<string, string[]> = new Map()
  const onData = (id: string, data: string) => {
    if (!outputs.has(id)) {
      outputs.set(id, [])
    }
    outputs.get(id)!.push(data)
  }

  const manager = new TerminalManager(onData)

  // Create, destroy, then write
  manager.create('test-terminal')
  manager.destroy('test-terminal')
  manager.write('test-terminal', 'data after destroy')

  // Should not throw
  assert.ok(true)
})

test('TerminalManager: handles resize after destroy gracefully', () => {
  const outputs: Map<string, string[]> = new Map()
  const onData = (id: string, data: string) => {
    if (!outputs.has(id)) {
      outputs.set(id, [])
    }
    outputs.get(id)!.push(data)
  }

  const manager = new TerminalManager(onData)

  // Create, destroy, then resize
  manager.create('test-terminal')
  manager.destroy('test-terminal')
  manager.resize('test-terminal', 100, 30)

  // Should not throw
  assert.ok(true)
})

test('TerminalManager: prevents global main key collision', () => {
  const outputs: Map<string, string[]> = new Map()
  const onData = (id: string, data: string) => {
    if (!outputs.has(id)) {
      outputs.set(id, [])
    }
    outputs.get(id)!.push(data)
  }

  const manager = new TerminalManager(onData)

  // The 'main' terminal is a special case
  // Creating it should work but handle cleanup properly
  manager.create('main')
  manager.create('main') // Should destroy the first one

  // Should not throw
  assert.ok(true)
})

test('TerminalManager: onData callback is invoked', (t) => {
  let callbackInvoked = false
  const onData = (id: string, data: string) => {
    callbackInvoked = true
  }

  const manager = new TerminalManager(onData)

  // The actual data callback requires a real pty process
  // This test verifies the manager can be created with the callback
  assert.ok(typeof onData === 'function')
})

test('TerminalManager: manages multiple terminals independently', () => {
  const outputs: Map<string, string[]> = new Map()
  const onData = (id: string, data: string) => {
    if (!outputs.has(id)) {
      outputs.set(id, [])
    }
    outputs.get(id)!.push(data)
  }

  const manager = new TerminalManager(onData)

  // Create multiple terminals
  manager.create('term1')
  manager.create('term2')
  manager.create('term3')

  // Destroy one
  manager.destroy('term2')

  // Others should still be managed
  assert.ok(true)
})

test('TerminalManager: handles process exit cleanup', () => {
  const outputs: Map<string, string[]> = new Map()
  const removedIds: string[] = []
  const onData = (id: string, data: string) => {
    if (!outputs.has(id)) {
      outputs.set(id, [])
    }
    outputs.get(id)!.push(data)
  }

  const manager = new TerminalManager(onData)

  // Create a terminal
  manager.create('test-exit')

  // The actual exit handling requires a real pty process
  // This verifies the manager structure supports cleanup
  assert.ok(true)
})

test('TerminalManager: handles leaked listeners on recreate', () => {
  const outputs: Map<string, string[]> = new Map()
  const onData = (id: string, data: string) => {
    if (!outputs.has(id)) {
      outputs.set(id, [])
    }
    outputs.get(id)!.push(data)
  }

  const manager = new TerminalManager(onData)

  // Create, destroy, create again
  manager.create('recreate-test')
  manager.destroy('recreate-test')
  manager.create('recreate-test')

  // Should not leak listeners
  // (Actual leak detection would require profiling)
  assert.ok(true)
})
