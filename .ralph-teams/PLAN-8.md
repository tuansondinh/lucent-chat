# Plan #8: FileViewer IDE — Editable Code Editor

Plan ID: #8
Generated: 2026-03-28
Platform: web (Electron-only for v1 — IPC file writes require Node; PWA/web editing deferred)
Status: draft

## Summary

Transform the read-only FileViewer into an editable IDE panel by integrating CodeMirror 6. This adds write capability, save persistence via IPC, dirty-state tracking, and essential IDE UX features (search & replace, go-to-line, bracket matching, keybindings).

### Why CodeMirror 6 over Monaco?
- **Bundle size**: ~200KB (modular) vs ~5MB (Monaco) — critical for Electron app startup
- **Incremental integration**: Can coexist with existing Shiki read-only view; editor activates on toggle
- **Modularity**: Import only what's needed (language packs, extensions)
- **Electron-friendly**: No web worker requirements, works natively in renderer process

## Phases

1. [ ] Phase 1: CodeMirror Foundation + Edit Mode Toggle — complexity: standard
   - Install CodeMirror 6 packages: `codemirror`, `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/search`, `@codemirror/autocomplete`, `@codemirror/lint`, and language packs (`@codemirror/lang-javascript`, `@codemirror/lang-python`, `@codemirror/lang-json`, `@codemirror/lang-html`, `@codemirror/lang-css`, `@codemirror/lang-markdown`, `@codemirror/lang-rust`, `@codemirror/lang-cpp`, `@codemirror/lang-java`, `@codemirror/lang-sql`), plus `@codemirror/theme-one-dark`
   - Create `CodeEditor.tsx` component wrapping CodeMirror 6 EditorView with: dark theme matching app aesthetics, line numbers, active line highlight, bracket matching, auto-close brackets, indent guides
   - Build a `languageMap` utility that maps file extensions → CodeMirror language support — MUST reuse the existing extension detection from FileViewer/Shiki to prevent drift
   - Add edit/view mode toggle button (pencil icon) in `FileViewerHeader` — default is read-only (existing Shiki view), clicking toggles to CodeMirror editor
   - Update `pane-store.ts` tab model: add `baselineContent` (last saved/loaded content) and `draftContent` (current editor state, null when clean) per `OpenFile` entry. Derive `isDirty` as `draftContent !== null`. This avoids state divergence from a separate Map.
   - Wire CodeEditor's `onUpdate` to push content changes into `draftContent`; clear `draftContent` on save
   - Disable edit mode for: truncated files (>500 lines display cap or >1MB file-service cap), binary files, and diff views. Show tooltip explaining why edit is unavailable.
   - When editor is focused, suppress app-level keyboard shortcuts in `App.tsx` to prevent conflicts (e.g., Cmd+F should go to CM6 search, not app search)
   - Ensure the existing read-only FileViewer remains the default — editor is opt-in per tab

2. [ ] Phase 2: File Write IPC + Save System — complexity: standard
   - Add `file:write` handler in `file-service.ts` (not ad-hoc in `index.ts`) — accepts `{ filePath: string, content: string }`, validates path is within the project directory, writes atomically (write to temp → rename), preserves original line endings (detect CRLF/LF from baseline, maintain on save)
   - Add `file:read-full` handler in `file-service.ts` for loading full file content (bypassing the 1MB/500-line truncation) when entering edit mode — needed so the editor has complete content
   - Register these IPC handlers in `index.ts` and expose via `preload.ts` / contextBridge
   - Implement Cmd+S / Ctrl+S save: calls `file:write` IPC with `draftContent`, on success sets `baselineContent = draftContent` and clears `draftContent` to null
   - Add self-save watcher suppression: tag saves with a nonce/timestamp so the file watcher in `App.tsx` can ignore self-triggered change events (prevents save → watcher reload → overwrite cycle)
   - Suppress file watcher reloads for dirty tabs: if a tab has `draftContent !== null` and an external change is detected, show a "File changed on disk — Reload / Keep mine" dialog instead of silently reloading
   - Add dirty indicator on tabs: show a dot on modified file tabs in TabStrip (alongside close icon)
   - Add navigation guards for all exit paths: tab close, pane close, viewer panel close, window close (`beforeunload`), and branch checkout (if applicable) — prompt "Unsaved changes — Save / Discard / Cancel" for any dirty tabs
   - Handle save errors gracefully (permission denied, disk full, path no longer exists) with toast notifications via `sonner`

