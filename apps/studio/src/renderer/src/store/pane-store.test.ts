/**
 * Tests for pane-store.ts
 *
 * Covers:
 * - Message CRUD operations
 * - Optimistic updates and rollback on error
 * - Session switch during generation
 * - Multi-pane isolation
 * - File tab management
 * - Layout tree operations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getPaneStore, deletePaneStore, createPaneChatStore, usePanesStore, splitNode, removeLeaf, collectLeafIds, countLeaves } from './pane-store'
import type { PaneChatState, OpenFile, LayoutNode } from './pane-store'

describe('pane-store', () => {
  beforeEach(() => {
    // Clean up all stores before each test
    deletePaneStore('pane-1')
    deletePaneStore('pane-2')
    deletePaneStore('pane-3')
  })

  describe('createPaneChatStore', () => {
    it('should create a store with initial state', () => {
      const store = createPaneChatStore('test-pane')
      const state = store.getState()

      expect(state.paneId).toBe('test-pane')
      expect(state.messages).toEqual([])
      expect(state.currentTurnId).toBeNull()
      expect(state.agentHealth).toBe('unknown')
      expect(state.isGenerating).toBe(false)
      expect(state.openFiles).toEqual([])
      expect(state.activeFilePath).toBeNull()
      expect(state.gitBranch).toBeNull()
      expect(state.projectRoot).toBe('')
      expect(state.recentFiles).toEqual([])
    })

    it('should create independent stores for different panes', () => {
      const store1 = createPaneChatStore('pane-1')
      const store2 = createPaneChatStore('pane-2')

      store1.getState().addUserMessage('Message from pane 1', 'turn-1')
      store2.getState().addUserMessage('Message from pane 2', 'turn-2')

      expect(store1.getState().messages).toHaveLength(1)
      expect(store1.getState().messages[0].contentBlocks[0].text).toBe('Message from pane 1')
      expect(store2.getState().messages).toHaveLength(1)
      expect(store2.getState().messages[0].contentBlocks[0].text).toBe('Message from pane 2')
    })
  })

  describe('getPaneStore', () => {
    it('should return the same store instance for the same paneId', () => {
      const store1 = getPaneStore('pane-1')
      const store2 = getPaneStore('pane-1')
      expect(store1).toBe(store2)
    })

    it('should create different stores for different paneIds', () => {
      const store1 = getPaneStore('pane-1')
      const store2 = getPaneStore('pane-2')
      expect(store1).not.toBe(store2)
    })
  })

  describe('deletePaneStore', () => {
    it('should remove the store from the registry', () => {
      const store1 = getPaneStore('pane-1')
      deletePaneStore('pane-1')
      const store2 = getPaneStore('pane-1')

      expect(store1).not.toBe(store2)
    })
  })

  describe('message CRUD', () => {
    it('should add a user message', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().addUserMessage('Hello', 'turn-1')

      const state = store.getState()
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0].role).toBe('user')
      expect(state.messages[0].contentBlocks[0].text).toBe('Hello')
      expect(state.messages[0].turn_id).toBe('turn-1')
      expect(state.currentTurnId).toBe('turn-1')
      expect(state.isGenerating).toBe(true)
    })

    it('should append chunks to the last text block', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().addUserMessage('Test', 'turn-1')
      store.getState().appendChunk('turn-1', 'Hello')
      store.getState().appendChunk('turn-1', ' World')

      const state = store.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      expect(lastMessage.role).toBe('assistant')
      expect(lastMessage.contentBlocks).toHaveLength(1)
      expect(lastMessage.contentBlocks[0].text).toBe('Hello World')
      expect(lastMessage.isStreaming).toBe(true)
    })

    it('should create new text block when previous is finalized', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().addUserMessage('Test', 'turn-1')
      store.getState().appendChunk('turn-1', 'First')
      store.getState().finalizeTextBlock('turn-1')
      store.getState().startTextBlock('turn-1')
      store.getState().appendChunk('turn-1', 'Second')

      const state = store.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      expect(lastMessage.contentBlocks).toHaveLength(2)
      expect(lastMessage.contentBlocks[0].text).toBe('First')
      expect(lastMessage.contentBlocks[0].isStreaming).toBe(false)
      expect(lastMessage.contentBlocks[1].text).toBe('Second')
      expect(lastMessage.contentBlocks[1].isStreaming).toBe(true)
    })

    it('should finalize a message', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().addUserMessage('Test', 'turn-1')
      store.getState().appendChunk('turn-1', 'Streaming')
      store.getState().finalizeMessage('turn-1', 'Complete message')

      const state = store.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      expect(lastMessage.isStreaming).toBe(false)
      expect(lastMessage.contentBlocks[0].isStreaming).toBe(false)
      expect(state.isGenerating).toBe(false)
    })

    it('should replace overlapping streamed text with final assembled text', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().addUserMessage('Test', 'turn-1')
      store.getState().appendChunk('turn-1', 'Hey')
      store.getState().finalizeTextBlock('turn-1')
      store.getState().startTextBlock('turn-1')
      store.getState().appendChunk('turn-1', 'Hey! How can I help you today?')
      store.getState().finalizeMessage('turn-1', 'Hey! How can I help you today?')

      const state = store.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      const textBlocks = lastMessage.contentBlocks.filter((b) => b.type === 'text')

      expect(textBlocks).toHaveLength(1)
      expect(textBlocks[0].text).toBe('Hey! How can I help you today?')
      expect(textBlocks[0].isStreaming).toBe(false)
    })

    it('should add tool calls', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().addUserMessage('Test', 'turn-1')
      store.getState().addToolCall('turn-1', 'call-1', 'read_file', { path: '/test.txt' })

      const state = store.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      expect(lastMessage.contentBlocks).toHaveLength(1)
      expect(lastMessage.contentBlocks[0].type).toBe('tool_use')
      expect(lastMessage.contentBlocks[0].tool).toBe('read_file')
      expect(lastMessage.contentBlocks[0].input).toEqual({ path: '/test.txt' })
      expect(lastMessage.contentBlocks[0].done).toBe(false)
    })

    it('should finalize tool calls', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().addUserMessage('Test', 'turn-1')
      store.getState().addToolCall('turn-1', 'call-1', 'read_file', { path: '/test.txt' })
      store.getState().finalizeToolCall('turn-1', 'call-1', 'file content', false)

      const state = store.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      expect(lastMessage.contentBlocks[0].output).toBe('file content')
      expect(lastMessage.contentBlocks[0].isError).toBe(false)
      expect(lastMessage.contentBlocks[0].done).toBe(true)
    })

    it('should handle multiple tool calls in the same turn', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().addUserMessage('Test', 'turn-1')
      store.getState().addToolCall('turn-1', 'call-1', 'read_file', { path: '/test1.txt' })
      store.getState().addToolCall('turn-1', 'call-2', 'read_file', { path: '/test2.txt' })

      const state = store.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      expect(lastMessage.contentBlocks).toHaveLength(2)
      // Tool IDs are generated as turn_id-tool-counter
      expect(lastMessage.contentBlocks[0].id).toMatch(/turn-1-tool-\d+/)
      expect(lastMessage.contentBlocks[1].id).toMatch(/turn-1-tool-\d+/)
    })

    it('should add thinking blocks', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().addUserMessage('Test', 'turn-1')
      store.getState().addThinking('turn-1')

      const state = store.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      expect(lastMessage.contentBlocks).toHaveLength(1)
      expect(lastMessage.contentBlocks[0].type).toBe('thinking')
      expect(lastMessage.isStreaming).toBe(true)
    })

    it('should append to thinking blocks', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().addUserMessage('Test', 'turn-1')
      store.getState().addThinking('turn-1')
      store.getState().appendThinkingChunk('turn-1', 'Thinking...')
      store.getState().appendThinkingChunk('turn-1', ' More...')

      const state = store.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      expect(lastMessage.contentBlocks[0].text).toBe('Thinking... More...')
    })

    it('should finalize thinking blocks', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().addUserMessage('Test', 'turn-1')
      store.getState().addThinking('turn-1')
      store.getState().appendThinkingChunk('turn-1', 'Thinking')
      store.getState().finalizeThinking('turn-1', 'Complete thought')

      const state = store.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      expect(lastMessage.contentBlocks[0].text).toBe('Complete thought')
      expect(lastMessage.contentBlocks[0].isStreaming).toBe(false)
    })

    it('should add error messages', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().addErrorMessage('Something went wrong')

      const state = store.getState()
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0].role).toBe('error')
      expect(state.messages[0].contentBlocks[0].text).toBe('Something went wrong')
      expect(state.isGenerating).toBe(false)
    })
  })

  describe('optimistic updates and rollback', () => {
    it('should maintain isGenerating state correctly during message lifecycle', () => {
      const store = createPaneChatStore('test-pane')

      // Initial state
      expect(store.getState().isGenerating).toBe(false)

      // Add user message - should start generating
      store.getState().addUserMessage('Test', 'turn-1')
      expect(store.getState().isGenerating).toBe(true)

      // Finalize - should stop generating
      store.getState().finalizeMessage('turn-1', 'Response')
      expect(store.getState().isGenerating).toBe(false)
    })

    it('should mark incomplete tool calls as errors on finalization', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().addUserMessage('Test', 'turn-1')
      store.getState().addToolCall('turn-1', 'call-1', 'read_file', { path: '/test.txt' })
      store.getState().finalizeMessage('turn-1', 'Response')

      const state = store.getState()
      const lastMessage = state.messages[state.messages.length - 1]
      const toolBlock = lastMessage.contentBlocks.find(b => b.type === 'tool_use')
      expect(toolBlock?.done).toBe(true)
      expect(toolBlock?.isError).toBe(true)
      expect(toolBlock?.output).toBe('Aborted')
    })

    it('should support setGenerating for manual control', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().setGenerating(true)
      expect(store.getState().isGenerating).toBe(true)
      store.getState().setGenerating(false)
      expect(store.getState().isGenerating).toBe(false)
    })
  })

  describe('session switch during generation', () => {
    it('should load history and reset state', () => {
      const store = createPaneChatStore('test-pane')

      // Add some messages
      store.getState().addUserMessage('Old message', 'turn-1')
      store.getState().appendChunk('turn-1', 'Old response')
      store.getState().setGenerating(true)
      store.getState().setPendingMessageCount(5)

      // Load new history
      store.getState().loadHistory([
        { role: 'user', text: 'New message', timestamp: 1000 },
        { role: 'assistant', text: 'New response', timestamp: 1001 },
      ])

      const state = store.getState()
      expect(state.messages).toHaveLength(2)
      expect(state.messages[0].contentBlocks[0].text).toBe('New message')
      expect(state.messages[1].contentBlocks[0].text).toBe('New response')
      expect(state.currentTurnId).toBeNull()
      expect(state.isGenerating).toBe(false)
      expect(state.pendingMessageCount).toBe(0)
    })

    it('should track session path and name', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().setSessionPath('/sessions/test.jsonl')
      store.getState().setSessionName('Test Session')

      expect(store.getState().currentSessionPath).toBe('/sessions/test.jsonl')
      expect(store.getState().currentSessionName).toBe('Test Session')
    })
  })

  describe('multi-pane isolation', () => {
    it('should maintain separate message histories per pane', () => {
      const pane1 = createPaneChatStore('pane-1')
      const pane2 = createPaneChatStore('pane-2')

      pane1.getState().addUserMessage('Pane 1 message', 'turn-1')
      pane2.getState().addUserMessage('Pane 2 message', 'turn-2')

      expect(pane1.getState().messages).toHaveLength(1)
      expect(pane2.getState().messages).toHaveLength(1)
      expect(pane1.getState().messages[0].turn_id).toBe('turn-1')
      expect(pane2.getState().messages[0].turn_id).toBe('turn-2')
    })

    it('should maintain separate generation states per pane', () => {
      const pane1 = createPaneChatStore('pane-1')
      const pane2 = createPaneChatStore('pane-2')

      pane1.getState().setGenerating(true)
      pane2.getState().setGenerating(false)

      expect(pane1.getState().isGenerating).toBe(true)
      expect(pane2.getState().isGenerating).toBe(false)
    })

    it('should maintain separate agent health states per pane', () => {
      const pane1 = createPaneChatStore('pane-1')
      const pane2 = createPaneChatStore('pane-2')

      pane1.getState().setHealth({ agent: 'ready' })
      pane2.getState().setHealth({ agent: 'starting' })

      expect(pane1.getState().agentHealth).toBe('ready')
      expect(pane2.getState().agentHealth).toBe('starting')
    })

    it('should maintain separate file tabs per pane', () => {
      const pane1 = createPaneChatStore('pane-1')
      const pane2 = createPaneChatStore('pane-2')

      pane1.getState().openFile({
        relativePath: 'file1.txt',
        content: 'content1',
        source: 'user',
        truncated: false,
        isBinary: false,
      })

      pane2.getState().openFile({
        relativePath: 'file2.txt',
        content: 'content2',
        source: 'user',
        truncated: false,
        isBinary: false,
      })

      expect(pane1.getState().openFiles).toHaveLength(1)
      expect(pane2.getState().openFiles).toHaveLength(1)
      expect(pane1.getState().openFiles[0].relativePath).toBe('file1.txt')
      expect(pane2.getState().openFiles[0].relativePath).toBe('file2.txt')
    })
  })

  describe('file tab management', () => {
    it('should open a file tab', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().openFile({
        relativePath: 'test.txt',
        content: 'content',
        source: 'user',
        truncated: false,
        isBinary: false,
      })

      const state = store.getState()
      expect(state.openFiles).toHaveLength(1)
      expect(state.openFiles[0].relativePath).toBe('test.txt')
      expect(state.activeFilePath).toBe('test.txt')
    })

    it('should switch to existing tab when opening same file', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().openFile({
        relativePath: 'test.txt',
        content: 'content1',
        source: 'user',
        truncated: false,
        isBinary: false,
      })

      store.getState().openFile({
        relativePath: 'test.txt',
        content: 'content2',
        source: 'user',
        truncated: false,
        isBinary: false,
      })

      const state = store.getState()
      expect(state.openFiles).toHaveLength(1)
      expect(state.openFiles[0].content).toBe('content2')
      expect(state.activeFilePath).toBe('test.txt')
    })

    it('should add file to recent files when opening', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().openFile({
        relativePath: 'test.txt',
        content: 'content',
        source: 'user',
        truncated: false,
        isBinary: false,
      })

      expect(store.getState().recentFiles[0]).toBe('test.txt')
    })

    it('should maintain recent files list capped at 10', () => {
      const store = createPaneChatStore('test-pane')

      for (let i = 0; i < 15; i++) {
        store.getState().openFile({
          relativePath: `file${i}.txt`,
          content: `content${i}`,
          source: 'user',
          truncated: false,
          isBinary: false,
        })
      }

      expect(store.getState().recentFiles).toHaveLength(10)
      expect(store.getState().recentFiles[0]).toBe('file14.txt')
      expect(store.getState().recentFiles[9]).toBe('file5.txt')
    })

    it('should move file to front of recent when reopened', () => {
      const store = createPaneChatStore('test-pane')

      store.getState().openFile({
        relativePath: 'file1.txt',
        content: 'content1',
        source: 'user',
        truncated: false,
        isBinary: false,
      })

      store.getState().openFile({
        relativePath: 'file2.txt',
        content: 'content2',
        source: 'user',
        truncated: false,
        isBinary: false,
      })

      store.getState().openFile({
        relativePath: 'file1.txt',
        content: 'content1',
        source: 'user',
        truncated: false,
        isBinary: false,
      })

      expect(store.getState().recentFiles[0]).toBe('file1.txt')
      expect(store.getState().recentFiles[1]).toBe('file2.txt')
    })

    it('should close a file tab', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().openFile({
        relativePath: 'test.txt',
        content: 'content',
        source: 'user',
        truncated: false,
        isBinary: false,
      })

      store.getState().closeFile('test.txt')

      const state = store.getState()
      expect(state.openFiles).toHaveLength(0)
      expect(state.activeFilePath).toBeNull()
    })

    it('should select right neighbor when closing active tab', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().openFile({
        relativePath: 'file1.txt',
        content: 'content1',
        source: 'user',
        truncated: false,
        isBinary: false,
      })
      store.getState().openFile({
        relativePath: 'file2.txt',
        content: 'content2',
        source: 'user',
        truncated: false,
        isBinary: false,
      })
      store.getState().openFile({
        relativePath: 'file3.txt',
        content: 'content3',
        source: 'user',
        truncated: false,
        isBinary: false,
      })

      // Files are added to front, so order is file3, file2, file1
      // Active is file3
      expect(store.getState().activeFilePath).toBe('file3.txt')

      // Close file3 (first in list) - should select file2 (right neighbor)
      store.getState().closeFile('file3.txt')
      expect(store.getState().activeFilePath).toBe('file2.txt')
    })

    it('should select left neighbor when closing last tab', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().openFile({
        relativePath: 'file1.txt',
        content: 'content1',
        source: 'user',
        truncated: false,
        isBinary: false,
      })
      store.getState().openFile({
        relativePath: 'file2.txt',
        content: 'content2',
        source: 'user',
        truncated: false,
        isBinary: false,
      })

      // Set active to file1 (last in list)
      store.getState().setActiveFile('file1.txt')
      expect(store.getState().activeFilePath).toBe('file1.txt')

      // Close file1 - should select file2 (right neighbor, which is first)
      store.getState().closeFile('file1.txt')
      expect(store.getState().activeFilePath).toBe('file2.txt')
    })

    it('should open diff tabs', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().openDiff({
        relativePath: 'test.txt',
        diffText: 'diff content',
        status: 'M',
        isBinary: false,
      })

      const state = store.getState()
      expect(state.openFiles).toHaveLength(1)
      expect(state.openFiles[0].kind).toBe('diff')
      expect(state.openFiles[0].relativePath).toBe('test.txt')
      expect(state.openFiles[0].status).toBe('M')
    })

    it('should set active file', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().openFile({
        relativePath: 'file1.txt',
        content: 'content1',
        source: 'user',
        truncated: false,
        isBinary: false,
      })
      store.getState().openFile({
        relativePath: 'file2.txt',
        content: 'content2',
        source: 'user',
        truncated: false,
        isBinary: false,
      })

      store.getState().setActiveFile('file1.txt')
      expect(store.getState().activeFilePath).toBe('file1.txt')
    })
  })

  describe('health and state management', () => {
    it('should map health states correctly', () => {
      const store = createPaneChatStore('test-pane')

      store.getState().setHealth({ agent: 'ready' })
      expect(store.getState().agentHealth).toBe('ready')

      store.getState().setHealth({ agent: 'starting' })
      expect(store.getState().agentHealth).toBe('starting')

      store.getState().setHealth({ agent: 'degraded' })
      expect(store.getState().agentHealth).toBe('degraded')

      store.getState().setHealth({ agent: 'crashed' })
      expect(store.getState().agentHealth).toBe('crashed')

      store.getState().setHealth({ agent: 'stopped' })
      expect(store.getState().agentHealth).toBe('unknown')

      store.getState().setHealth({ agent: 'unknown' })
      expect(store.getState().agentHealth).toBe('unknown')
    })

    it('should set model', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().setModel('claude-3-5-sonnet-20241022')
      expect(store.getState().currentModel).toBe('claude-3-5-sonnet-20241022')
    })

    it('should set pending message count', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().setPendingMessageCount(5)
      expect(store.getState().pendingMessageCount).toBe(5)

      // Should not go below 0
      store.getState().setPendingMessageCount(-1)
      expect(store.getState().pendingMessageCount).toBe(0)
    })

    it('should set compaction state', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().setCompactionState(true, true)
      expect(store.getState().isCompacting).toBe(true)
      expect(store.getState().autoCompactionEnabled).toBe(true)

      store.getState().setCompactionState(false, false)
      expect(store.getState().isCompacting).toBe(false)
      expect(store.getState().autoCompactionEnabled).toBe(false)
    })

    it('should set git branch', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().setGitBranch('main')
      expect(store.getState().gitBranch).toBe('main')

      store.getState().setGitBranch(null)
      expect(store.getState().gitBranch).toBeNull()
    })

    it('should set project root', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().setProjectRoot('/Users/test/project')
      expect(store.getState().projectRoot).toBe('/Users/test/project')
    })

    it('should save and retrieve scroll positions', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().saveScrollPosition('/session1.jsonl', 100)
      store.getState().saveScrollPosition('/session2.jsonl', 200)

      expect(store.getState().scrollPositions['/session1.jsonl']).toBe(100)
      expect(store.getState().scrollPositions['/session2.jsonl']).toBe(200)
    })
  })

  describe('layout tree operations', () => {
    describe('collectLeafIds', () => {
      it('should collect leaf IDs from a leaf node', () => {
        const node: LayoutNode = { type: 'leaf', paneId: 'pane-1' }
        expect(collectLeafIds(node)).toEqual(['pane-1'])
      })

      it('should collect leaf IDs from a split node', () => {
        const node: LayoutNode = {
          type: 'split',
          id: 'split-1',
          orientation: 'horizontal',
          children: [
            { type: 'leaf', paneId: 'pane-1' },
            { type: 'leaf', paneId: 'pane-2' },
          ],
        }
        expect(collectLeafIds(node)).toEqual(['pane-1', 'pane-2'])
      })

      it('should collect leaf IDs from a nested split', () => {
        const node: LayoutNode = {
          type: 'split',
          id: 'split-1',
          orientation: 'horizontal',
          children: [
            { type: 'leaf', paneId: 'pane-1' },
            {
              type: 'split',
              id: 'split-2',
              orientation: 'vertical',
              children: [
                { type: 'leaf', paneId: 'pane-2' },
                { type: 'leaf', paneId: 'pane-3' },
              ],
            },
          ],
        }
        expect(collectLeafIds(node)).toEqual(['pane-1', 'pane-2', 'pane-3'])
      })
    })

    describe('countLeaves', () => {
      it('should count leaves in a leaf node', () => {
        const node: LayoutNode = { type: 'leaf', paneId: 'pane-1' }
        expect(countLeaves(node)).toBe(1)
      })

      it('should count leaves in a split node', () => {
        const node: LayoutNode = {
          type: 'split',
          id: 'split-1',
          orientation: 'horizontal',
          children: [
            { type: 'leaf', paneId: 'pane-1' },
            { type: 'leaf', paneId: 'pane-2' },
          ],
        }
        expect(countLeaves(node)).toBe(2)
      })
    })

    describe('splitNode', () => {
      it('should split a leaf node', () => {
        const root: LayoutNode = { type: 'leaf', paneId: 'pane-1' }
        const result = splitNode(root, 'pane-1', 'pane-2', 'horizontal', 'split-1')

        expect(result.inserted).toBe(true)
        if (result.layout.type === 'split') {
          expect(result.layout.orientation).toBe('horizontal')
          expect(result.layout.children[0]).toEqual({ type: 'leaf', paneId: 'pane-1' })
          expect(result.layout.children[1]).toEqual({ type: 'leaf', paneId: 'pane-2' })
        }
      })

      it('should not split if target pane not found', () => {
        const root: LayoutNode = { type: 'leaf', paneId: 'pane-1' }
        const result = splitNode(root, 'pane-2', 'pane-3', 'horizontal', 'split-1')

        expect(result.inserted).toBe(false)
        expect(result.layout).toEqual(root)
      })

      it('should split the correct leaf in a tree', () => {
        const root: LayoutNode = {
          type: 'split',
          id: 'split-1',
          orientation: 'horizontal',
          children: [
            { type: 'leaf', paneId: 'pane-1' },
            { type: 'leaf', paneId: 'pane-2' },
          ],
        }
        const result = splitNode(root, 'pane-2', 'pane-3', 'vertical', 'split-2')

        expect(result.inserted).toBe(true)
        const leaves = collectLeafIds(result.layout)
        expect(leaves).toEqual(['pane-1', 'pane-2', 'pane-3'])
      })
    })

    describe('removeLeaf', () => {
      it('should remove a leaf from a split', () => {
        const root: LayoutNode = {
          type: 'split',
          id: 'split-1',
          orientation: 'horizontal',
          children: [
            { type: 'leaf', paneId: 'pane-1' },
            { type: 'leaf', paneId: 'pane-2' },
          ],
        }
        const result = removeLeaf(root, 'pane-1')

        expect(result.layout).toEqual({ type: 'leaf', paneId: 'pane-2' })
        expect(result.siblingPaneId).toBe('pane-2')
      })

      it('should return sibling pane id when removing leaf', () => {
        const root: LayoutNode = {
          type: 'split',
          id: 'split-1',
          orientation: 'horizontal',
          children: [
            { type: 'leaf', paneId: 'pane-1' },
            { type: 'leaf', paneId: 'pane-2' },
          ],
        }
        const result = removeLeaf(root, 'pane-1')

        expect(result.siblingPaneId).toBe('pane-2')
      })

      it('should return unchanged if pane not found', () => {
        const root: LayoutNode = { type: 'leaf', paneId: 'pane-1' }
        const result = removeLeaf(root, 'pane-2')

        expect(result.layout).toEqual(root)
        expect(result.siblingPaneId).toBeNull()
      })

      it('should handle nested splits', () => {
        const root: LayoutNode = {
          type: 'split',
          id: 'split-1',
          orientation: 'horizontal',
          children: [
            { type: 'leaf', paneId: 'pane-1' },
            {
              type: 'split',
              id: 'split-2',
              orientation: 'vertical',
              children: [
                { type: 'leaf', paneId: 'pane-2' },
                { type: 'leaf', paneId: 'pane-3' },
              ],
            },
          ],
        }
        const result = removeLeaf(root, 'pane-2')

        const leaves = collectLeafIds(result.layout)
        expect(leaves).toEqual(['pane-1', 'pane-3'])
      })
    })
  })

  describe('usePanesStore', () => {
    beforeEach(() => {
      // Reset the store before each test
      usePanesStore.setState({
        layout: { type: 'leaf', paneId: 'pane-0' },
        activePaneId: 'pane-0',
        nextSplitIndex: 0,
        splitPending: false,
      })
    })

    it('should initialize with default state', () => {
      const state = usePanesStore.getState()
      expect(state.layout).toEqual({ type: 'leaf', paneId: 'pane-0' })
      expect(state.activePaneId).toBe('pane-0')
      expect(state.nextSplitIndex).toBe(0)
      expect(state.splitPending).toBe(false)
    })

    it('should split a pane', () => {
      const { splitPane } = usePanesStore.getState()
      const inserted = splitPane('pane-0', 'pane-1', 'horizontal')

      expect(inserted).toBe(true)
      const state = usePanesStore.getState()
      expect(state.activePaneId).toBe('pane-1')
      expect(state.nextSplitIndex).toBe(1)
    })

    it('should not split if target not found', () => {
      const { splitPane } = usePanesStore.getState()
      const inserted = splitPane('pane-99', 'pane-1', 'horizontal')

      expect(inserted).toBe(false)
    })

    it('should remove a pane', () => {
      const { splitPane, removePane } = usePanesStore.getState()

      // First split to create multiple panes
      splitPane('pane-0', 'pane-1', 'horizontal')

      // Then remove one
      removePane('pane-1')

      const state = usePanesStore.getState()
      const leaves = collectLeafIds(state.layout)
      expect(leaves).toEqual(['pane-0'])
    })

    it('should update active pane when removing active pane', () => {
      const { splitPane, removePane, setActivePane } = usePanesStore.getState()

      splitPane('pane-0', 'pane-1', 'horizontal')
      setActivePane('pane-1')
      expect(usePanesStore.getState().activePaneId).toBe('pane-1')

      removePane('pane-1')
      expect(usePanesStore.getState().activePaneId).toBe('pane-0')
    })

    it('should set active pane', () => {
      const { setActivePane } = usePanesStore.getState()
      setActivePane('pane-1')
      expect(usePanesStore.getState().activePaneId).toBe('pane-1')
    })

    it('should set split pending state', () => {
      const { setSplitPending } = usePanesStore.getState()
      setSplitPending(true)
      expect(usePanesStore.getState().splitPending).toBe(true)
    })
  })

  describe('autoModeState', () => {
    it('should have default autoModeState with paused=false and zero counts', () => {
      const store = createPaneChatStore('test-pane')
      const state = store.getState()

      expect(state.autoModeState).toBeDefined()
      expect(state.autoModeState.paused).toBe(false)
      expect(state.autoModeState.consecutiveBlocks).toBe(0)
      expect(state.autoModeState.totalBlocks).toBe(0)
    })

    it('should update autoModeState via setAutoModeState', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().setAutoModeState({ paused: true, consecutiveBlocks: 3, totalBlocks: 7 })

      const state = store.getState()
      expect(state.autoModeState.paused).toBe(true)
      expect(state.autoModeState.consecutiveBlocks).toBe(3)
      expect(state.autoModeState.totalBlocks).toBe(7)
    })

    it('should reset autoModeState when paused is cleared', () => {
      const store = createPaneChatStore('test-pane')
      store.getState().setAutoModeState({ paused: true, consecutiveBlocks: 3, totalBlocks: 20 })
      store.getState().setAutoModeState({ paused: false, consecutiveBlocks: 0, totalBlocks: 0 })

      const state = store.getState()
      expect(state.autoModeState.paused).toBe(false)
      expect(state.autoModeState.consecutiveBlocks).toBe(0)
      expect(state.autoModeState.totalBlocks).toBe(0)
    })

    it('should isolate autoModeState across panes', () => {
      const store1 = createPaneChatStore('pane-auto-1')
      const store2 = createPaneChatStore('pane-auto-2')

      store1.getState().setAutoModeState({ paused: true, consecutiveBlocks: 3, totalBlocks: 10 })

      expect(store1.getState().autoModeState.paused).toBe(true)
      expect(store2.getState().autoModeState.paused).toBe(false)
    })
  })
})
