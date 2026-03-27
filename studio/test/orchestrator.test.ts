import test from 'node:test'
import assert from 'node:assert/strict'
import { Orchestrator, type TurnState, type OrchestratorCallbacks } from '../src/main/orchestrator.js'
import { EventEmitter } from 'node:events'

// Mock AgentBridge
class MockAgentBridge extends EventEmitter {
  public prompts: string[] = []
  public aborts = 0
  public abortError: Error | null = null
  public promptError: Error | null = null
  public promptDelay = 0
  public eventSequence: any[] = []

  async prompt(text: string, options?: { streamingBehavior?: 'steer' | 'followUp' }): Promise<void> {
    this.prompts.push(text)
    this.eventSequence.push({ type: 'prompt-called', text, options })

    if (this.promptError) {
      const err = this.promptError
      this.promptError = null
      throw err
    }

    if (this.promptDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.promptDelay))
    }
  }

  async abort(): Promise<void> {
    this.aborts++
    if (this.abortError) {
      throw this.abortError
    }
  }

  onAgentEvent(callback: (event: any) => void): () => void {
    this.on('agent-event', callback)
    return () => this.off('agent-event', callback)
  }

  // Helper to simulate agent events
  simulateEvent(event: any): void {
    this.eventSequence.push({ type: 'agent-event', event })
    this.emit('agent-event', event)
  }

  reset(): void {
    this.prompts = []
    this.aborts = 0
    this.abortError = null
    this.promptError = null
    this.eventSequence = []
    this.removeAllListeners()
  }
}

// Helper to create a mock callbacks collector
function createCallbackCollector() {
  const events: any[] = []
  const callbacks: OrchestratorCallbacks = {
    onChunk: (data) => events.push({ type: 'chunk', ...data }),
    onDone: (data) => events.push({ type: 'done', ...data }),
    onToolStart: (data) => events.push({ type: 'tool-start', ...data }),
    onToolEnd: (data) => events.push({ type: 'tool-end', ...data }),
    onTurnState: (data) => events.push({ type: 'state', ...data }),
    onError: (data) => events.push({ type: 'error', ...data }),
    onThinkingStart: (data) => events.push({ type: 'thinking-start', ...data }),
    onThinkingChunk: (data) => events.push({ type: 'thinking-chunk', ...data }),
    onThinkingEnd: (data) => events.push({ type: 'thinking-end', ...data }),
    onTextBlockStart: (data) => events.push({ type: 'text-block-start', ...data }),
    onTextBlockEnd: (data) => events.push({ type: 'text-block-end', ...data }),
  }
  return { events, callbacks }
}

