/**
 * Phase 2: Agent-Side beforeToolCall Gate — auto mode
 *
 * Tests:
 * - READ_ONLY_TOOLS set contains expected tools
 * - MUTATING_TOOLS set contains expected tools
 * - requestClassifierDecision: read-only tools auto-approve in auto mode
 * - requestClassifierDecision: mutating tools go through classifier in auto mode
 * - requestClassifierDecision: denials produce correct block result
 * - Concurrent classifier requests each get their own pending promise
 * - requestFileChangeApproval short-circuits for 'auto' mode (not accept-on-edit)
 */

import test from 'node:test'
import assert from 'node:assert/strict'

// Import tool-approval directly (monorepo path from apps/studio/test/)
import {
  READ_ONLY_TOOLS,
  MUTATING_TOOLS,
  getPermissionMode,
  requestClassifierDecision,
  requestFileChangeApproval,
  setClassifierHandler,
  setFileChangeApprovalHandler,
  resolveClassifierResponse,
} from '../../../packages/pi-coding-agent/src/core/tool-approval.js'

// ============================================================================
// READ_ONLY_TOOLS set tests
// ============================================================================

test('phase2: READ_ONLY_TOOLS is exported as a Set', () => {
  assert.ok(READ_ONLY_TOOLS instanceof Set, 'READ_ONLY_TOOLS should be a Set')
})

test('phase2: READ_ONLY_TOOLS contains read', () => {
  assert.ok(READ_ONLY_TOOLS.has('read'), 'READ_ONLY_TOOLS should contain read')
})

test('phase2: READ_ONLY_TOOLS contains grep', () => {
  assert.ok(READ_ONLY_TOOLS.has('grep'), 'READ_ONLY_TOOLS should contain grep')
})

test('phase2: READ_ONLY_TOOLS contains find', () => {
  assert.ok(READ_ONLY_TOOLS.has('find'), 'READ_ONLY_TOOLS should contain find')
})

test('phase2: READ_ONLY_TOOLS contains ls', () => {
  assert.ok(READ_ONLY_TOOLS.has('ls'), 'READ_ONLY_TOOLS should contain ls')
})

test('phase2: READ_ONLY_TOOLS contains lsp', () => {
  assert.ok(READ_ONLY_TOOLS.has('lsp'), 'READ_ONLY_TOOLS should contain lsp')
})

test('phase2: READ_ONLY_TOOLS contains hashline_read', () => {
  assert.ok(READ_ONLY_TOOLS.has('hashline_read'), 'READ_ONLY_TOOLS should contain hashline_read')
})

// ============================================================================
// MUTATING_TOOLS set tests
// ============================================================================

test('phase2: MUTATING_TOOLS is exported as a Set', () => {
  assert.ok(MUTATING_TOOLS instanceof Set, 'MUTATING_TOOLS should be a Set')
})

test('phase2: MUTATING_TOOLS contains bash', () => {
  assert.ok(MUTATING_TOOLS.has('bash'), 'MUTATING_TOOLS should contain bash')
})

test('phase2: MUTATING_TOOLS contains edit', () => {
  assert.ok(MUTATING_TOOLS.has('edit'), 'MUTATING_TOOLS should contain edit')
})

test('phase2: MUTATING_TOOLS contains write', () => {
  assert.ok(MUTATING_TOOLS.has('write'), 'MUTATING_TOOLS should contain write')
})

test('phase2: MUTATING_TOOLS contains hashline_edit', () => {
  assert.ok(MUTATING_TOOLS.has('hashline_edit'), 'MUTATING_TOOLS should contain hashline_edit')
})

// ============================================================================
// requestClassifierDecision: auto mode gate behavior
// ============================================================================

test('phase2: requestClassifierDecision returns true when mode is danger-full-access (no-op passthrough)', async () => {
  const original = process.env.GSD_STUDIO_PERMISSION_MODE
  try {
    process.env.GSD_STUDIO_PERMISSION_MODE = 'danger-full-access'
    const result = await requestClassifierDecision({ toolName: 'bash', toolCallId: 'tc1', args: { command: 'rm -rf /' } })
    assert.equal(result, true, 'non-auto mode should always return true')
  } finally {
    if (original === undefined) delete process.env.GSD_STUDIO_PERMISSION_MODE
    else process.env.GSD_STUDIO_PERMISSION_MODE = original
    setClassifierHandler(null)
  }
})

test('phase2: requestClassifierDecision returns true when mode is accept-on-edit (no-op passthrough)', async () => {
  const original = process.env.GSD_STUDIO_PERMISSION_MODE
  try {
    process.env.GSD_STUDIO_PERMISSION_MODE = 'accept-on-edit'
    const result = await requestClassifierDecision({ toolName: 'edit', toolCallId: 'tc1', args: { file_path: '/etc/passwd' } })
    assert.equal(result, true, 'accept-on-edit mode should always return true from requestClassifierDecision')
  } finally {
    if (original === undefined) delete process.env.GSD_STUDIO_PERMISSION_MODE
    else process.env.GSD_STUDIO_PERMISSION_MODE = original
    setClassifierHandler(null)
  }
})

