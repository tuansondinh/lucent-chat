/**
 * Phase 2: Render subagent activity in ToolCallItem UI
 *
 * Tests verify that ChatMessage.tsx contains the required rendering logic
 * for subItem activity feeds, helper functions, and summary states.
 * These tests run without TS compilation by checking file contents.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const chatMessagePath = new URL('../src/renderer/src/components/ChatMessage.tsx', import.meta.url)

// ============================================================================
// Helper: formatSubItemArgs
// ============================================================================

test('ChatMessage.tsx: formatSubItemArgs helper is defined', async () => {
  const src = await readFile(chatMessagePath, 'utf8')
  assert.match(src, /formatSubItemArgs/, 'formatSubItemArgs helper must be defined')
})

test('ChatMessage.tsx: formatSubItemArgs handles Bash command arg', async () => {
  const src = await readFile(chatMessagePath, 'utf8')
  // Must reference 'command' key for Bash
  assert.match(src, /command/, 'formatSubItemArgs must handle command key for Bash')
})

test('ChatMessage.tsx: formatSubItemArgs handles file_path arg', async () => {
  const src = await readFile(chatMessagePath, 'utf8')
  // Must reference 'file_path' key for Read/Edit
  assert.match(src, /file_path/, 'formatSubItemArgs must handle file_path key')
})

test('ChatMessage.tsx: formatSubItemArgs truncates to ~40 chars', async () => {
  const src = await readFile(chatMessagePath, 'utf8')
  // Must have a slice or substring call to truncate
  assert.match(src, /\.slice\(0,\s*40\)|\.substring\(0,\s*40\)|\.slice\(0,40\)/, 'formatSubItemArgs must truncate to 40 chars')
})

// ============================================================================
// Activity feed rendering — when !done and subItems present
// ============================================================================

test('ChatMessage.tsx: renders subItems activity section when not done', async () => {
  const src = await readFile(chatMessagePath, 'utf8')
  // Must check for !tc.done && tc.subItems
  assert.match(src, /!tc\.done.*subItems|subItems.*!tc\.done/, 'must gate activity section on !done and subItems')
})

test('ChatMessage.tsx: renders toolCall sub-items with arrow prefix', async () => {
  const src = await readFile(chatMessagePath, 'utf8')
  // Must render the → arrow for toolCall items
  assert.match(src, /→/, 'must render → arrow for toolCall sub-items')
})

test('ChatMessage.tsx: renders text sub-items truncated to ~60 chars', async () => {
  const src = await readFile(chatMessagePath, 'utf8')
  // Must truncate text items at ~60 chars
  assert.match(src, /\.slice\(0,\s*60\)|\.substring\(0,\s*60\)|slice\(0, 60\)/, 'must truncate text items to 60 chars')
})

test('ChatMessage.tsx: limits visible sub-items to 8', async () => {
  const src = await readFile(chatMessagePath, 'utf8')
  // Must slice to last 8 items
  assert.match(src, /slice.*-8|MAX_SUB_ITEMS|maxItems\s*=\s*8|8.*earlier|last.*8/, 'must limit visible sub-items to 8')
})

test('ChatMessage.tsx: shows "N earlier" indicator when truncated', async () => {
  const src = await readFile(chatMessagePath, 'utf8')
  assert.match(src, /earlier/, 'must show "N earlier" indicator when sub-items are truncated')
})

// ============================================================================
// Done-state summary
// ============================================================================

test('ChatMessage.tsx: shows collapsed summary when done with subItemCount', async () => {
  const src = await readFile(chatMessagePath, 'utf8')
  // Must check tc.done && tc.subItemCount
  assert.match(src, /tc\.done.*subItemCount|subItemCount.*tc\.done/, 'must show summary when done with subItemCount')
})

test('ChatMessage.tsx: summary shows "tool calls" text', async () => {
  const src = await readFile(chatMessagePath, 'utf8')
  assert.match(src, /tool calls/, 'summary must contain "tool calls" text')
})

// ============================================================================
// Non-subagent tools unaffected
// ============================================================================

test('ChatMessage.tsx: gates activity section on subItems existence', async () => {
  const src = await readFile(chatMessagePath, 'utf8')
  // The gate must be tc.subItems && tc.subItems.length > 0 (or equivalent)
  assert.match(
    src,
    /tc\.subItems.*&&.*tc\.subItems\.length|tc\.subItems\?\.length/,
    'activity section must be gated on tc.subItems && tc.subItems.length',
  )
})

// ============================================================================
// Style classes
// ============================================================================

test('ChatMessage.tsx: activity container has correct bg class', async () => {
  const src = await readFile(chatMessagePath, 'utf8')
  assert.match(src, /bg-bg-primary\/30/, 'activity container must use bg-bg-primary/30')
})

test('ChatMessage.tsx: activity lines use mono font', async () => {
  const src = await readFile(chatMessagePath, 'utf8')
  assert.match(src, /font-mono/, 'activity lines must use font-mono')
})

test('ChatMessage.tsx: activity lines use text-tertiary color', async () => {
  const src = await readFile(chatMessagePath, 'utf8')
  assert.match(src, /text-text-tertiary/, 'activity lines must use text-text-tertiary')
})