test('Orchestrator: all 8 states are reachable', async (t) => {
  const agentBridge = new MockAgentBridge()
  const { events, callbacks } = createCallbackCollector()
  const orchestrator = new Orchestrator(agentBridge, callbacks)

  // idle is the initial state (no turn yet)
  const initialTurn = orchestrator.getCurrentTurn()
  assert.equal(initialTurn, null, 'initial state should be null (no turn)')

  // Submit a turn - should go to queued
  const turnId = orchestrator.submitTurn('hello')
  assert.ok(turnId, 'turn ID should be returned')

  // Find the queued state event
  const queuedEvent = events.find((e) => e.type === 'state' && e.state === 'queued')
  assert.ok(queuedEvent, 'should have queued state')
  assert.equal(queuedEvent.turn_id, turnId)

  // Simulate generation starting
  agentBridge.simulateEvent({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_start' },
  })

  // Find the generating state event (transitioned from queued to generating)
  const generatingEvent = events.find((e) => e.type === 'state' && e.state === 'generating')
  assert.ok(generatingEvent, 'should have generating state')

  // For voice input, test listening -> transcribing -> speaking -> playback_pending
  // These are set via setVoicePhase
  orchestrator.setVoicePhase('listening')
  const listeningEvent = events.find((e) => e.type === 'state' && e.state === 'listening')
  assert.ok(listeningEvent, 'should have listening state')

  orchestrator.setVoicePhase('transcribing')
  const transcribingEvent = events.find((e) => e.type === 'state' && e.state === 'transcribing')
  assert.ok(transcribingEvent, 'should have transcribing state')

  orchestrator.setVoicePhase('speaking')
  const speakingEvent = events.find((e) => e.type === 'state' && e.state === 'speaking')
  assert.ok(speakingEvent, 'should have speaking state')

  orchestrator.setVoicePhase('playback_pending')
  const playbackPendingEvent = events.find((e) => e.type === 'state' && e.state === 'playback_pending')
  assert.ok(playbackPendingEvent, 'should have playback_pending state')

  // Test aborted state
  await orchestrator.abortCurrentTurn()
  const abortedEvent = events.find((e) => e.type === 'state' && e.state === 'aborted')
  assert.ok(abortedEvent, 'should have aborted state')

  // After abort, turn should return to idle (in runTurn)
  // We need to simulate the full flow to see idle
  agentBridge.reset()
  events.length = 0

  const turnId2 = orchestrator.submitTurn('test')
  agentBridge.simulateEvent({
    type: 'agent_end',
    messages: [{ role: 'assistant', content: [{ type: 'text', text: 'response' }] }],
  })

  // Wait a bit for async processing
  await new Promise((resolve) => setTimeout(resolve, 50))

  const idleEvent = events.find((e) => e.type === 'state' && e.state === 'idle')
  assert.ok(idleEvent, 'should have idle state after agent_end')
})

test('Orchestrator: followUp bypasses lock', async (t) => {
  const agentBridge = new MockAgentBridge()
  const { events, callbacks } = createCallbackCollector()
  const orchestrator = new Orchestrator(agentBridge, callbacks)

  // Submit a normal turn (acquires lock)
  const normalTurnId = orchestrator.submitTurn('normal turn')

  // Immediately submit a followUp (should bypass lock)
  const followUpTurnId = orchestrator.submitTurn('follow up', 'text', { streamingBehavior: 'followUp' })

  assert.ok(normalTurnId !== followUpTurnId, 'turn IDs should be different')

  // Both should be queued
  const queuedEvents = events.filter((e) => e.type === 'state' && e.state === 'queued')
  assert.equal(queuedEvents.length, 2, 'both turns should be queued')

  // The followUp should prompt immediately without waiting for lock
  assert.ok(agentBridge.prompts.length >= 2, 'both prompts should be sent')
  assert.ok(agentBridge.prompts.includes('normal turn'))
  assert.ok(agentBridge.prompts.includes('follow up'))
})

test('Orchestrator: lock is released on prompt failure', async (t) => {
  const agentBridge = new MockAgentBridge()
  const { events, callbacks } = createCallbackCollector()
  const orchestrator = new Orchestrator(agentBridge, callbacks)

  // Configure agent to fail on first prompt
  agentBridge.promptError = new Error('Prompt failed')

  // Submit a turn
  const turnId = orchestrator.submitTurn('test')

  // Wait for error to be processed
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Should have error callback
  const errorEvent = events.find((e) => e.type === 'error')
  assert.ok(errorEvent, 'should have error event')
  assert.equal(errorEvent.source, 'agent')

  // Should return to idle (lock released)
  const idleEvent = events.find((e) => e.type === 'state' && e.state === 'idle')
  assert.ok(idleEvent, 'should return to idle after error')

  // Verify we can submit another turn (lock was released)
  agentBridge.promptError = null
  const turnId2 = orchestrator.submitTurn('test2')
  assert.ok(turnId2, 'should be able to submit another turn')
})

