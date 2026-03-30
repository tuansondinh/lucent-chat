/**
 * Tests for host-side ClassifierService behavior.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { ClassifierService } from '../src/main/classifier-service.js'
import type { ClassifierRule, ClassifierContext } from '../src/main/classifier-service.js'

// ============================================================================
// Built-in hard deny patterns — new rules: sed -i, kill -9, killall
// ============================================================================

test('built-in deny: sed -i is always denied', () => {
  const svc = new ClassifierService(mockAuthService)
  assert.equal(svc.evaluateRules('bash', { command: 'sed -i' }, []), 'deny')
  assert.equal(svc.evaluateRules('bash', { command: "sed -i 's/foo/bar/g' README.md" }, []), 'deny')
  assert.equal(svc.evaluateRules('bash', { command: 'sed -i.bak s/x/y/ file.txt' }, []), null)
})

test('built-in deny: sed -n is still allowed (read-only)', () => {
  const svc = new ClassifierService(mockAuthService)
  assert.equal(svc.evaluateRules('bash', { command: 'sed -n p file.txt' }, []), 'allow')
})

test('built-in deny: kill -9 is always denied', () => {
  const svc = new ClassifierService(mockAuthService)
  assert.equal(svc.evaluateRules('bash', { command: 'kill -9' }, []), 'deny')
  assert.equal(svc.evaluateRules('bash', { command: 'kill -9 1234' }, []), 'deny')
  assert.equal(svc.evaluateRules('bash', { command: 'kill -9 $(lsof -t -i:3000)' }, []), 'deny')
})

test('built-in deny: killall is always denied', () => {
  const svc = new ClassifierService(mockAuthService)
  assert.equal(svc.evaluateRules('bash', { command: 'killall node' }, []), 'deny')
  assert.equal(svc.evaluateRules('bash', { command: 'killall -9 electron' }, []), 'deny')
})

test('built-in deny: chained command with sed -i is denied', () => {
  const svc = new ClassifierService(mockAuthService)
  assert.equal(svc.evaluateRules('bash', { command: "grep foo file.txt && sed -i 's/foo/bar/' file.txt" }, []), 'deny')
})

test('built-in deny: chained command with killall is denied', () => {
  const svc = new ClassifierService(mockAuthService)
  assert.equal(svc.evaluateRules('bash', { command: 'npm run build && killall node' }, []), 'deny')
})

// ============================================================================
// evaluateRules tests
// ============================================================================

const mockAuthService = {
  getApiKey: async (provider: string) => 'test-key',
} as any

test('phase3: evaluateRules returns null when rules array is empty', () => {
  const svc = new ClassifierService(mockAuthService)
  // A command that is neither in built-in deny nor built-in allow patterns
  // (npm run test is not in either list — goes to LLM)
  const result = svc.evaluateRules('bash', { command: 'npm run test' }, [])
  assert.equal(result, null)
})

test('phase3: evaluateRules returns deny for exact deny rule match', () => {
  const svc = new ClassifierService(mockAuthService)
  const rules: ClassifierRule[] = [
    { toolName: 'bash', pattern: 'rm -rf /', decision: 'deny' },
  ]
  const result = svc.evaluateRules('bash', { command: 'rm -rf /' }, rules)
  assert.equal(result, 'deny')
})

test('phase3: evaluateRules returns allow for exact allow rule match', () => {
  const svc = new ClassifierService(mockAuthService)
  const rules: ClassifierRule[] = [
    { toolName: 'bash', pattern: 'git status', decision: 'allow' },
  ]
  const result = svc.evaluateRules('bash', { command: 'git status' }, rules)
  assert.equal(result, 'allow')
})

test('phase3: evaluateRules deny rules checked before allow rules (deny wins)', () => {
  const svc = new ClassifierService(mockAuthService)
  // Both deny and allow match the same command — deny should win
  const rules: ClassifierRule[] = [
    { toolName: 'bash', pattern: 'rm *', decision: 'allow' }, // allow first in array
    { toolName: 'bash', pattern: 'rm *', decision: 'deny' },  // deny second
  ]
  const result = svc.evaluateRules('bash', { command: 'rm /tmp/file' }, rules)
  assert.equal(result, 'deny', 'deny rules should always be checked before allow rules')
})

test('phase3: evaluateRules glob wildcard * matches zero or more chars', () => {
  const svc = new ClassifierService(mockAuthService)
  const rules: ClassifierRule[] = [
    { toolName: 'bash', pattern: 'git *', decision: 'allow' },
  ]
  assert.equal(svc.evaluateRules('bash', { command: 'git status' }, rules), 'allow')
  assert.equal(svc.evaluateRules('bash', { command: 'git commit -m "test"' }, rules), 'allow')
  assert.equal(svc.evaluateRules('bash', { command: 'npm test' }, rules), null)
})

test('phase3: evaluateRules glob wildcard ? matches a single char', () => {
  const svc = new ClassifierService(mockAuthService)
  const rules: ClassifierRule[] = [
    { toolName: 'bash', pattern: 'ls ?', decision: 'allow' },
  ]
  assert.equal(svc.evaluateRules('bash', { command: 'ls /' }, rules), 'allow')
  // 'ls /tmp' doesn't match 'ls ?' (more than 1 char after 'ls '),
  // but it DOES match built-in 'ls *' — so result is 'allow' (via built-in), not null
  assert.equal(svc.evaluateRules('bash', { command: 'ls /tmp' }, rules), 'allow')
})

test('phase3: evaluateRules for bash uses command arg', () => {
  const svc = new ClassifierService(mockAuthService)
  const rules: ClassifierRule[] = [
    { toolName: 'bash', pattern: 'sudo *', decision: 'deny' },
  ]
  // bash with command containing sudo
  assert.equal(svc.evaluateRules('bash', { command: 'sudo apt install curl' }, rules), 'deny')
  // bash with no command field → null
  assert.equal(svc.evaluateRules('bash', {}, rules), null)
})

test('phase3: evaluateRules for edit uses file_path arg', () => {
  const svc = new ClassifierService(mockAuthService)
  const rules: ClassifierRule[] = [
    { toolName: 'edit', pattern: '/etc/*', decision: 'deny' },
  ]
  assert.equal(svc.evaluateRules('edit', { file_path: '/etc/hosts' }, rules), 'deny')
  assert.equal(svc.evaluateRules('edit', { file_path: '/home/user/code.ts' }, rules), null)
})

test('phase3: evaluateRules for write uses file_path arg', () => {
  const svc = new ClassifierService(mockAuthService)
  const rules: ClassifierRule[] = [
    { toolName: 'write', pattern: '/tmp/*', decision: 'allow' },
  ]
  assert.equal(svc.evaluateRules('write', { file_path: '/tmp/output.txt' }, rules), 'allow')
  assert.equal(svc.evaluateRules('write', { file_path: '/home/code.ts' }, rules), null)
})

test('phase3: evaluateRules does not cross toolName boundaries', () => {
  const svc = new ClassifierService(mockAuthService)
  const rules: ClassifierRule[] = [
    { toolName: 'bash', pattern: 'rm *', decision: 'deny' },
  ]
  // edit should not match bash rules
  assert.equal(svc.evaluateRules('edit', { file_path: 'rm file.ts' }, rules), null)
})

test('phase3: evaluateRules returns null for unhandled toolName', () => {
  const svc = new ClassifierService(mockAuthService)
  const rules: ClassifierRule[] = [
    { toolName: 'read', pattern: '*', decision: 'allow' },
  ]
  // ClassifierService only handles bash/edit/write for text extraction
  const result = svc.evaluateRules('read', { path: '/tmp/file' }, rules)
  assert.equal(result, null)
})

// ============================================================================
// classifyToolCall: graceful degradation
// ============================================================================

test('phase3: classifyToolCall returns approved=false when no API key (require manual approval)', async () => {
  const noKeyAuthService = { getApiKey: async () => undefined } as any
  const svc = new ClassifierService(noKeyAuthService)

  const context: ClassifierContext = { userMessages: ['do a thing'], projectInstructions: undefined }
  // Use a command not in built-in allows so it reaches the no-key fallback
  const result = await svc.classifyToolCall('test-pane', 'bash', { command: 'npm install' }, context)
  assert.equal(result.approved, false, 'no API key → deny and require manual approval')
  assert.equal(result.source, 'fallback')
})

// ============================================================================
// classifyToolCall: cache behavior
// ============================================================================

test('phase3: classifyToolCall returns cache hit within 30s', async () => {
  const svc = new ClassifierService(mockAuthService)
  let apiCallCount = 0

  // Override callAnthropicClassifier to track calls
  ;(svc as any).callAnthropicClassifier = async () => {
    apiCallCount++
    return true
  }

  const context: ClassifierContext = { userMessages: ['hello'], projectInstructions: undefined }
  // Use a command not in built-in allows so it reaches the classifier
  const args = { command: 'npm install' }

  // First call — should hit API
  const r1 = await svc.classifyToolCall('pane-cache', 'bash', args, context)
  assert.equal(r1.source, 'classifier')
  assert.equal(apiCallCount, 1)

  // Second call with same args — should be cached
  const r2 = await svc.classifyToolCall('pane-cache', 'bash', args, context)
  assert.equal(r2.source, 'cache')
  assert.equal(apiCallCount, 1, 'API should not be called again within 30s cache window')
})

test('phase3: classifyToolCall bypasses cache for different args', async () => {
  const svc = new ClassifierService(mockAuthService)
  let apiCallCount = 0

  ;(svc as any).callAnthropicClassifier = async () => {
    apiCallCount++
    return true
  }

  const context: ClassifierContext = { userMessages: ['hello'] }

  // Use commands not in built-in allows so they reach the classifier
  await svc.classifyToolCall('pane-cache2', 'bash', { command: 'npm install' }, context)
  await svc.classifyToolCall('pane-cache2', 'bash', { command: 'python script.py' }, context)

  assert.equal(apiCallCount, 2, 'different args should produce different cache keys')
})

test('phase3: Gemini empty MAX_TOKENS response throws for fallback handling', () => {
  const svc = new ClassifierService(mockAuthService)

  assert.throws(
    () => (svc as any).parseGeminiDecision(
      {
        candidates: [
          {
            content: {},
            finishReason: 'MAX_TOKENS',
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 527,
          totalTokenCount: 534,
          thoughtsTokenCount: 7,
        },
        modelVersion: 'gemini-3-flash-preview',
      },
      JSON.stringify({
        candidates: [
          {
            content: {},
            finishReason: 'MAX_TOKENS',
            index: 0,
          },
        ],
      }),
    ),
    /max tokens/i,
  )
})

// ============================================================================
// classifyToolCall: paused pane
// ============================================================================

test('phase3: classifyToolCall returns approved=false when pane is paused', async () => {
  const svc = new ClassifierService(mockAuthService)

  // Manually pause the pane
  ;(svc as any).blockStats.set('paused-pane', { consecutive: 3, total: 5, paused: true })

  const context: ClassifierContext = { userMessages: [] }
  const result = await svc.classifyToolCall('paused-pane', 'bash', { command: 'ls' }, context)
  assert.equal(result.approved, false)
  assert.equal(result.source, 'fallback')
})

// ============================================================================
// Block tracking
// ============================================================================

test('phase3: 10 consecutive denials pause the pane', async () => {
  const svc = new ClassifierService(mockAuthService)
  let callCount = 0
  ;(svc as any).callAnthropicClassifier = async () => {
    callCount++
    return false // always deny
  }

  const context: ClassifierContext = { userMessages: [] }
  const paneId = 'pane-consecutive'

  // 10 denials
  for (let i = 0; i < 10; i++) {
    await svc.classifyToolCall(paneId, 'bash', { command: `cmd-${i}` }, context)
  }

  const state = svc.getPaneState(paneId)
  assert.equal(state.paused, true, 'pane should be paused after 10 consecutive denials')
  assert.equal(state.consecutive, 10)
  assert.equal(state.total, 10)
})

test('phase3: consecutive count resets on approval', async () => {
  const svc = new ClassifierService(mockAuthService)
  let approveNext = false
  ;(svc as any).callAnthropicClassifier = async () => approveNext

  const context: ClassifierContext = { userMessages: [] }
  const paneId = 'pane-reset'

  // 2 denials
  approveNext = false
  await svc.classifyToolCall(paneId, 'bash', { command: 'cmd-a' }, context)
  await svc.classifyToolCall(paneId, 'bash', { command: 'cmd-b' }, context)
  assert.equal(svc.getPaneState(paneId).consecutive, 2)

  // 1 approval resets consecutive
  approveNext = true
  await svc.classifyToolCall(paneId, 'bash', { command: 'cmd-c' }, context)
  assert.equal(svc.getPaneState(paneId).consecutive, 0, 'consecutive should reset after approval')
})

test('phase3: 50 total denials pause the pane', async () => {
  const svc = new ClassifierService(mockAuthService)
  ;(svc as any).callAnthropicClassifier = async () => false

  const context: ClassifierContext = { userMessages: [] }
  const paneId = 'pane-total'

  // Pre-seed with 49 denials but no consecutive pause trigger
  ;(svc as any).blockStats.set(paneId, { consecutive: 0, total: 49, paused: false })

  // 50th denial
  await svc.classifyToolCall(paneId, 'bash', { command: 'cmd-50' }, context)

  const state = svc.getPaneState(paneId)
  assert.equal(state.paused, true, 'pane should be paused after 50 total denials')
  assert.equal(state.total, 50)
})

// ============================================================================
// resume and getPaneState
// ============================================================================

test('phase3: resume() clears paused state and consecutive count', () => {
  const svc = new ClassifierService(mockAuthService)
  ;(svc as any).blockStats.set('pane-resume', { consecutive: 5, total: 10, paused: true })

  svc.resume('pane-resume')

  const state = svc.getPaneState('pane-resume')
  assert.equal(state.paused, false)
  assert.equal(state.consecutive, 0)
  assert.equal(state.total, 10, 'total should not be reset by resume')
})

test('phase3: getPaneState returns default stats for new pane', () => {
  const svc = new ClassifierService(mockAuthService)
  const state = svc.getPaneState('brand-new-pane')
  assert.equal(state.paused, false)
  assert.equal(state.consecutive, 0)
  assert.equal(state.total, 0)
})

// ============================================================================
// Rate limiting: max 5 concurrent classifier API calls per pane
// ============================================================================

test('phase3: rate limiting: max 5 concurrent calls per pane, excess are queued', async () => {
  const svc = new ClassifierService(mockAuthService)

  const callOrder: number[] = []
  let resolvers: Array<() => void> = []

  ;(svc as any).callAnthropicClassifier = async (_key: string, toolName: string) => {
    const id = parseInt(toolName.replace('tool', ''), 10)
    callOrder.push(id)
    await new Promise<void>((resolve) => resolvers.push(resolve))
    return true
  }

  const context: ClassifierContext = { userMessages: [] }
  const paneId = 'pane-rate-limit'

  // Launch 7 calls — only 5 should start immediately
  const promises = Array.from({ length: 7 }, (_, i) =>
    svc.classifyToolCall(paneId, `tool${i + 1}`, { command: `cmd-${i + 1}` }, context)
  )

  // Wait a tick for all promises to be scheduled
  await new Promise((r) => setImmediate(r))

  // First 5 should have started (each cache-missed and started API call)
  assert.ok(
    callOrder.length <= 5,
    `Expected at most 5 concurrent API calls, got ${callOrder.length}`
  )

  // Resolve all pending
  const allResolvers = [...resolvers]
  resolvers = []
  allResolvers.forEach((r) => r())

  // Wait a tick for queued calls to start
  await new Promise((r) => setImmediate(r))
  const moreResolvers = [...resolvers]
  resolvers = []
  moreResolvers.forEach((r) => r())

  // Drain any remaining
  await new Promise((r) => setImmediate(r))
  const lastResolvers = [...resolvers]
  resolvers = []
  lastResolvers.forEach((r) => r())

  // Wait for all to complete
  const results = await Promise.all(promises)
  assert.equal(results.length, 7, 'all 7 calls should eventually complete')
  results.forEach((r, i) => {
    assert.equal(r.approved, true, `call ${i + 1} should be approved`)
  })
})
