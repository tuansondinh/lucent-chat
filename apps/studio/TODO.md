# Performance TODO

Remaining optimisations identified during the multi-pane lag investigation.
Items are ordered by estimated impact (highest first).

---

## Medium priority

### 1. Virtualise the message list
**File:** `src/renderer/src/components/ChatPane.tsx`

All messages are rendered in the DOM regardless of scroll position.
After a long conversation with 50+ messages across 2+ panes, that is hundreds
of DOM nodes — each potentially containing heavy markdown / syntax-highlighted
code blocks.

**Fix:** Replace the `<main>` scroll container with `@tanstack/virtual` (or
`react-window`). Only render the ~10–20 messages visible in the viewport.

```tsx
// Rough sketch
import { useVirtualizer } from '@tanstack/react-virtual'

const rowVirtualizer = useVirtualizer({
  count: messages.length,
  getScrollElement: () => scrollContainerRef.current,
  estimateSize: () => 120,
  overscan: 5,
})
```

> Note: Streaming updates to the last message must keep the virtualiser
> anchored to the bottom. Use `scrollToIndex` on the last item when
> `isNearBottomRef.current` is true.

---

### 2. Combine PaneFooter store selectors with `shallow`
**File:** `src/renderer/src/components/ChatPane.tsx` — `PaneFooter` component

Currently 5 separate subscriptions (one per field). Each registers its own
listener, meaning 5 subscription checks fire per store update.

**Fix:** Merge into one selector with `shallow` equality from `zustand/shallow`:

```tsx
import { useShallow } from 'zustand/react/shallow'

const { gitBranch, projectRoot, currentModel, thinkingLevel, permissionMode } =
  getPaneStore(paneId)(
    useShallow((s) => ({
      gitBranch:     s.gitBranch,
      projectRoot:   s.projectRoot,
      currentModel:  s.currentModel,
      thinkingLevel: s.thinkingLevel,
      permissionMode: s.permissionMode,
    }))
  )
```

---

### 3. Debounce the PaneFooter ResizeObserver callback
**File:** `src/renderer/src/components/ChatPane.tsx` — `PaneFooter` component

The `ResizeObserver` calls `setFooterWidth` synchronously in its callback,
which forces a layout recalculation (reflow) and re-render on every resize
event — including during pane drag-resize.

**Fix:** Wrap the state update in `requestAnimationFrame` so it is batched
with the browser's next paint:

```ts
const observer = new ResizeObserver(([entry]) => {
  requestAnimationFrame(() => {
    setFooterWidth(entry.contentRect.width)
  })
})
```

---

## Low priority / future

### 4. Apply the same hot-path store optimisations to `chat.ts`
**File:** `src/renderer/src/store/chat.ts`

The legacy `useChatStore` (used on the web/PWA path) still uses `.map()` over
all messages in `appendChunk` and `appendThinkingChunk`.  Apply the same
index-based slice optimisations made to `pane-store.ts`.

### 5. Debounce `onToolUpdate` sub-item renders
**File:** `src/renderer/src/components/ChatPane.tsx` (bridge listener)

`bridge.onToolUpdate` can fire very rapidly when a subagent is running many
small tool calls.  Each event calls `store.getState().updateToolSubItems()`
which causes a re-render of the tool call row.  A 50–100 ms debounce on the
listener (grouped by `toolCallId`) would batch these updates.

### 6. Memoize `handleOpenFileReference` across renders
**File:** `src/renderer/src/components/ChatPane.tsx`

`handleOpenFileReference` is declared with `useCallback([onFocus, onOpenFile,
paneId])`.  Because `onOpenFile` is re-created on every `App` render, the
callback is new on every render too, which invalidates the `HistoricalMessages`
memo.  Stabilise `onOpenFile` in `App.tsx` with `useCallback` so its identity
is truly stable.
