/**
 * chat-spacing — single source of truth for chat layout spacing.
 * Change values here to adjust all chat message spacing consistently.
 *
 * Tailwind scale reference:
 *   gap-0 = 0px   gap-0.5 = 2px   gap-1 = 4px   gap-1.5 = 6px
 *   gap-2 = 8px   gap-3 = 12px    gap-4 = 16px
 */

/** Space between consecutive chat messages */
export const MSG_GAP = 'mb-2'

/** Bottom padding of the messages scroll container (gap after last message) */
export const MSG_LIST_PB = 'pb-1'

/** Bottom margin on ThinkingBlock, tool-call wrappers, and inline indicators */
export const MSG_BLOCK_MB = 'mb-1'

/** Top margin on tool-call wrappers */
export const MSG_BLOCK_MT = 'mt-1'
