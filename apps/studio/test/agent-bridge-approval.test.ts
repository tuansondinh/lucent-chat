import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { AgentBridge } from '../src/main/agent-bridge.js'

class FakeStream extends EventEmitter {
  write(_chunk: string): boolean {
    return true
  }
}

function createAttachedBridge() {
  const bridge = new AgentBridge()
  const stdout = new FakeStream()
  const stderr = new FakeStream()
  const stdinWrites: string[] = []
  const stdin = {
    write: (chunk: string) => {
      stdinWrites.push(chunk)
      return true
    },
  }

  const proc = new EventEmitter() as any
  proc.stdout = stdout
  proc.stderr = stderr
  proc.stdin = stdin

  bridge.attach(proc)

  return { bridge, proc, stdout, stdinWrites }
}

test('AgentBridge emits approval-request events from approval_request JSON lines', async () => {
  const { bridge, stdout, proc } = createAttachedBridge()
  const received: any[] = []
  bridge.on('approval-request', (req) => received.push(req))

  stdout.emit(
    'data',
    `${JSON.stringify({
      type: 'approval_request',
      id: 'apr_001',
      action: 'edit',
      path: '/tmp/file.ts',
      message: 'Allow editing /tmp/file.ts?',
    })}\n`,
  )

  assert.equal(received.length, 1)
  assert.equal(received[0].id, 'apr_001')
  assert.equal(received[0].action, 'edit')
  assert.equal(received[0].path, '/tmp/file.ts')

  proc.emit('exit', 0, null)
})

test('AgentBridge respondToApproval writes approval_response JSON to stdin', async () => {
  const { bridge, proc, stdinWrites } = createAttachedBridge()
  const responded: any[] = []
  bridge.on('approval-responded', (event) => responded.push(event))

  bridge.respondToApproval('apr_002', true)

  assert.equal(stdinWrites.length, 1)
  const message = JSON.parse(stdinWrites[0].trim())
  assert.deepEqual(message, {
    type: 'approval_response',
    id: 'apr_002',
    approved: true,
  })
  assert.deepEqual(responded, [{ id: 'apr_002', approved: true }])

  proc.emit('exit', 0, null)
})

test('AgentBridge respondToApproval warns and does nothing when no process is attached', async () => {
  const bridge = new AgentBridge()
  const warnings: string[] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => warnings.push(args.join(' '))

  try {
    bridge.respondToApproval('apr_003', false)
  } finally {
    console.warn = originalWarn
  }

  assert.ok(warnings.some((warning) => warning.includes('respondToApproval')))
})
