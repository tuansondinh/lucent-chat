/**
 * Integration tests: edit/write tool behaviour under approval policy.
 *
 * Phase 5 / Phase 3: Verify that blocked edit/write operations do not modify
 * files when approval is denied, and that approved operations complete normally.
 *
 * These tests use the real createEditTool / createWriteTool with mock file
 * operations and a mock approval handler so no filesystem I/O is needed.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  setFileChangeApprovalHandler,
  getPermissionMode,
} from '../../../packages/pi-coding-agent/src/core/tool-approval.js'
import { createEditTool } from '../../../packages/pi-coding-agent/src/core/tools/edit.js'
import { createWriteTool } from '../../../packages/pi-coding-agent/src/core/tools/write.js'

// ============================================================================
// Helpers
// ============================================================================

/** Install a one-shot approval handler that immediately resolves with the given decision. */
function withApprovalDecision(approved: boolean, fn: () => Promise<void>): Promise<void> {
  setFileChangeApprovalHandler(async (_req) => approved)
  return fn().finally(() => setFileChangeApprovalHandler(null))
}

/** Install a handler that resolves after `delay` ms with the given decision. */
function withDelayedApproval(approved: boolean, delay: number, fn: () => Promise<void>): Promise<void> {
  setFileChangeApprovalHandler(
    (_req) => new Promise<boolean>((resolve) => setTimeout(() => resolve(approved), delay)),
  )
  return fn().finally(() => setFileChangeApprovalHandler(null))
}

// Ensure we always run in accept-on-edit for these tests
// (by injecting a custom handler the approval function path is exercised
//  regardless of the environment LUCENT_CODE_PERMISSION_MODE value)

// ============================================================================
// write tool — denied
// ============================================================================

test('write tool: does NOT write file when approval is denied', async () => {
  let writeCalled = false

  const writeTool = createWriteTool('/tmp', {
    operations: {
      writeFile: async (_path, _content) => { writeCalled = true },
      mkdir: async (_dir) => {},
    },
  })

  // Force accept-on-edit mode by patching env (tool-approval reads process.env)
  const original = process.env.LUCENT_CODE_PERMISSION_MODE
  process.env.LUCENT_CODE_PERMISSION_MODE = 'accept-on-edit'

  try {
    await withApprovalDecision(false, async () => {
      await assert.rejects(
        () => writeTool.execute('tc1', { path: '/tmp/test.txt', content: 'hello' }),
        (err: Error) => {
          assert.ok(err.message.includes('declined'), `expected 'declined' in: ${err.message}`)
          return true
        },
      )
    })
  } finally {
    if (original === undefined) {
      delete process.env.LUCENT_CODE_PERMISSION_MODE
    } else {
      process.env.LUCENT_CODE_PERMISSION_MODE = original
    }
  }

  assert.equal(writeCalled, false, 'writeFile must not be called when approval is denied')
})

// ============================================================================
// write tool — approved
// ============================================================================

test('write tool: writes file when approval is granted', async () => {
  let writtenContent: string | null = null
  let writtenPath: string | null = null

  const writeTool = createWriteTool('/tmp', {
    operations: {
      writeFile: async (path, content) => {
        writtenPath = path
        writtenContent = content
      },
      mkdir: async (_dir) => {},
    },
  })

  const original = process.env.LUCENT_CODE_PERMISSION_MODE
  process.env.LUCENT_CODE_PERMISSION_MODE = 'accept-on-edit'

  try {
    await withApprovalDecision(true, async () => {
      const result = await writeTool.execute('tc2', { path: 'test.txt', content: 'approved content' })
      assert.ok(result.content.length > 0)
      assert.ok((result.content[0] as any).text.includes('Successfully wrote'))
    })
  } finally {
    if (original === undefined) {
      delete process.env.LUCENT_CODE_PERMISSION_MODE
    } else {
      process.env.LUCENT_CODE_PERMISSION_MODE = original
    }
  }

  assert.ok(writtenPath !== null, 'writeFile should have been called')
  assert.equal(writtenContent, 'approved content', 'correct content should be written')
})

// ============================================================================
// edit tool — denied
// ============================================================================

test('edit tool: does NOT write file when approval is denied', async () => {
  const originalContent = 'Hello world'
  let writtenContent: string | null = null

  const editTool = createEditTool('/tmp', {
    operations: {
      readFile: async (_path) => Buffer.from(originalContent, 'utf-8'),
      writeFile: async (_path, content) => { writtenContent = content },
      access: async (_path) => {},
    },
  })

  const original = process.env.LUCENT_CODE_PERMISSION_MODE
  process.env.LUCENT_CODE_PERMISSION_MODE = 'accept-on-edit'

  try {
    await withApprovalDecision(false, async () => {
      await assert.rejects(
        () => editTool.execute('tc3', { path: 'file.txt', oldText: 'Hello', newText: 'Hi' }),
        (err: Error) => {
          assert.ok(err.message.includes('declined'), `expected 'declined' in: ${err.message}`)
          return true
        },
      )
    })
  } finally {
    if (original === undefined) {
      delete process.env.LUCENT_CODE_PERMISSION_MODE
    } else {
      process.env.LUCENT_CODE_PERMISSION_MODE = original
    }
  }

  assert.equal(writtenContent, null, 'writeFile must not be called when approval is denied')
})