test('phase2: requestClassifierDecision returns false when mode is auto and handler denies', async () => {
  const original = process.env.GSD_STUDIO_PERMISSION_MODE
  try {
    process.env.GSD_STUDIO_PERMISSION_MODE = 'auto'
    setClassifierHandler(async (_req) => false)
    const result = await requestClassifierDecision({ toolName: 'bash', toolCallId: 'tc2', args: { command: 'rm -rf /' } })
    assert.equal(result, false, 'handler deny should return false')
  } finally {
    if (original === undefined) delete process.env.GSD_STUDIO_PERMISSION_MODE
    else process.env.GSD_STUDIO_PERMISSION_MODE = original
    setClassifierHandler(null)
  }
})

test('phase2: requestClassifierDecision returns true when mode is auto and handler approves', async () => {
  const original = process.env.GSD_STUDIO_PERMISSION_MODE
  try {
    process.env.GSD_STUDIO_PERMISSION_MODE = 'auto'
    setClassifierHandler(async (_req) => true)
    const result = await requestClassifierDecision({ toolName: 'bash', toolCallId: 'tc3', args: { command: 'git status' } })
    assert.equal(result, true, 'handler approve should return true')
  } finally {
    if (original === undefined) delete process.env.GSD_STUDIO_PERMISSION_MODE
    else process.env.GSD_STUDIO_PERMISSION_MODE = original
    setClassifierHandler(null)
  }
})

test('phase2: requestClassifierDecision passes toolName and args to the handler', async () => {
  const original = process.env.GSD_STUDIO_PERMISSION_MODE
  const received: { toolName: string; args: any }[] = []
  try {
    process.env.GSD_STUDIO_PERMISSION_MODE = 'auto'
    setClassifierHandler(async (req) => {
      received.push({ toolName: req.toolName, args: req.args })
      return true
    })
    await requestClassifierDecision({ toolName: 'write', toolCallId: 'tc4', args: { file_path: '/tmp/test.txt' } })
    assert.equal(received.length, 1, 'handler should be called once')
    assert.equal(received[0].toolName, 'write')
    assert.deepEqual(received[0].args, { file_path: '/tmp/test.txt' })
  } finally {
    if (original === undefined) delete process.env.GSD_STUDIO_PERMISSION_MODE
    else process.env.GSD_STUDIO_PERMISSION_MODE = original
    setClassifierHandler(null)
  }
})

// ============================================================================
// Concurrent classifier requests
// ============================================================================

test('phase2: concurrent classifier requests each get their own pending promise (resolved independently)', async () => {
  const original = process.env.GSD_STUDIO_PERMISSION_MODE
  try {
    process.env.GSD_STUDIO_PERMISSION_MODE = 'auto'

    // Track handler calls by toolCallId
    const pendingMap = new Map<string, (approved: boolean) => void>()
    setClassifierHandler(async (req) => {
      return new Promise<boolean>((resolve) => {
        pendingMap.set(req.toolCallId, resolve)
      })
    })

    // Fire two concurrent requests
    const p1 = requestClassifierDecision({ toolName: 'bash', toolCallId: 'concurrent-1', args: { command: 'git status' } })
    const p2 = requestClassifierDecision({ toolName: 'edit', toolCallId: 'concurrent-2', args: { file_path: '/tmp/a.txt' } })

    // Wait a tick for both to be registered
    await new Promise((r) => setImmediate(r))

    // Resolve them in reverse order
    const resolve2 = pendingMap.get('concurrent-2')
    const resolve1 = pendingMap.get('concurrent-1')
    assert.ok(resolve1, 'concurrent-1 should have a pending handler')
    assert.ok(resolve2, 'concurrent-2 should have a pending handler')

    resolve2!(true)
    resolve1!(false)

    const [result1, result2] = await Promise.all([p1, p2])
    assert.equal(result1, false, 'request 1 should be denied')
    assert.equal(result2, true, 'request 2 should be approved')
  } finally {
    if (original === undefined) delete process.env.GSD_STUDIO_PERMISSION_MODE
    else process.env.GSD_STUDIO_PERMISSION_MODE = original
    setClassifierHandler(null)
  }
})

// ============================================================================
// requestFileChangeApproval short-circuits for 'auto' mode
// ============================================================================

test('phase2: requestFileChangeApproval does not call handler when mode is auto', async () => {
  const original = process.env.GSD_STUDIO_PERMISSION_MODE
  let handlerCalled = false
  try {
    process.env.GSD_STUDIO_PERMISSION_MODE = 'auto'
    setFileChangeApprovalHandler(async (_req) => {
      handlerCalled = true
      return true
    })
    // Should not throw, handler should not be called (auto !== accept-on-edit)
    await requestFileChangeApproval({ action: 'write', path: '/tmp/test.txt', message: 'Writing test' })
    assert.equal(handlerCalled, false, 'fileChangeApprovalHandler should NOT be called in auto mode')
  } finally {
    if (original === undefined) delete process.env.GSD_STUDIO_PERMISSION_MODE
    else process.env.GSD_STUDIO_PERMISSION_MODE = original
    setFileChangeApprovalHandler(null)
  }
})