test('Orchestrator: duplicate/late agent_end handling', async (t) => {
  const agentBridge = new MockAgentBridge()
  const { events, callbacks } = createCallbackCollector()
  const orchestrator = new Orchestrator(agentBridge, callbacks)

  const turnId = orchestrator.submitTurn('test')

  // Send first agent_end
  agentBridge.simulateEvent({
    type: 'agent_end',
    messages: [{ role: 'assistant', content: [{ type: 'text', text: 'response 1' }] }],
  })

  await new Promise((resolve) => setTimeout(resolve, 50))

  // Should have exactly one done event
  const doneEvents = events.filter((e) => e.type === 'done')
  assert.equal(doneEvents.length, 1, 'should have exactly one done event')

  // Send duplicate agent_end
  agentBridge.simulateEvent({
    type: 'agent_end',
    messages: [{ role: 'assistant', content: [{ type: 'text', text: 'response 2' }] }],
  })

  await new Promise((resolve) => setTimeout(resolve, 50))

  // Should still have only one done event (duplicate ignored)
  const doneEventsAfter = events.filter((e) => e.type === 'done')
  assert.equal(doneEventsAfter.length, 1, 'duplicate agent_end should be ignored')
})

test('Orchestrator: abort after agent_end but before lock release', async (t) => {
  const agentBridge = new MockAgentBridge()
  const { events, callbacks } = createCallbackCollector()
  const orchestrator = new Orchestrator(agentBridge, callbacks)

  const turnId = orchestrator.submitTurn('test')

  // Wait for turn to start
  await new Promise((resolve) => setTimeout(resolve, 10))

  // Send agent_end
  agentBridge.simulateEvent({
    type: 'agent_end',
    messages: [{ role: 'assistant', content: [{ type: 'text', text: 'response' }] }],
  })

  // Wait for agent_end processing
  await new Promise((resolve) => setTimeout(resolve, 50))

  // Now try to abort (should be no-op since turn is done)
  await orchestrator.abortCurrentTurn()

  // Should complete normally (abort after agent_end is a no-op)
  const doneEvent = events.find((e) => e.type === 'done')
  assert.ok(doneEvent, 'should complete normally')

  const idleEvent = events.find((e) => e.type === 'state' && e.state === 'idle')
  assert.ok(idleEvent, 'should return to idle')
})

test('Orchestrator: abort during generation', async (t) => {
  const agentBridge = new MockAgentBridge()
  const { events, callbacks } = createCallbackCollector()
  const orchestrator = new Orchestrator(agentBridge, callbacks)

  const turnId = orchestrator.submitTurn('test')

  // Simulate some generation activity
  agentBridge.simulateEvent({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta: 'partial' },
  })

  // Now abort
  await orchestrator.abortCurrentTurn()

  // Should have aborted state
  const abortedEvent = events.find((e) => e.type === 'state' && e.state === 'aborted')
  assert.ok(abortedEvent, 'should have aborted state')

  // Should have called abort on agent bridge
  assert.equal(agentBridge.aborts, 1, 'should have called abort once')
})

test('Orchestrator: queue semantics - concurrent turns are serialized', async (t) => {
  const agentBridge = new MockAgentBridge()
  const { events, callbacks } = createCallbackCollector()
  const orchestrator = new Orchestrator(agentBridge, callbacks)

  // Submit multiple turns rapidly
  const turnIds = [
    orchestrator.submitTurn('first'),
    orchestrator.submitTurn('second'),
    orchestrator.submitTurn('third'),
  ]

  // All should be queued
  const queuedEvents = events.filter((e) => e.type === 'state' && e.state === 'queued')
  assert.equal(queuedEvents.length, 3, 'all turns should be queued')

  // Only first should be in generating state
  const generatingEvents = events.filter((e) => e.type === 'state' && e.state === 'generating')
  assert.equal(generatingEvents.length, 1, 'only first turn should be generating')

  // Complete first turn
  agentBridge.simulateEvent({
    type: 'agent_end',
    messages: [{ role: 'assistant', content: [{ type: 'text', text: 'first response' }] }],
  })

  await new Promise((resolve) => setTimeout(resolve, 50))

  // Second turn should now generate
  const secondGenerating = events.filter((e) => e.type === 'state' && e.state === 'generating')
  assert.ok(secondGenerating.length >= 2, 'second turn should start generating')
})

