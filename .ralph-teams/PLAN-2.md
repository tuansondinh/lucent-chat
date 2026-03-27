# Plan #2: Restructure Studio Around @lc/runtime

Plan ID: #2
Generated: 2026-03-27
Platform: web
Status: approved

## Context

Restructure the monorepo so Studio consumes a single `@lc/runtime` package instead of reaching into repo-root build output and workspace internals. Rename internal scope from `@gsd/*` to `@lc/*`, rename package directories, move `studio/` to `apps/studio/`, and replace the `ELECTRON_RUN_AS_NODE` packaged-app workaround with a bundled background Node binary.

### Current state
- 5 workspace packages under `packages/` with `@gsd/*` scope
- 349 `@gsd/` import references across ~100+ source files
- `studio/` at repo root, `extraResources` copies `../dist`, `../packages`, `../pkg`, `../node_modules`
- `process-manager.ts` uses `ELECTRON_RUN_AS_NODE` + repo-relative paths for packaged runtime
- `loader.ts` has inline symlink repair duplicating `link-workspace-packages.cjs`
- Build chain: native → pi-tui → pi-ai → pi-agent-core → pi-coding-agent → root tsc

### Target state
- `apps/studio` depends on `@lc/runtime` (single bundle artifact)
- `packages/runtime` is self-contained — entrypoint, resources, production deps
- Root package is thin workspace/release wrapper
- Packaged Studio launches bundled Node binary + runtime entrypoint (no second Dock icon)

## Phases

### Phase 1: Rename all packages, scopes, imports + move studio → apps/studio — complexity: standard
1. Rename package directories: `pi-agent-core` → `agent-core`, `pi-ai` → `ai`, `pi-coding-agent` → `runtime`, `pi-tui` → `tui` (use `git mv`)
2. Update all 6 `package.json` name fields from `@gsd/*` to `@lc/*` (`@gsd/pi-agent-core` → `@lc/agent-core`, `@gsd/pi-ai` → `@lc/ai`, `@gsd/pi-coding-agent` → `@lc/runtime`, `@gsd/pi-tui` → `@lc/tui`, `@gsd/native` → `@lc/native`)
3. Bulk find-and-replace all `@gsd/` imports → `@lc/` across every `.ts`, `.js`, `.cjs`, `.mjs` file in `packages/`, `src/`, `studio/`, `scripts/`, `tests/` (include subpath exports like `@gsd/native/grep` → `@lc/native/grep`, `@gsd/pi-ai/oauth` → `@lc/ai/oauth`)
4. Update root `package.json`: `workspaces` (add `apps/studio`), `scripts` (`build:pi-tui` → `build:tui`, etc.), `files` array, `bin` references
5. Update `scripts/link-workspace-packages.cjs` — new dir names, `@lc` scope dir instead of `@gsd`
6. Update `scripts/ensure-workspace-builds.cjs` — new package dir names
7. Update `loader.ts` inline references: `@gsd` scope dir → `@lc`, symlink array package names (`pi-coding-agent` → `runtime`, etc.)
8. Move `studio/` → `apps/studio/` (`git mv`), fix relative paths in `apps/studio/package.json` extraResources (`../` → `../../`), fix electron-vite config parent paths
9. Verify: `npm install` succeeds, `npm run build` passes, no `@gsd` references remain in source

### Phase 2: Build @lc/runtime self-contained bundle + rewire Studio packaging — complexity: standard
1. Define bundle output directory `packages/runtime/bundle/` and create `packages/runtime/scripts/bundle.cjs` — copies compiled JS, resources, extensions, `pkg/` config shim, and production dependencies into bundle dir
2. Add download/copy step for standalone Node binary into `packages/runtime/bundle/node` (arm64 macOS)
3. Add `bundle` and `validate-bundle` scripts to `packages/runtime/package.json`; validate checks entrypoint, resources, node binary, required deps all present
4. Replace `extraResources` in `apps/studio/package.json` with single entry: `{ "from": "../../packages/runtime/bundle", "to": "runtime" }`
5. Rewrite `resolveAgentPath()` and `resolveAgentCommand()` in `process-manager.ts`: packaged mode uses `<resources>/runtime/node` binary + `<resources>/runtime/entrypoint.js`; dev mode uses local `node` + workspace build output; remove `ELECTRON_RUN_AS_NODE` from packaged path entirely
6. Add pre-pack hook to Studio that runs `npm run bundle -w @lc/runtime` before electron-builder
7. Update root CLI wrapper: `dist/loader.js` delegates to `@lc/runtime` entrypoint instead of importing `./cli.js` directly
8. Verify: bundle launches standalone (`bundle/node bundle/entrypoint.js --version`), `npm run dist:mac:arm64 -w @lc/studio` produces working app with no second Dock icon

### Phase 3: Remove obsolete packaging hacks and end-to-end verification — complexity: simple
1. Remove `scripts/link-workspace-packages.cjs` (or reduce to dev-only convenience if still needed for CLI installs)
2. Remove inline symlink repair block from `src/loader.ts` (lines ~129-166) and the critical-package validation below it
3. Simplify root `postinstall` — remove workspace-link step
4. Update `scripts/validate-pack.js` to validate runtime bundle artifact instead of repo-root assembly
5. Verify end-to-end: fresh clone → `npm install` → `npm run build` → `npm run dist:mac:arm64 -w @lc/studio` → packaged app launches, agent connects, no crashes

## Acceptance Criteria
- [ ] No `@gsd/` references remain in source files (excluding LICENSE/git history)
- [ ] All packages use `@lc/*` scope with new directory names
- [ ] `studio/` lives at `apps/studio/`
- [ ] `npm install && npm run build` succeeds from fresh clone
- [ ] Root CLI (`node dist/loader.js`) launches successfully through @lc/runtime
- [ ] `@lc/runtime` bundle is self-contained: entrypoint + resources + deps + node binary
- [ ] Packaged Studio (arm64) launches, agent stays up, no second Dock icon
- [ ] Release artifact size drops vs current broad-copy approach
- [ ] Dev mode still works: `npm run dev -w @lc/studio` starts runtime locally
- [ ] Onboarding, settings, session, voice/TTS flows work after restructure

## Verification
Tool: Playwright
Scenarios:
- Fresh build: `npm install && npm run build` completes without errors — no @gsd references in output
- CLI launch: `node dist/loader.js --version` prints version
- Runtime bundle: `packages/runtime/bundle/node packages/runtime/bundle/entrypoint.js --version` works standalone
- Studio dev: `npm run dev -w @lc/studio` launches app, agent connects, send message and get response
- Studio packaged: `npm run dist:mac:arm64 -w @lc/studio` builds, open .app, single Dock icon, agent stays up
- Regression: onboarding flow, settings save, session switch, voice toggle all work