3. [ ] Phase 3: Editor UX + IDE Polish — complexity: standard
   - Integrate CodeMirror's built-in search panel (Cmd+F for search, Cmd+H for replace) — replace the current custom search when in edit mode, keep the current search for read-only mode
   - Add go-to-line dialog (Cmd+G) using CodeMirror's `gotoLine` extension
   - Configure VS Code-style keybindings via `@codemirror/commands` (Cmd+D for select next occurrence, Cmd+Shift+K for delete line, Cmd+/ for toggle comment, Alt+Up/Down for move line)
   - Add word wrap toggle button in FileViewerHeader (persisted to localStorage)
   - Add editor font size control (Cmd+= / Cmd+- or settings gear) persisted to localStorage
   - Ensure the editor respects the app's existing theme tokens and color scheme (pull colors from Tailwind CSS variables)
   - Add unit tests for pane-store dirty state lifecycle: set dirty, save clears dirty, external reload on clean tab, external reload blocked on dirty tab, close confirmation flow

## Acceptance Criteria
- Clicking the edit toggle on any open file switches from Shiki read-only view to a fully functional CodeMirror editor
- Edit toggle is disabled (with tooltip) for truncated files, binary files, and diffs
- Typing in the editor marks the tab as dirty (visual dot indicator visible)
- Cmd+S saves the file to disk and clears the dirty state
- Closing a dirty tab (or pane, or window) prompts for confirmation
- External file changes on a dirty tab show "Reload / Keep mine" dialog instead of silently overwriting
- Self-saves do not trigger watcher reload cycles
- Syntax highlighting works for at least: JS/TS, Python, JSON, HTML, CSS, Markdown, Rust, C/C++, Java, SQL
- Search & replace works in edit mode (Cmd+F / Cmd+H)
- Go-to-line works (Cmd+G)
- VS Code keybindings work (Cmd+D, Cmd+/, Alt+Up/Down, Cmd+Shift+K)
- Files over 2000 lines are editable without performance degradation (full content loaded bypassing truncation)
- Editor theme matches the existing dark UI aesthetic
- Line endings (CRLF/LF) are preserved on save
- No regressions in read-only FileViewer mode
- Unit tests pass for dirty state lifecycle in pane-store

## Verification
Tool: Playwright
Scenarios:
- Scenario 1: Edit mode toggle — Open a file in FileViewer → click edit toggle → verify CodeMirror editor mounts with correct content → type text → verify dirty indicator appears on tab
- Scenario 2: Edit disabled for truncated — Open a large file (>500 lines shown truncated) → verify edit toggle is disabled with tooltip
- Scenario 3: Save file — Edit a file → press Cmd+S → verify dirty indicator clears → reload file from disk → verify content matches
- Scenario 4: Dirty tab close — Edit a file without saving → close the tab → verify confirmation dialog appears → click "Discard" → verify tab closes
- Scenario 5: External change on dirty tab — Edit a file → externally modify the same file on disk → verify "Reload / Keep mine" dialog appears
- Scenario 6: Search & replace — In edit mode, press Cmd+F → type search term → verify matches highlighted → press Cmd+H → type replacement → replace all → verify content updated
- Scenario 7: Large file performance — Open a 3000+ line file → toggle edit mode → verify editor loads without freezing → scroll through file → verify smooth performance
- Scenario 8: Syntax highlighting — Open .ts, .py, .json files → toggle edit mode → verify language-appropriate syntax highlighting in each

## Review Notes
Reviewed by: Codex (gpt-5.4) on 2026-03-28
Key findings incorporated:
- Fixed store model: baseline + draft per tab instead of separate dirty Map (prevents state divergence)
- Added truncated/binary file edit guard (partial buffer editing is unsafe)
- Added file watcher conflict handling (suppress self-reloads, dirty tab protection dialog)
- Moved write logic to file-service.ts (consistency with existing read logic)
- Added navigation guards for all exit paths (not just tab close)
- Added line ending preservation (CRLF/LF detection)
- Added keybinding conflict suppression (editor focus blocks app-level shortcuts)
- Cut minimap (CM6 has no built-in minimap; would require major custom work)
- Scoped to Electron-only for v1 (PWA/web editing deferred)
- Added unit tests for store dirty lifecycle
