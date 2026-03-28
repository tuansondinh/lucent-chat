# Plan: Tailscale Tunneling for Lucent Code

## Context

The desktop app's `audio_service.py` is a **loopback-only** WebSocket sidecar (`127.0.0.1`) for the Electron app's internal voice processing. It has no phone-accessible web UI.

The `voice-bridge` project (`../voice-bridge`) is a fully-working FastAPI server with a mobile web UI, Tailscale detection, origin allowlist, auth token, and WebSocket phone protocol. It already prints a `Tailscale:` URL on startup.

Goal: expose the `voice-bridge` phone UI through Tailscale HTTPS from within the desktop app, with a Settings panel to control it.

---

## Approach: Run `voice-bridge` as a second sidecar

Reuse the `voice-bridge` server as-is (no changes to that project). The desktop app spawns it on a fixed port, runs `tailscale serve`, and shows the QR code in Settings.

---

## Implementation Steps

### 1. `TailscaleService` — `studio/src/main/tailscale-service.ts`

- Port `_get_tailscale_hostname()` logic from `voice_bridge/server.py` to Node.js
  - Run `tailscale status --json`, parse `Self.DNSName` (strip trailing `.`)
  - Fall back to macOS app binary at `/Applications/Tailscale.app/Contents/MacOS/Tailscale`
- Method `getHostname(): Promise<string | null>`
- Method `enableServe(port: number): Promise<void>`
  - Runs `tailscale serve --bg http://localhost:<port>`
- Method `getServeStatus(): Promise<{ active: boolean; url: string | null }>`

### 2. `PhoneBridgeService` — `studio/src/main/phone-bridge-service.ts`

- Spawns `voice-bridge` server from the `../voice-bridge` directory:
  ```
  uv run voice-bridge --host 0.0.0.0 --port 8787
  ```
  (falls back to `python -m voice_bridge` if `uv` not found)
- Reads stdout for URL lines:
  - `Local:   http://localhost:8787/?token=<tok>`
  - `Tailscale: https://<host>/?token=<tok>`
- Emits `status` events: `{ state, localUrl, tailscaleUrl, token, error }`
- State machine: `stopped | starting | ready | error`
- Auto-restart on unexpected exit (with backoff)
- Passes through `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` from env

### 3. IPC handlers — `studio/src/main/ipc-handlers.ts`

Add handlers:
- `phone-bridge:start` → `phoneBridgeService.start()`
- `phone-bridge:stop` → `phoneBridgeService.stop()`
- `phone-bridge:getStatus` → `phoneBridgeService.getStatus()`
- `phone-bridge:enableTailscaleServe` → `tailscaleService.enableServe(8787)`

Push events to renderer:
- `phoneBridgeService.on('status', ...)` → `pushEvent('phone-bridge:status', status)`

### 4. Settings type — `studio/src/main/settings-service.ts`

Add to `AppSettings`:
```ts
/** Whether the phone bridge (voice-bridge server) should auto-start. */
phoneBridgeAutoStart?: boolean
/** Port for the phone bridge server. */
phoneBridgePort?: number
```

Default: `phoneBridgeAutoStart: false`, `phoneBridgePort: 8787`

### 5. Phone Bridge panel — `studio/src/renderer/src/components/Settings.tsx`

New section "Phone Bridge" below Voice:

```
┌─────────────────────────────────────────────────┐
│  Phone Bridge                                   │
│                                                 │
│  [●] Enable phone bridge   Status: Running      │
│                                                 │
│  Tailscale URL:                                 │
│  https://my-pc.tail1234.ts.net/?token=e085...   │
│  [Copy]  [QR Code ▼]                           │
│                                                 │
│  ┌──────────────────────┐                      │
│  │  (QR code image)     │  ← collapsed by default │
│  └──────────────────────┘                      │
│                                                 │
│  [Enable Tailscale HTTPS Serve]                 │
│  (runs: tailscale serve --bg http://localhost:8787) │
└─────────────────────────────────────────────────┘
```

Dependencies:
- `qrcode` npm package for QR generation (or `qrcode.react` for React component)

Setup instructions (collapsed info block):
1. Install Tailscale: `brew install --cask tailscale`
2. Sign in and connect
3. In Tailscale admin console → DNS → enable HTTPS Certificates
4. Click "Enable Tailscale HTTPS Serve" above

### 6. Auto-start on app launch — `studio/src/main/index.ts`

After settings load, if `phoneBridgeAutoStart === true`, call `phoneBridgeService.start()`.

---

## File Change Summary

| File | Change |
|------|--------|
| `studio/src/main/tailscale-service.ts` | **New** — Tailscale hostname detection + `serve` management |
| `studio/src/main/phone-bridge-service.ts` | **New** — voice-bridge sidecar lifecycle |
| `studio/src/main/ipc-handlers.ts` | Add phone-bridge IPC + event push |
| `studio/src/main/settings-service.ts` | Add `phoneBridgeAutoStart`, `phoneBridgePort` |
| `studio/src/main/index.ts` | Instantiate services, wire auto-start |
| `studio/src/renderer/src/components/Settings.tsx` | Add Phone Bridge section with QR |

No changes to `voice-bridge` or `audio_service.py`.

---

## Port & Origin Notes

- Fixed port: **8787** (matches `voice-bridge` docs and start scripts)
- `tailscale serve --bg http://localhost:8787` maps port 443 → 8787 on the Tailscale HTTPS URL
- `voice-bridge` server.py already adds `*.ts.net` to the WebSocket origin allowlist automatically when `TAILSCALE_HOSTNAME` is detected — no extra env vars needed
- For non-Tailscale LAN access: set `BRIDGE_ALLOWED_ORIGIN=*` (surface as optional toggle in Settings)
