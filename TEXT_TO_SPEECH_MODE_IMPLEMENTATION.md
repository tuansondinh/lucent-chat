# Text-to-Speech Mode Implementation

## Overview

Added a new "Read all text" mode in the Settings that enables text-to-speech (TTS) for all assistant responses without requiring microphone input. This feature allows users to have all assistant responses spoken aloud while keeping the microphone disabled.

## Changes Made

### 1. Settings Service (`apps/studio/src/main/settings-service.ts`)

- Added `textToSpeechMode?: boolean` to the `AppSettings` interface
- Set default value to `false`

```typescript
export interface AppSettings {
  // ... existing settings
  voiceOptIn?: boolean
  /** When true, all text responses are spoken aloud (TTS-only mode, no mic). */
  textToSpeechMode?: boolean
  // ... rest of settings
}
```

### 2. Settings Contract (`apps/studio/src/main/settings-contract.ts`)

- Added validation for the `textToSpeechMode` setting
- Ensures the value is a boolean

```typescript
if ('textToSpeechMode' in partial) {
  if (typeof partial.textToSpeechMode !== 'boolean') {
    throw new Error('Invalid textToSpeechMode setting')
  }
  validated.textToSpeechMode = partial.textToSpeechMode
}
```

### 3. Settings UI (`apps/studio/src/renderer/src/components/Settings.tsx`)

- Added state variable `localTextToSpeechMode`
- Added handler `handleTextToSpeechModeChange`
- Added UI toggle "Read all text" in the General tab's Voice section
- Updated `GeneralTab` component to accept and handle the new setting

```typescript
<Field
  label="Read all text"
  hint="When enabled, all assistant text responses are spoken aloud. No microphone is used—this is text-to-speech only."
>
  <div className="inline-flex rounded-lg border border-border bg-bg-tertiary p-1">
    <button onClick={() => onTextToSpeechModeChange(true)} ...>
      On
    </button>
    <button onClick={() => onTextToSpeechModeChange(false)} ...>
      Off
    </button>
  </div>
</Field>
```

### 4. App Component (`apps/studio/src/renderer/src/App.tsx`)

- Added `textToSpeechMode` state variable
- Load the setting from persisted settings on mount
- Pass `textToSpeechMode` to all ChatPane instances via `renderLayoutNode`

### 5. ChatPane Component (`apps/studio/src/renderer/src/components/ChatPane.tsx`)

- Added `textToSpeechMode: boolean` prop to the interface
- Pass the combined TTS enabled state (`voiceAudioEnabled || textToSpeechMode`) to `useVoice`

```typescript
const { toggleVoice, beginVoiceCapture, finishVoiceCapture, stopTts, feedAgentChunk, flushTts } = useVoice({
  onTranscript: (text) => void handleSubmit(text),
  activePaneId: paneId,
  ttsEnabled: voiceAudioEnabled || textToSpeechMode,
})
```

### 6. useVoice Hook (`apps/studio/src/renderer/src/lib/useVoice.ts`)

- Added `textOnlyModeRef` to track TTS-only mode state
- Added initialization effect that starts the voice service when TTS is enabled
- Modified `feedAgentChunk` to work in TTS-only mode:
  - Processes text even when voice is not marked as "active"
  - Skips pane ownership check in TTS-only mode
  - Automatically connects WebSocket when needed
- Modified `flushTts` to work in TTS-only mode
- Added cleanup logic for TTS-only mode resources

```typescript
// TTS-only mode initialization
useEffect(() => {
  let cancelled = false

  const initTtsOnlyMode = async () => {
    if (cancelled) return
    
    const state = voiceStore.getState()
    
    // Only initialize if TTS is enabled but voice is not active
    if (!ttsEnabled || state.active || state.sidecarState === 'ready' || state.sidecarState === 'starting') {
      return
    }

    try {
      state.setSidecarState('starting')
      const started = await bridge.voiceStart()
      if (cancelled) return
      
      sidecarTokenRef.current = started.token
      state.setPort(started.port)
      state.setAvailable(true, null)
      state.setSidecarState('ready')
      
      // Mark as text-only mode (no mic)
      textOnlyModeRef.current = true
    } catch (err) {
      if (cancelled) return
      const msg = err instanceof Error ? err.message : 'Voice service failed to start'
      state.setError(msg)
      state.setSidecarState('error')
    }
  }

  void initTtsOnlyMode()

  // Cleanup on unmount or when TTS is disabled
  return () => {
    cancelled = true
    if (textOnlyModeRef.current && !ttsEnabled) {
      // Clean up TTS-only mode resources
      playbackQueueRef.current?.destroy()
      playbackQueueRef.current = null
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      textOnlyModeRef.current = false
    }
  }
}, [ttsEnabled, bridge, voiceStore])
```

