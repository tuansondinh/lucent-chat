/**
 * Phase 2: Skill System (Engine + UI) — tests
 *
 * Covers:
 * - SkillRegistry: discovers skills, validates (no dup triggers, no cycles),
 *   registers trigger→skill map
 * - SkillExecutor: runs steps sequentially, chains output→context,
 *   emits skill-progress events
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ---------------------------------------------------------------------------
// SkillRegistry
// ---------------------------------------------------------------------------

test('SkillRegistry discovers all 5 predefined skill files', async () => {
  const { SkillRegistry } = await import('../src/main/skill-registry.ts')
  const registry = new SkillRegistry()
  await registry.load()

  const skills = registry.listAll()
  assert.ok(skills.length >= 5, `Expected >= 5 skills, got ${skills.length}`)

  const triggers = skills.map((s) => s.trigger)
  assert.ok(triggers.includes('commit'), 'commit trigger present')
  assert.ok(triggers.includes('review-code'), 'review-code trigger present')
  assert.ok(triggers.includes('explain'), 'explain trigger present')
  assert.ok(triggers.includes('refactor'), 'refactor trigger present')
  assert.ok(triggers.includes('test'), 'test trigger present')
})

test('SkillRegistry.getByTrigger returns the correct skill', async () => {
  const { SkillRegistry } = await import('../src/main/skill-registry.ts')
  const registry = new SkillRegistry()
  await registry.load()

  const skill = registry.getByTrigger('commit')
  assert.ok(skill, 'commit skill found')
  assert.equal(skill.trigger, 'commit')
  assert.ok(skill.name.length > 0, 'name is non-empty')
  assert.ok(Array.isArray(skill.steps) && skill.steps.length > 0, 'has steps')
})

test('SkillRegistry.getByTrigger returns null for unknown trigger', async () => {
  const { SkillRegistry } = await import('../src/main/skill-registry.ts')
  const registry = new SkillRegistry()
  await registry.load()

  const skill = registry.getByTrigger('nonexistent-xyz')
  assert.equal(skill, null)
})

test('SkillRegistry rejects skills with duplicate triggers', async () => {
  const { SkillRegistry } = await import('../src/main/skill-registry.ts')

  const tmpDir = await mkdtemp(join(tmpdir(), 'skill-dup-'))
  try {
    const skill1 = `---
name: Skill One
description: First skill
trigger: duplicate
steps:
  - prompt: "Do step 1"
---`
    const skill2 = `---
name: Skill Two
description: Second skill
trigger: duplicate
steps:
  - prompt: "Do step 2"
---`
    await writeFile(join(tmpDir, 'skill1.md'), skill1)
    await writeFile(join(tmpDir, 'skill2.md'), skill2)

    const registry = new SkillRegistry(tmpDir)
    await assert.rejects(
      () => registry.load(),
      /duplicate trigger|duplicate/i,
    )
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test('SkillRegistry skill has valid structure: name, description, trigger, steps[]', async () => {
  const { SkillRegistry } = await import('../src/main/skill-registry.ts')
  const registry = new SkillRegistry()
  await registry.load()

  for (const skill of registry.listAll()) {
    assert.ok(typeof skill.name === 'string' && skill.name.length > 0, `${skill.trigger} name missing`)
    assert.ok(typeof skill.description === 'string' && skill.description.length > 0, `${skill.trigger} description missing`)
    assert.ok(typeof skill.trigger === 'string' && skill.trigger.length > 0, 'trigger missing')
    assert.ok(Array.isArray(skill.steps) && skill.steps.length > 0, `${skill.trigger} steps missing`)
    for (const step of skill.steps) {
      assert.ok(typeof step.prompt === 'string' && step.prompt.length > 0, 'step has prompt')
      if (step.agentType !== undefined) {
        assert.ok(typeof step.agentType === 'string', 'agentType is string if present')
      }
    }
  }
})

// ---------------------------------------------------------------------------
// SkillExecutor
// ---------------------------------------------------------------------------

test('SkillExecutor runs steps sequentially and emits skill-progress events', async () => {
  const { SkillRegistry } = await import('../src/main/skill-registry.ts')
  const { SkillExecutor } = await import('../src/main/skill-executor.ts')

  const registry = new SkillRegistry()
  await registry.load()

  const skill = registry.getByTrigger('explain')
  assert.ok(skill, 'explain skill found')

  const progressEvents = []
  const executor = new SkillExecutor(registry)

  executor.on('skill-progress', (event) => {
    progressEvents.push(event)
  })

  // Mock step runner that resolves immediately
  const mockRunStep = async (step) => {
    return `Output for step: ${step.prompt.slice(0, 20)}`
  }

  const skillId = await executor.execute(skill.trigger, 'explain this code', mockRunStep)
  assert.ok(typeof skillId === 'string' && skillId.length > 0, 'returns skillId')

  // Wait a moment for async steps
  await new Promise((resolve) => setTimeout(resolve, 50))

  assert.ok(progressEvents.length >= 1, 'at least one skill-progress event emitted')
  const firstEvent = progressEvents[0]
  assert.ok(typeof firstEvent.skillId === 'string', 'event has skillId')
  assert.ok(typeof firstEvent.skillName === 'string', 'event has skillName')
  assert.ok(typeof firstEvent.stepIndex === 'number', 'event has stepIndex')
  assert.ok(typeof firstEvent.totalSteps === 'number', 'event has totalSteps')
  assert.ok(['running', 'done', 'error'].includes(firstEvent.status), 'event has valid status')
})

test('SkillExecutor chains step N output into step N+1 context', async () => {
  const { SkillRegistry } = await import('../src/main/skill-registry.ts')
  const { SkillExecutor } = await import('../src/main/skill-executor.ts')

  const tmpDir = await mkdtemp(join(tmpdir(), 'skill-chain-'))
  try {
    const skillMd = `---
name: Chain Test
description: Tests chaining
trigger: chain-test
steps:
  - prompt: "Step 1: analyze the code"
  - prompt: "Step 2: summarize the analysis"
---`
    await writeFile(join(tmpDir, 'chain-test.md'), skillMd)

    const registry = new SkillRegistry(tmpDir)
    await registry.load()

    const executor = new SkillExecutor(registry)

    const stepInputs = []
    const mockRunStep = async (step, context) => {
      stepInputs.push({ prompt: step.prompt, context })
      return `Result of: ${step.prompt}`
    }

    await executor.execute('chain-test', 'initial input', mockRunStep)
    await new Promise((resolve) => setTimeout(resolve, 50))

    assert.equal(stepInputs.length, 2, 'both steps ran')
    // Step 2 context should include step 1's output
    assert.ok(
      stepInputs[1].context.includes('Result of:'),
      'step 2 context includes step 1 output'
    )
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test('SkillExecutor abort() stops execution and emits final aborted status', async () => {
  const { SkillRegistry } = await import('../src/main/skill-registry.ts')
  const { SkillExecutor } = await import('../src/main/skill-executor.ts')

  const tmpDir = await mkdtemp(join(tmpdir(), 'skill-abort-'))
  try {
    const skillMd = `---
name: Abort Test
description: Tests abort
trigger: abort-test
steps:
  - prompt: "Slow step 1"
  - prompt: "Should not run step 2"
---`
    await writeFile(join(tmpDir, 'abort-test.md'), skillMd)

    const registry = new SkillRegistry(tmpDir)
    await registry.load()

    const executor = new SkillExecutor(registry)
    const progressEvents = []

    executor.on('skill-progress', (event) => {
      progressEvents.push(event)
    })

    const mockRunStep = async (_step, _context) => {
      // Simulate slow step
      await new Promise((resolve) => setTimeout(resolve, 200))
      return 'done'
    }

    const skillId = await executor.execute('abort-test', 'input', mockRunStep)

    // Abort immediately
    executor.abort(skillId)

    await new Promise((resolve) => setTimeout(resolve, 300))

    const abortedEvents = progressEvents.filter((e) => e.status === 'aborted' || e.status === 'error')
    assert.ok(abortedEvents.length > 0, 'abort event emitted')
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})
