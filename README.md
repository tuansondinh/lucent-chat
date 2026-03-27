# Lucent Chat

Lucent Chat is a desktop chat app for coding workflows with built-in voice input and speech output.

## Development

Run the Electron app:

```bash
npm run dev -w @lc/studio
```

Build the app:

```bash
npm run build -w @lc/studio
```

## Testing

Run the test suite:

```bash
# Run all tests
npm run test:all -w @lc/studio

# Run main process tests only
npm run test:main -w @lc/studio

# Run renderer tests only
npm run test:renderer -w @lc/studio

# Run tests with coverage
npm run test:coverage -w @lc/studio

# Run smoke tests (fast verification)
npm run test:smoke -w @lc/studio
```

### Coverage Requirements

- Main services: 80% branch coverage
- Renderer components: 70% branch coverage
- IPC contracts: 100% coverage required
- Orchestrator states: 100% tested
- All critical race conditions covered

### CI

Tests are automatically run on push/PR to main/master via GitHub Actions. The CI pipeline includes:
- Full test suite with coverage
- Smoke tests for fast verification
- Build validation

### Electron Mock Boundary

For CI testing, Electron APIs are mocked using `electron-mock` boundary in `vitest.setup.ts`. This allows tests to run without requiring the actual Electron runtime.

### Manual E2E Verification

These scenarios require manual verification in the actual Electron app:
- [Launch → Chat → Response] - Full voice interaction flow
- [Multi-pane create/close] - Pane lifecycle management
- [Session switch during generation] - State handling
- [App relaunch → restored state] - Persistence

## Notes

- Voice services are prewarmed in the background after app launch.
- Desktop auth data is stored under `~/.lucent/agent/`.
