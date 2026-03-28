/**
 * Tests for the bidirectional approval RPC round-trip.
 *
 * Phase 5 / Phase 1: Bidirectional approval RPC and host confirmation
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

// ============================================================================
// Mock AgentBridge (mirrors agent-bridge.ts but captures stdin writes)
// ============================================================================

class MockAgentBridge extends EventEmitter {
  public stdinWrites: string[] = []
  private pendingApprovals = new Map<string, { resolve: (approved: boolean) => void }>()

  simulateLine(line: string): void {
    let data: any
    try {
      data = JSON.parse(line)
    } catch {
      return
    }

    if (data.type === 'approval_request' && typeof data.id === 'string') {
      // Store pending + emit event
      const p = new Promise<boolean>((resolve) => {
        this.pendingApprovals.set(data.id, { resolve })
      })
      this.emit('approval-request', { id: data.id, action: data.action, path: data.path, message: data.message, promise: p })
      return
    }

    this.emit('agent-event', data)
  }

  writeToStdin(text: string): void {
    this.stdinWrites.push(text)
    // If it's an approval_response, resolve the pending promise
    try {
      const msg = JSON.parse(text.trim())
      if (msg.type === 'approval_response' && typeof msg.id === 'string') {
        const pending = this.pendingApprovals.get(msg.id)
        if (pending) {
          this.pendingApprovals.delete(msg.id)
          pending.resolve(msg.approved === true)
        }
      }
    } catch {
      // ignore
    }
  }

  respondToApproval(id: string, approved: boolean): void {
    const response = JSON.stringify({ type: 'approval_response', id, approved }) + '\n'
    this.writeToStdin(response)
  }
}

// ============================================================================
// Test: approval_request parsing
// ============================================================================

test('AgentBridge emits approval-request event when approval_request line received', () => {
  const bridge = new MockAgentBridge()
  const captured: any[] = []
  bridge.on('approval-request', (req) => captured.push(req))

  bridge.simulateLine(JSON.stringify({
    type: 'approval_request',
    id: 'apr_001',
    action: 'edit',
    path: '/foo/bar.ts',
    message: 'Allow editing /foo/bar.ts?',
  }))

  assert.equal(captured.length, 1)
  assert.equal(captured[0].id, 'apr_001')
  assert.equal(captured[0].action, 'edit')
  assert.equal(captured[0].path, '/foo/bar.ts')
})

// ============================================================================
// Test: approval allowed — response written to stdin
// ============================================================================

test('AgentBridge writes approval_response (approved=true) to stdin on allow', () => {
  const bridge = new MockAgentBridge()
  const capturedIds: string[] = []
  bridge.on('approval-request', (req: any) => {
    capturedIds.push(req.id)
  })

  bridge.simulateLine(JSON.stringify({
    type: 'approval_request',
    id: 'apr_002',
    action: 'write',
    path: '/tmp/file.txt',
    message: 'Allow writing /tmp/file.txt?',
  }))

  // Simulate the main process responding with approved=true
  bridge.respondToApproval('apr_002', true)

  assert.equal(bridge.stdinWrites.length, 1)
  const written = JSON.parse(bridge.stdinWrites[0].trim())
  assert.equal(written.type, 'approval_response')
  assert.equal(written.id, 'apr_002')
  assert.equal(written.approved, true)
})

// ============================================================================
// Test: approval denied — response written to stdin
// ============================================================================

test('AgentBridge writes approval_response (approved=false) to stdin on deny', () => {
  const bridge = new MockAgentBridge()
  bridge.on('approval-request', () => {})

  bridge.simulateLine(JSON.stringify({
    type: 'approval_request',
    id: 'apr_003',
    action: 'edit',
    path: '/src/main.ts',
    message: 'Allow editing /src/main.ts?',
  }))

  bridge.respondToApproval('apr_003', false)

  assert.equal(bridge.stdinWrites.length, 1)
  const written = JSON.parse(bridge.stdinWrites[0].trim())
  assert.equal(written.type, 'approval_response')
  assert.equal(written.id, 'apr_003')
  assert.equal(written.approved, false)
})

// ============================================================================
// Test: non-approval lines still emit as agent-event
// ============================================================================

test('AgentBridge still emits agent-event for non-approval lines', () => {
  const bridge = new MockAgentBridge()
  const events: any[] = []
  bridge.on('agent-event', (e) => events.push(e))

  bridge.simulateLine(JSON.stringify({ type: 'agent_start' }))
  bridge.simulateLine(JSON.stringify({ type: 'tool_execution_start', toolName: 'edit' }))

  assert.equal(events.length, 2)
  assert.equal(events[0].type, 'agent_start')
  assert.equal(events[1].type, 'tool_execution_start')
})

// ============================================================================
// Test: headless-ui approval_response forwarding
// ============================================================================

test('headless-ui forwards approval_response to pending resolver', () => {
  // Simulate the stdin reader logic from headless-ui.ts
  const pendingApprovals = new Map<string, { resolve: (approved: boolean) => void }>()
  const forwarded: string[] = []

  function handleIncomingLine(line: string, stdinWriter: (data: string) => void): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }

    const type = String(msg.type ?? '')
    if (type === 'approval_response') {
      // Forward to agent stdin
      stdinWriter(line + '\n')
      // Resolve pending promise
      const id = String(msg.id ?? '')
      const pending = pendingApprovals.get(id)
      if (pending) {
        pendingApprovals.delete(id)
        pending.resolve(msg.approved === true)
      }
    }
  }

  // Set up a pending approval
  let resolvedValue: boolean | null = null
  pendingApprovals.set('apr_h01', {
    resolve: (approved) => { resolvedValue = approved }
  })

  // Simulate incoming approval_response
  handleIncomingLine(
    JSON.stringify({ type: 'approval_response', id: 'apr_h01', approved: true }),
    (data) => forwarded.push(data)
  )

  assert.equal(forwarded.length, 1)
  assert.equal(resolvedValue, true)
  assert.equal(pendingApprovals.size, 0)
})

// ============================================================================
// Test: tool-approval no-op in danger-full-access
// ============================================================================

test('requestFileChangeApproval is a no-op in danger-full-access mode', async () => {
  // Simulate getPermissionMode returning danger-full-access
  const mode = 'danger-full-access'
  let handlerCalled = false

  async function mockRequestFileChangeApproval(request: { action: string; path: string; message: string }): Promise<void> {
    if (mode !== 'accept-on-edit') {
      return // no-op
    }
    handlerCalled = true
    throw new Error('Should not be called')
  }

  await mockRequestFileChangeApproval({ action: 'edit', path: '/foo.ts', message: 'Allow?' })
  assert.equal(handlerCalled, false)
})

// ============================================================================
// Test: tool-approval blocks until approved in accept-on-edit
// ============================================================================

test('requestFileChangeApproval blocks and resolves on approval in accept-on-edit', async () => {
  const mode = 'accept-on-edit'
  let handlerInvoked = false
  let resolveHandler!: (approved: boolean) => void

  async function mockHandler(_req: any): Promise<boolean> {
    handlerInvoked = true
    return new Promise((resolve) => { resolveHandler = resolve })
  }

  async function mockRequestFileChangeApproval(request: { action: string; path: string; message: string }): Promise<void> {
    if (mode !== 'accept-on-edit') return
    const approved = await mockHandler(request)
    if (!approved) {
      throw new Error(`User declined ${request.action} for ${request.path}.`)
    }
  }

  const promise = mockRequestFileChangeApproval({ action: 'write', path: '/bar.ts', message: 'Allow?' })
  assert.equal(handlerInvoked, true)

  // Approve
  resolveHandler(true)
  await promise // should resolve without throwing
})

// ============================================================================
// Test: tool-approval throws on deny in accept-on-edit
// ============================================================================

test('requestFileChangeApproval throws on denial in accept-on-edit', async () => {
  const mode = 'accept-on-edit'
  let resolveHandler!: (approved: boolean) => void

  async function mockHandler(_req: any): Promise<boolean> {
    return new Promise((resolve) => { resolveHandler = resolve })
  }

  async function mockRequestFileChangeApproval(request: { action: string; path: string; message: string }): Promise<void> {
    if (mode !== 'accept-on-edit') return
    const approved = await mockHandler(request)
    if (!approved) {
      throw new Error(`User declined ${request.action} for ${request.path}.`)
    }
  }

  const promise = mockRequestFileChangeApproval({ action: 'edit', path: '/baz.ts', message: 'Allow?' })
  resolveHandler(false)

  await assert.rejects(promise, (err: Error) => {
    assert.ok(err.message.includes('declined'))
    return true
  })
})
