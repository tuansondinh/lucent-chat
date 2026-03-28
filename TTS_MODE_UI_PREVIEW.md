# Text-to-Speech Mode - UI Preview

## Settings Dialog - General Tab (Voice Section)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Settings                                          ✕        │
├─────────────┬───────────────────────────────────────────────────────────┤
│ General     │                                                   │
│ API Keys    │  Voice                                             │
│ Models      │                                                   │
│ Auto Mode   │  Voice service                                   │
│ Skills      │  Turns the background Python voice sidecar on or off.│
│ Shortcuts   │  When off, voice input and spoken replies are    │
│ Remote      │  unavailable.                                      │
│ Access      │                                                   │
│             │  [ On  │ Off ]                                    │
│             │                                                   │
│             │  Speech audio                                    │
│             │  Turns assistant voice playback on or off. Voice     │
│             │  input still works when speech audio is off.        │
│             │                                                   │
│             │  [ On  │ Off ]                                    │
│             │                                                   │
│             │  Read all text  ← NEW!                            │
│             │  When enabled, all assistant text responses are       │
│             │  spoken aloud. No microphone is used—this is       │
│             │  text-to-speech only.                              │
│             │                                                   │
│             │  [ On  │ Off ]                                    │
│             │                                                   │
└─────────────┴───────────────────────────────────────────────────────────┘
```

## State Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ User Flow                                                  │
└─────────────────────────────────────────────────────────────────┘
                                                             │
                                                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. Open Settings (⌘+,)                                  │
└─────────────────────────────────────────────────────────────────┘
                                                             │
                                                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Navigate to General → Voice section                      │
└─────────────────────────────────────────────────────────────────┘
                                                             │
                                                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Toggle "Read all text" to "On"                        │
└─────────────────────────────────────────────────────────────────┘
                                                             │
                    ┌──────────────────────────────────┐
                    │                                  │
                    ▼                                  ▼
┌─────────────────────────┐              ┌─────────────────────────┐
│ Voice service         │              │ TTS audio playback     │
│ starts automatically │              │ (no mic)             │
│ - Python sidecar     │◄────────────►│ - Text → TTS          │
│ - WebSocket connect   │              │ - Spoken aloud        │
└─────────────────────────┘              └─────────────────────────┘
                                                             │
                                                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Assistant responses are spoken aloud                      │
│    - No microphone needed                                   │
│    - Works with keyboard input                               │
│    - Can be toggled off anytime                             │
└─────────────────────────────────────────────────────────────────┘
```

## Settings Comparison

| Setting | Description | Default | Mic Required |
|----------|-------------|----------|---------------|
| **Voice service** | Controls the Python voice sidecar (STT + TTS) | On | Yes (for STT) |
| **Speech audio** | TTS on/off during voice input | On | No (audio output only) |
| **Read all text** (NEW) | TTS all responses without microphone input | Off | No (TTS-only mode) |

## Use Cases

### Regular Voice Mode (existing behavior)
```
User speaks → Mic captures → STT → Text generation → TTS → Audio output
     │                                              │
     └───── Uses microphone for both input and output ─────┘
```

### TTS-Only Mode (new feature)
```
User types → Text generation → TTS → Audio output
                                              │
                                              └───── No microphone used ────┘
```

### Combined Mode
```
User can toggle between:
- Voice input + TTS output (regular mode)
- Text input + TTS output (TTS-only mode)
- Text input only (both disabled)
```