test('phase2: requestFileChangeApproval does not call handler when mode is danger-full-access', async () => {
  const original = process.env.GSD_STUDIO_PERMISSION_MODE
  let handlerCalled = false
  try {
    process.env.GSD_STUDIO_PERMISSION_MODE = 'danger-full-access'
    setFileChangeApprovalHandler(async (_req) => {
      handlerCalled = true
      return true
    })
    await requestFileChangeApproval({ action: 'edit', path: '/tmp/test.txt', message: 'Editing test' })
    assert.equal(handlerCalled, false, 'fileChangeApprovalHandler should NOT be called in danger-full-access mode')
  } finally {
    if (original === undefined) delete process.env.GSD_STUDIO_PERMISSION_MODE
    else process.env.GSD_STUDIO_PERMISSION_MODE = original
    setFileChangeApprovalHandler(null)
  }
})

test('phase2: requestFileChangeApproval calls handler only in accept-on-edit mode', async () => {
  const original = process.env.GSD_STUDIO_PERMISSION_MODE
  let handlerCalled = false
  try {
    process.env.GSD_STUDIO_PERMISSION_MODE = 'accept-on-edit'
    setFileChangeApprovalHandler(async (_req) => {
      handlerCalled = true
      return true
    })
    await requestFileChangeApproval({ action: 'write', path: '/tmp/test.txt', message: 'Writing test' })
    assert.equal(handlerCalled, true, 'fileChangeApprovalHandler SHOULD be called in accept-on-edit mode')
  } finally {
    if (original === undefined) delete process.env.GSD_STUDIO_PERMISSION_MODE
    else process.env.GSD_STUDIO_PERMISSION_MODE = original
    setFileChangeApprovalHandler(null)
  }
})

// ============================================================================
// Block return shape for denied mutating tool calls
// ============================================================================

test('phase2: denied requestClassifierDecision in auto mode returns false (agent constructs block)', async () => {
  const original = process.env.GSD_STUDIO_PERMISSION_MODE
  try {
    process.env.GSD_STUDIO_PERMISSION_MODE = 'auto'
    setClassifierHandler(async (_req) => false)

    const result = await requestClassifierDecision({
      toolName: 'bash',
      toolCallId: 'block-test',
      args: { command: 'sudo rm -rf /' },
    })

    // The gate in agent-session.ts checks `if (!approved) return { block: true, reason: ... }`
    // Here we just verify requestClassifierDecision returns false when denied
    assert.equal(result, false)
  } finally {
    if (original === undefined) delete process.env.GSD_STUDIO_PERMISSION_MODE
    else process.env.GSD_STUDIO_PERMISSION_MODE = original
    setClassifierHandler(null)
  }
})

// ============================================================================
// resolveClassifierResponse correctly resolves a pending classification
// ============================================================================

test('phase2: resolveClassifierResponse resolves pending classification by id', async () => {
  const original = process.env.GSD_STUDIO_PERMISSION_MODE
  try {
    process.env.GSD_STUDIO_PERMISSION_MODE = 'auto'

    // Use the stdio handler which stores pending by id
    const { registerStdioClassifierHandler } = await import('../../../packages/pi-coding-agent/src/core/tool-approval.js')

    // Capture stdout writes to extract the classifier request id
    const writtenChunks: string[] = []
    const originalWrite = process.stdout.write.bind(process.stdout)
    ;(process.stdout.write as any) = (chunk: string) => {
      writtenChunks.push(chunk)
      return true
    }

    try {
      registerStdioClassifierHandler()
      const promise = requestClassifierDecision({
        toolName: 'bash',
        toolCallId: 'resolve-test',
        args: { command: 'ls' },
      })

      // Wait a tick for stdout.write to happen
      await new Promise((r) => setImmediate(r))

      // Parse the id from stdout
      assert.ok(writtenChunks.length > 0, 'should have written to stdout')
      const msg = JSON.parse(writtenChunks[writtenChunks.length - 1].trim())
      assert.equal(msg.type, 'classifier_request')
      assert.equal(msg.toolName, 'bash')

      // Resolve it
      resolveClassifierResponse(msg.id, true)

      const result = await promise
      assert.equal(result, true)
    } finally {
      ;(process.stdout.write as any) = originalWrite
    }
  } finally {
    if (original === undefined) delete process.env.GSD_STUDIO_PERMISSION_MODE
    else process.env.GSD_STUDIO_PERMISSION_MODE = original
    setClassifierHandler(null)
  }
})