test('Orchestrator: partial-stream cases - missing text_delta', async (t) => {
  const agentBridge = new MockAgentBridge()
  const { events, callbacks } = createCallbackCollector()
  const orchestrator = new Orchestrator(agentBridge, callbacks)

  const turnId = orchestrator.submitTurn('test')

  // Send only agent_end without any text_delta events
  agentBridge.simulateEvent({
    type: 'agent_end',
    messages: [
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'full response from agent_end' }],
      },
    ],
  })

  await new Promise((resolve) => setTimeout(resolve, 50))

  // Should extract text from agent_end messages
  const doneEvent = events.find((e) => e.type === 'done')
  assert.ok(doneEvent, 'should have done event')
  assert.equal(doneEvent.full_text, 'full response from agent_end')
})

test('Orchestrator: thinking events are forwarded', async (t) => {
  const agentBridge = new MockAgentBridge()
  const { events, callbacks } = createCallbackCollector()
  const orchestrator = new Orchestrator(agentBridge, callbacks)

  orchestrator.submitTurn('test')

  // Wait for orchestrator to set up event listener
  await new Promise((resolve) => setTimeout(resolve, 10))

  // Send thinking events
  agentBridge.simulateEvent({
    type: 'message_update',
    assistantMessageEvent: { type: 'thinking_start' },
  })

  agentBridge.simulateEvent({
    type: 'message_update',
    assistantMessageEvent: { type: 'thinking_delta', delta: 'thinking...' },
  })

  agentBridge.simulateEvent({
    type: 'message_update',
    assistantMessageEvent: { type: 'thinking_end', content: 'complete thought' },
  })

  // Give events time to propagate
  await new Promise((resolve) => setTimeout(resolve, 10))

  // Check events were forwarded
  const thinkingStart = events.find((e) => e.type === 'thinking-start')
  assert.ok(thinkingStart, 'should have thinking-start')

  const thinkingChunk = events.find((e) => e.type === 'thinking-chunk')
  assert.ok(thinkingChunk, 'should have thinking-chunk')
  assert.equal(thinkingChunk.text, 'thinking...')

  const thinkingEnd = events.find((e) => e.type === 'thinking-end')
  assert.ok(thinkingEnd, 'should have thinking-end')
  assert.equal(thinkingEnd.text, 'complete thought')
})

test('Orchestrator: tool events are forwarded', async (t) => {
  const agentBridge = new MockAgentBridge()
  const { events, callbacks } = createCallbackCollector()
  const orchestrator = new Orchestrator(agentBridge, callbacks)

  orchestrator.submitTurn('test')

  // Wait for orchestrator to set up event listener
  await new Promise((resolve) => setTimeout(resolve, 10))

  // Send tool execution events
  agentBridge.simulateEvent({
    type: 'tool_execution_start',
    toolName: 'read_file',
    args: { path: '/test.txt' },
  })

  agentBridge.simulateEvent({
    type: 'tool_execution_end',
    toolName: 'read_file',
    result: { content: 'file content' },
    isError: false,
  })

  // Give events time to propagate
  await new Promise((resolve) => setTimeout(resolve, 10))

  // Check events were forwarded
  const toolStart = events.find((e) => e.type === 'tool-start')
  assert.ok(toolStart, 'should have tool-start')
  assert.equal(toolStart.tool, 'read_file')

  const toolEnd = events.find((e) => e.type === 'tool-end')
  assert.ok(toolEnd, 'should have tool-end')
  assert.equal(toolEnd.tool, 'read_file')
  assert.equal(toolEnd.isError, false)
})