### 7. Tests (`apps/studio/test/settings-contract.test.ts`)

- Added test for valid `textToSpeechMode` setting
- Added test for invalid `textToSpeechMode` value

```typescript
test('settings contract: validates textToSpeechMode', () => {
  const result = validateSettingsPatch({ textToSpeechMode: true })
  assert.deepEqual(result, { textToSpeechMode: true })
})

test('settings contract: rejects invalid textToSpeechMode', () => {
  assert.throws(
    () => validateSettingsPatch({ textToSpeechMode: 'yes' }),
    /Invalid textToSpeechMode setting/,
  )
})
```

## How It Works

### User Flow

1. User opens Settings (⌘+,)
2. Navigates to the "General" tab
3. Finds the "Voice" section
4. Toggles "Read all text" to "On"
5. Setting is persisted to disk

### Technical Flow

1. **Initialization**: When the setting is enabled, the voice sidecar service starts automatically
   - No microphone access is requested
   - Only TTS capabilities are initialized
   - WebSocket connection is established for TTS communication

2. **Text Processing**: When the assistant generates text responses:
   - Text chunks are passed to `feedAgentChunk`
   - In TTS-only mode, the `state.active` check is bypassed
   - Text is accumulated and sent to the TTS service via WebSocket
   - Sentence boundaries are detected for natural pauses

3. **Audio Playback**: TTS audio is received and played:
   - Audio frames are enqueued in the `AudioPlaybackQueue`
   - Audio is played gaplessly using Web Audio API
   - No microphone interference occurs

4. **Cleanup**: When the setting is disabled or the app closes:
   - TTS resources are cleaned up
   - WebSocket connection is closed
   - Playback queue is destroyed

### Key Design Decisions

1. **Separate from Voice Input**: The mode is completely independent of microphone-based voice input
   - Can be enabled/disabled independently
   - Works alongside regular voice mode
   - No microphone permission required

2. **Lazy WebSocket Connection**: The WebSocket connects only when needed
   - Connects on first text chunk in TTS-only mode
   - Avoids unnecessary connections when not actively receiving text

3. **Reuses Existing Infrastructure**: 
   - Uses the same TTS pipeline as regular voice mode
   - Same voice models and speech synthesis
   - Consistent audio quality across all TTS features

4. **Pane-Aware**: The implementation respects multi-pane layouts
   - In regular voice mode, TTS follows the active pane
   - In TTS-only mode, TTS works regardless of active pane state

## Settings Persistence

The `textToSpeechMode` setting is persisted in:
- **Location**: `~/.lucent-code/settings.json`
- **Format**: JSON with boolean value
- **Default**: `false`
- **File Permissions**: `0o600` (contains sensitive data like API keys)

## Testing

All changes pass TypeScript compilation with no errors:
```bash
npx tsc --noEmit
```

Unit tests added for:
- Valid `textToSpeechMode` setting validation
- Invalid `textToSpeechMode` value rejection

## Future Enhancements

Possible improvements for future iterations:

1. **Voice Selection**: Allow users to choose different voices for TTS-only mode
2. **Speed Control**: Adjustable speech rate independent of regular voice mode
3. **Per-Pane Settings**: Different TTS settings for different panes
4. **Visual Indicators**: Show when TTS is active in TTS-only mode
5. **Keyboard Shortcut**: Quick toggle for TTS-only mode without opening Settings

## Files Modified

1. `apps/studio/src/main/settings-service.ts`
2. `apps/studio/src/main/settings-contract.ts`
3. `apps/studio/src/renderer/src/components/Settings.tsx`
4. `apps/studio/src/renderer/src/App.tsx`
5. `apps/studio/src/renderer/src/components/ChatPane.tsx`
6. `apps/studio/src/renderer/src/lib/useVoice.ts`
7. `apps/studio/test/settings-contract.test.ts`

## Total Lines Changed

- **Added**: ~150 lines
- **Modified**: ~30 lines
- **Test Coverage**: 2 new tests

## Backward Compatibility

The implementation is fully backward compatible:
- Existing settings continue to work unchanged
- Default value is `false`, so behavior is unchanged for existing users
- No breaking changes to existing APIs or components
