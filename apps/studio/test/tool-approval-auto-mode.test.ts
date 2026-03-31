import test from 'node:test'
import assert from 'node:assert/strict'

import {
  READ_ONLY_TOOLS,
  MUTATING_TOOLS,
  getPermissionMode,
  registerStdioClassifierHandler,
  requestClassifierDecision,
  requestFileChangeApproval,
  resolveClassifierResponse,
  setClassifierHandler,
  setFileChangeApprovalHandler,
} from '../../../packages/pi-coding-agent/src/core/tool-approval.js'

function restorePermissionMode(original: string | undefined): void {
  if (original === undefined) {
    delete process.env.LUCENT_CODE_PERMISSION_MODE
    return
  }
  process.env.LUCENT_CODE_PERMISSION_MODE = original
}

test('tool approval: getPermissionMode recognizes auto mode', () => {
  const original = process.env.LUCENT_CODE_PERMISSION_MODE
  try {
    process.env.LUCENT_CODE_PERMISSION_MODE = 'auto'
    assert.equal(getPermissionMode(), 'auto')
  } finally {
    restorePermissionMode(original)
  }
})

test('tool approval: getPermissionMode defaults to danger-full-access', () => {
  const original = process.env.LUCENT_CODE_PERMISSION_MODE
  try {
    delete process.env.LUCENT_CODE_PERMISSION_MODE
    assert.equal(getPermissionMode(), 'danger-full-access')
  } finally {
    restorePermissionMode(original)
  }
})

test('tool approval: getPermissionMode recognizes accept-on-edit mode', () => {
  const original = process.env.LUCENT_CODE_PERMISSION_MODE
  try {
    process.env.LUCENT_CODE_PERMISSION_MODE = 'accept-on-edit'
    assert.equal(getPermissionMode(), 'accept-on-edit')
  } finally {
    restorePermissionMode(original)
  }
})

test('tool approval: read-only and mutating tool sets expose expected tools', () => {
  assert.ok(READ_ONLY_TOOLS instanceof Set)
  assert.ok(MUTATING_TOOLS instanceof Set)
  assert.ok(READ_ONLY_TOOLS.has('read'))
  assert.ok(READ_ONLY_TOOLS.has('grep'))
  assert.ok(READ_ONLY_TOOLS.has('find'))
  assert.ok(READ_ONLY_TOOLS.has('ls'))
  assert.ok(READ_ONLY_TOOLS.has('lsp'))
  assert.ok(READ_ONLY_TOOLS.has('hashline_read'))
  assert.ok(MUTATING_TOOLS.has('bash'))
  assert.ok(MUTATING_TOOLS.has('edit'))
  assert.ok(MUTATING_TOOLS.has('write'))
  assert.ok(MUTATING_TOOLS.has('hashline_edit'))
})

test('tool approval: classifier gate is a no-op outside auto mode', async () => {
  const original = process.env.LUCENT_CODE_PERMISSION_MODE
  try {
    process.env.LUCENT_CODE_PERMISSION_MODE = 'danger-full-access'
    const result = await requestClassifierDecision({ toolName: 'bash', toolCallId: 'tc1', args: { command: 'rm -rf /' } })
    assert.equal(result, true)
  } finally {
    restorePermissionMode(original)
    setClassifierHandler(null)
  }
})

test('tool approval: auto mode denies when no classifier handler is installed', async () => {
  const original = process.env.LUCENT_CODE_PERMISSION_MODE
  try {
    process.env.LUCENT_CODE_PERMISSION_MODE = 'auto'
    setClassifierHandler(null)
    const result = await requestClassifierDecision({ toolName: 'bash', toolCallId: 'tc2', args: { command: 'ls' } })
    assert.equal(result, false)
  } finally {
    restorePermissionMode(original)
    setClassifierHandler(null)
  }
})