test('Orchestrator: text block events are forwarded', async (t) => {
  const agentBridge = new MockAgentBridge()
  const { events, callbacks } = createCallbackCollector()
  const orchestrator = new Orchestrator(agentBridge, callbacks)

  orchestrator.submitTurn('test')

  // Wait for orchestrator to set up event listener
  await new Promise((resolve) => setTimeout(resolve, 10))

  // Send text block events
  agentBridge.simulateEvent({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_start' },
  })

  agentBridge.simulateEvent({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta: 'Hello ' },
  })

  agentBridge.simulateEvent({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta: 'World' },
  })

  agentBridge.simulateEvent({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_end' },
  })

  // Give events time to propagate
  await new Promise((resolve) => setTimeout(resolve, 10))

  // Check events
  const textBlockStart = events.find((e) => e.type === 'text-block-start')
  assert.ok(textBlockStart, 'should have text-block-start')

  const chunks = events.filter((e) => e.type === 'chunk')
  assert.equal(chunks.length, 2, 'should have two chunks')
  assert.equal(chunks[0].text, 'Hello ')
  assert.equal(chunks[1].text, 'World')

  const textBlockEnd = events.find((e) => e.type === 'text-block-end')
  assert.ok(textBlockEnd, 'should have text-block-end')
})

test('Orchestrator: agent_process_exit is handled', async (t) => {
  const agentBridge = new MockAgentBridge()
  const { events, callbacks } = createCallbackCollector()
  const orchestrator = new Orchestrator(agentBridge, callbacks)

  orchestrator.submitTurn('test')

  // Wait for orchestrator to set up event listener
  await new Promise((resolve) => setTimeout(resolve, 10))

  // Send agent process exit event
  agentBridge.simulateEvent({
    type: 'agent_process_exit',
    reason: 'crash',
  })

  await new Promise((resolve) => setTimeout(resolve, 50))

  // Should have error event
  const errorEvent = events.find((e) => e.type === 'error')
  assert.ok(errorEvent, 'should have error event')
  assert.equal(errorEvent.source, 'agent')

  // Should return to idle
  const idleEvent = events.find((e) => e.type === 'state' && e.state === 'idle')
  assert.ok(idleEvent, 'should return to idle')
})

test('Orchestrator: getCurrentTurn returns current turn', async (t) => {
  const agentBridge = new MockAgentBridge()
  const { callbacks } = createCallbackCollector()
  const orchestrator = new Orchestrator(agentBridge, callbacks)

  // No turn initially
  assert.equal(orchestrator.getCurrentTurn(), null)

  // Submit a turn
  const turnId = orchestrator.submitTurn('test')

  const currentTurn = orchestrator.getCurrentTurn()
  assert.ok(currentTurn, 'should have a current turn')
  assert.equal(currentTurn?.turn_id, turnId)
  assert.equal(currentTurn?.text, 'test')
  assert.equal(currentTurn?.input_type, 'text')
})

test('Orchestrator: voice phase only affects voice turns', async (t) => {
  const agentBridge = new MockAgentBridge()
  const { events, callbacks } = createCallbackCollector()
  const orchestrator = new Orchestrator(agentBridge, callbacks)

  // Submit a text turn
  orchestrator.submitTurn('text input', 'text')

  // Try to set voice phases - should not affect text turn
  orchestrator.setVoicePhase('listening')
  const listeningEvent = events.find((e) => e.type === 'state' && e.state === 'listening')
  assert.ok(!listeningEvent, 'text turn should not get listening state')

  // Submit a voice turn
  events.length = 0
  orchestrator.submitTurn('voice input', 'voice')

  // Now voice phases should work
  orchestrator.setVoicePhase('transcribing')
  const transcribingEvent = events.find((e) => e.type === 'state' && e.state === 'transcribing')
  assert.ok(transcribingEvent, 'voice turn should get transcribing state')
})