// ============================================================================
// edit tool — approved
// ============================================================================

test('edit tool: writes updated content when approval is granted', async () => {
  const originalContent = 'Hello world\n'
  let writtenContent: string | null = null

  const editTool = createEditTool('/tmp', {
    operations: {
      readFile: async (_path) => Buffer.from(originalContent, 'utf-8'),
      writeFile: async (_path, content) => { writtenContent = content },
      access: async (_path) => {},
    },
  })

  const original = process.env.LUCENT_CODE_PERMISSION_MODE
  process.env.LUCENT_CODE_PERMISSION_MODE = 'accept-on-edit'

  try {
    await withApprovalDecision(true, async () => {
      const result = await editTool.execute('tc4', {
        path: 'file.txt',
        oldText: 'Hello',
        newText: 'Goodbye',
      })
      assert.ok(result.content.length > 0)
      assert.ok((result.content[0] as any).text.includes('Successfully replaced'))
    })
  } finally {
    if (original === undefined) {
      delete process.env.LUCENT_CODE_PERMISSION_MODE
    } else {
      process.env.LUCENT_CODE_PERMISSION_MODE = original
    }
  }

  assert.ok(writtenContent !== null, 'writeFile should have been called')
  assert.ok(writtenContent!.includes('Goodbye'), 'written content should contain replacement')
  assert.ok(!writtenContent!.includes('Hello'), 'old text should be replaced')
})

// ============================================================================
// danger-full-access: operations are not blocked
// ============================================================================

test('write tool: bypass approval in danger-full-access mode', async () => {
  let writeCalled = false

  const writeTool = createWriteTool('/tmp', {
    operations: {
      writeFile: async (_path, _content) => { writeCalled = true },
      mkdir: async (_dir) => {},
    },
  })

  const original = process.env.LUCENT_CODE_PERMISSION_MODE
  delete process.env.LUCENT_CODE_PERMISSION_MODE   // defaults to danger-full-access

  // Even with a denial handler installed, danger-full-access bypasses it
  setFileChangeApprovalHandler(async (_req) => false)
  try {
    const result = await writeTool.execute('tc5', { path: 'bypass.txt', content: 'no approval needed' })
    assert.ok((result.content[0] as any).text.includes('Successfully wrote'))
  } finally {
    setFileChangeApprovalHandler(null)
    if (original !== undefined) {
      process.env.LUCENT_CODE_PERMISSION_MODE = original
    }
  }

  assert.equal(writeCalled, true, 'writeFile should be called in danger-full-access')
})

// ============================================================================
// accept-on-edit: handler is invoked with correct request fields
// ============================================================================

test('write tool: approval request contains correct action and path', async () => {
  const requests: any[] = []

  const writeTool = createWriteTool('/tmp', {
    operations: {
      writeFile: async (_path, _content) => {},
      mkdir: async (_dir) => {},
    },
  })

  const original = process.env.LUCENT_CODE_PERMISSION_MODE
  process.env.LUCENT_CODE_PERMISSION_MODE = 'accept-on-edit'

  setFileChangeApprovalHandler(async (req) => {
    requests.push(req)
    return true   // allow
  })

  try {
    await writeTool.execute('tc6', { path: 'data/config.json', content: '{}' })
  } finally {
    setFileChangeApprovalHandler(null)
    if (original === undefined) {
      delete process.env.LUCENT_CODE_PERMISSION_MODE
    } else {
      process.env.LUCENT_CODE_PERMISSION_MODE = original
    }
  }

  assert.equal(requests.length, 1, 'handler should be invoked once')
  assert.equal(requests[0].action, 'write', 'action should be "write"')
  assert.ok(requests[0].path.includes('config.json'), 'path should contain filename')
  assert.ok(typeof requests[0].message === 'string', 'message should be a string')
})

test('edit tool: approval request contains correct action and path', async () => {
  const requests: any[] = []

  const editTool = createEditTool('/tmp', {
    operations: {
      readFile: async (_path) => Buffer.from('const x = 1;\n', 'utf-8'),
      writeFile: async (_path, _content) => {},
      access: async (_path) => {},
    },
  })

  const original = process.env.LUCENT_CODE_PERMISSION_MODE
  process.env.LUCENT_CODE_PERMISSION_MODE = 'accept-on-edit'

  setFileChangeApprovalHandler(async (req) => {
    requests.push(req)
    return true
  })

  try {
    await editTool.execute('tc7', {
      path: 'src/index.ts',
      oldText: 'const x = 1;',
      newText: 'const x = 2;',
    })
  } finally {
    setFileChangeApprovalHandler(null)
    if (original === undefined) {
      delete process.env.LUCENT_CODE_PERMISSION_MODE
    } else {
      process.env.LUCENT_CODE_PERMISSION_MODE = original
    }
  }

  assert.equal(requests.length, 1, 'handler should be invoked once')
  assert.equal(requests[0].action, 'edit', 'action should be "edit"')
  assert.ok(requests[0].path.includes('index.ts'), 'path should contain filename')
})
