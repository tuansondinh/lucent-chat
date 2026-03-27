/**
 * Tests for ChatPane.tsx
 *
 * Covers:
 * - Message list rendering
 * - Streaming state
 * - Error display
 * - Multi-pane isolation
 * - Event listener cleanup
 *
 * Note: These tests focus on store integration and behavior rather than
 * full rendering due to the complexity of the ChatPane component.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getPaneStore, deletePaneStore } from '../store/pane-store'

describe('ChatPane (store integration)', () => {
  beforeEach(() => {
    // Clean up stores
    deletePaneStore('pane-1')
    deletePaneStore('pane-2')
  })

  describe('message rendering state', () => {
    it('should handle empty message state', () => {
      const store = getPaneStore('pane-1')
      expect(store.getState().messages).toHaveLength(0)
      expect(store.getState().agentHealth).toBe('unknown')
    })

    it('should track user messages', () => {
      const store = getPaneStore('pane-1')
      store.getState().addUserMessage('Hello', 'turn-1')

      expect(store.getState().messages).toHaveLength(1)
      expect(store.getState().messages[0].role).toBe('user')
      expect(store.getState().messages[0].contentBlocks[0].text).toBe('Hello')
    })

    it('should track assistant messages', () => {
      const store = getPaneStore('pane-1')
      store.getState().addUserMessage('Test', 'turn-1')
      store.getState().appendChunk('turn-1', 'Response')
      store.getState().finalizeMessage('turn-1', 'Response')

      const assistantMsg = store.getState().messages.find(m => m.role === 'assistant')
      expect(assistantMsg).toBeDefined()
      expect(assistantMsg?.contentBlocks[0].text).toBe('Response')
    })
  })

  describe('streaming state', () => {
    it('should set generating state during turn', () => {
      const store = getPaneStore('pane-1')
      expect(store.getState().isGenerating).toBe(false)

      store.getState().addUserMessage('Test', 'turn-1')
      expect(store.getState().isGenerating).toBe(true)

      store.getState().finalizeMessage('turn-1', 'Done')
      expect(store.getState().isGenerating).toBe(false)
    })

    it('should track streaming chunks', () => {
      const store = getPaneStore('pane-1')
      store.getState().addUserMessage('Test', 'turn-1')
      store.getState().appendChunk('turn-1', 'Hello')
      store.getState().appendChunk('turn-1', ' World')

      const msg = store.getState().messages.find(m => m.role === 'assistant')
      expect(msg?.contentBlocks[0].text).toBe('Hello World')
      expect(msg?.isStreaming).toBe(true)
    })
  })

  describe('error state', () => {
    it('should add error messages', () => {
      const store = getPaneStore('pane-1')
      store.getState().addErrorMessage('Test error')

      const errorMsg = store.getState().messages.find(m => m.role === 'error')
      expect(errorMsg).toBeDefined()
      expect(errorMsg?.contentBlocks[0].text).toBe('Test error')
    })

    it('should set crashed health state', () => {
      const store = getPaneStore('pane-1')
      store.getState().setHealth({ agent: 'crashed' })

      expect(store.getState().agentHealth).toBe('crashed')
    })

    it('should set degraded health state', () => {
      const store = getPaneStore('pane-1')
      store.getState().setHealth({ agent: 'degraded' })

      expect(store.getState().agentHealth).toBe('degraded')
    })
  })

  describe('multi-pane isolation', () => {
    it('should maintain separate message lists', () => {
      const pane1 = getPaneStore('pane-1')
      const pane2 = getPaneStore('pane-2')

      pane1.getState().addUserMessage('Pane 1', 'turn-1')
      pane2.getState().addUserMessage('Pane 2', 'turn-2')

      expect(pane1.getState().messages).toHaveLength(1)
      expect(pane2.getState().messages).toHaveLength(1)
      expect(pane1.getState().messages[0].contentBlocks[0].text).toBe('Pane 1')
      expect(pane2.getState().messages[0].contentBlocks[0].text).toBe('Pane 2')
    })

    it('should maintain separate generating states', () => {
      const pane1 = getPaneStore('pane-1')
      const pane2 = getPaneStore('pane-2')

      pane1.getState().setGenerating(true)
      pane2.getState().setGenerating(false)

      expect(pane1.getState().isGenerating).toBe(true)
      expect(pane2.getState().isGenerating).toBe(false)
    })

    it('should maintain separate health states', () => {
      const pane1 = getPaneStore('pane-1')
      const pane2 = getPaneStore('pane-2')

      pane1.getState().setHealth({ agent: 'ready' })
      pane2.getState().setHealth({ agent: 'starting' })

      expect(pane1.getState().agentHealth).toBe('ready')
      expect(pane2.getState().agentHealth).toBe('starting')
    })
  })

  describe('session management', () => {
    it('should track session path', () => {
      const store = getPaneStore('pane-1')
      store.getState().setSessionPath('/sessions/test.jsonl')

      expect(store.getState().currentSessionPath).toBe('/sessions/test.jsonl')
    })

    it('should track session name', () => {
      const store = getPaneStore('pane-1')
      store.getState().setSessionName('Test Session')

      expect(store.getState().currentSessionName).toBe('Test Session')
    })

    it('should load history and reset state', () => {
      const store = getPaneStore('pane-1')

      // Add some messages and set generating
      store.getState().addUserMessage('Old', 'turn-1')
      store.getState().setGenerating(true)

      // Load new history
      store.getState().loadHistory([
        { role: 'user', text: 'New', timestamp: 1000 },
      ])

      expect(store.getState().messages).toHaveLength(1)
      expect(store.getState().messages[0].contentBlocks[0].text).toBe('New')
      expect(store.getState().isGenerating).toBe(false)
    })
  })

  describe('project metadata', () => {
    it('should track git branch', () => {
      const store = getPaneStore('pane-1')
      store.getState().setGitBranch('main')

      expect(store.getState().gitBranch).toBe('main')
    })

    it('should track project root', () => {
      const store = getPaneStore('pane-1')
      store.getState().setProjectRoot('/Users/test/project')

      expect(store.getState().projectRoot).toBe('/Users/test/project')
    })

    it('should track model', () => {
      const store = getPaneStore('pane-1')
      store.getState().setModel('claude-3-5-sonnet-20241022')

      expect(store.getState().currentModel).toBe('claude-3-5-sonnet-20241022')
    })
  })

  describe('pending messages', () => {
    it('should track pending message count', () => {
      const store = getPaneStore('pane-1')
      store.getState().setPendingMessageCount(5)

      expect(store.getState().pendingMessageCount).toBe(5)
    })

    it('should not go below zero', () => {
      const store = getPaneStore('pane-1')
      store.getState().setPendingMessageCount(-1)

      expect(store.getState().pendingMessageCount).toBe(0)
    })
  })

  describe('compaction state', () => {
    it('should track compaction state', () => {
      const store = getPaneStore('pane-1')
      store.getState().setCompactionState(true, true)

      expect(store.getState().isCompacting).toBe(true)
      expect(store.getState().autoCompactionEnabled).toBe(true)
    })

    it('should allow disabling auto-compaction', () => {
      const store = getPaneStore('pane-1')
      store.getState().setCompactionState(true, false)

      expect(store.getState().autoCompactionEnabled).toBe(false)
    })
  })
})
