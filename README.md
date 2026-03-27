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

## Notes

- Voice services are prewarmed in the background after app launch.
- Desktop auth data is stored under `~/.lucent/agent/`.