test('tool approval: auto mode forwards tool name and args to the classifier handler', async () => {
  const original = process.env.LUCENT_CODE_PERMISSION_MODE
  const received: Array<{ toolName: string; args: unknown }> = []
  try {
    process.env.LUCENT_CODE_PERMISSION_MODE = 'auto'
    setClassifierHandler(async (req) => {
      received.push({ toolName: req.toolName, args: req.args })
      return true
    })
    const result = await requestClassifierDecision({
      toolName: 'write',
      toolCallId: 'tc3',
      args: { file_path: '/tmp/test.txt' },
    })
    assert.equal(result, true)
    assert.deepEqual(received, [{ toolName: 'write', args: { file_path: '/tmp/test.txt' } }])
  } finally {
    restorePermissionMode(original)
    setClassifierHandler(null)
  }
})

test('tool approval: concurrent auto-mode classifier requests resolve independently', async () => {
  const original = process.env.LUCENT_CODE_PERMISSION_MODE
  try {
    process.env.LUCENT_CODE_PERMISSION_MODE = 'auto'

    const pending = new Map<string, (approved: boolean) => void>()
    setClassifierHandler(async (req) => new Promise<boolean>((resolve) => pending.set(req.toolCallId, resolve)))

    const first = requestClassifierDecision({ toolName: 'bash', toolCallId: 'concurrent-1', args: { command: 'git status' } })
    const second = requestClassifierDecision({ toolName: 'edit', toolCallId: 'concurrent-2', args: { file_path: '/tmp/a.txt' } })

    await new Promise((resolve) => setImmediate(resolve))

    pending.get('concurrent-2')?.(true)
    pending.get('concurrent-1')?.(false)

    const [firstResult, secondResult] = await Promise.all([first, second])
    assert.equal(firstResult, false)
    assert.equal(secondResult, true)
  } finally {
    restorePermissionMode(original)
    setClassifierHandler(null)
  }
})

test('tool approval: file change approvals are only consulted in accept-on-edit mode', async () => {
  const original = process.env.LUCENT_CODE_PERMISSION_MODE
  let handlerCalls = 0

  try {
    setFileChangeApprovalHandler(async () => {
      handlerCalls += 1
      return true
    })

    process.env.LUCENT_CODE_PERMISSION_MODE = 'auto'
    await requestFileChangeApproval({ action: 'write', path: '/tmp/test.txt', message: 'Writing test' })

    process.env.LUCENT_CODE_PERMISSION_MODE = 'danger-full-access'
    await requestFileChangeApproval({ action: 'edit', path: '/tmp/test.txt', message: 'Editing test' })

    process.env.LUCENT_CODE_PERMISSION_MODE = 'accept-on-edit'
    await requestFileChangeApproval({ action: 'write', path: '/tmp/test.txt', message: 'Writing test' })

    assert.equal(handlerCalls, 1)
  } finally {
    restorePermissionMode(original)
    setFileChangeApprovalHandler(null)
  }
})

test('tool approval: stdio classifier responses resolve pending requests by id', async () => {
  const original = process.env.LUCENT_CODE_PERMISSION_MODE
  const originalWrite = process.stdout.write.bind(process.stdout)
  const writtenChunks: string[] = []

  try {
    process.env.LUCENT_CODE_PERMISSION_MODE = 'auto'
    ;(process.stdout.write as unknown as (chunk: string | Uint8Array) => boolean) = (
      chunk: string | Uint8Array,
    ) => {
      writtenChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      return true
    }

    registerStdioClassifierHandler()
    const pendingDecision = requestClassifierDecision({
      toolName: 'bash',
      toolCallId: 'resolve-test',
      args: { command: 'ls' },
    })

    await new Promise((resolve) => setImmediate(resolve))

    assert.ok(writtenChunks.length > 0)
    const requestChunk = writtenChunks.find((chunk) => chunk.includes('"type":"classifier_request"'))
    assert.ok(requestChunk)
    const request = JSON.parse(requestChunk.trim())
    assert.equal(request.type, 'classifier_request')
    assert.equal(request.toolName, 'bash')

    resolveClassifierResponse(request.id, true)
    assert.equal(await pendingDecision, true)
  } finally {
    ;(process.stdout.write as unknown as typeof process.stdout.write) = originalWrite
    restorePermissionMode(original)
    setClassifierHandler(null)
  }
})
