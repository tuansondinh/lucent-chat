# Text-to-Speech Mode - Quick Reference

## 🎯 Feature

A new "Read all text" setting that enables text-to-speech (TTS) for all assistant responses **without requiring microphone input**.

## 📍 Location

**Settings → General → Voice section**

Toggle: **"Read all text"** (On/Off)

## ⚙️ How It Works

1. Enable the setting in Settings
2. Voice service starts automatically
3. Assistant text responses are spoken aloud
4. No microphone is ever used

## 🔧 Technical Details

### Settings Schema
```json
{
  "textToSpeechMode": true  // Boolean, default: false
}
```

### Key Files
- `src/main/settings-service.ts` - Setting storage
- `src/main/settings-contract.ts` - Validation
- `src/renderer/src/components/Settings.tsx` - UI control
- `src/renderer/src/lib/useVoice.ts` - TTS-only logic

### Mode Comparison

| Mode | Mic Input | TTS Output | Use Case |
|-------|-----------|-------------|-----------|
| Voice | ✅ | ✅ | Speak to assistant |
| TTS-Only (NEW) | ❌ | ✅ | Read assistant responses |
| Both Off | ❌ | ❌ | Text-only chat |

## 🚀 Usage

### Enable
1. Press `⌘+,` (Command+,)
2. Click "General" tab
3. Find "Voice" section
4. Toggle "Read all text" to **On**
5. Close Settings

### Disable
1. Press `⌘+,` (Command+,)
2. Click "General" tab
3. Find "Voice" section
4. Toggle "Read all text" to **Off**
5. Close Settings

## ✅ Benefits

- **Accessibility**: Users with visual impairments can hear all responses
- **Multitasking**: Listen to responses while doing other work
- **Privacy**: No microphone permission needed
- **Flexibility**: Works independently of voice input mode
- **Natural Speech**: Sentence-based TTS for natural pauses

## 🔐 Security

- No microphone access requested
- Settings stored securely (0o600 permissions)
- Boolean validation prevents invalid values
- No additional data exposure

## 📊 Performance

- **Memory**: ~1MB for audio queue
- **CPU**: TTS processing only when generating responses
- **Network**: WebSocket only when TTS active
- **Battery**: Minimal impact (no continuous mic)

## 🐛 Troubleshooting

### TTS not working
1. Check "Read all text" is enabled in Settings
2. Verify voice service is running (no error in voice status)
3. Ensure system audio is not muted
4. Check browser allows audio autoplay

### Can't toggle setting
1. Close and reopen Settings
2. Try again - setting should persist
3. If still stuck, restart app

### Want regular voice input
1. Disable "Read all text"
2. Use push-to-talk (Space by default)
3. Both modes are independent

## 📝 Development

### Build
```bash
cd apps/studio
npm run build
```

### Type Check
```bash
cd apps/studio
npx tsc --noEmit
```

### Test
```bash
cd apps/studio
node --test test/settings-contract.test.ts
```

## 🎉 Status

✅ **Complete** - Feature is fully implemented and ready for use

---

**For detailed implementation notes**, see:
- `TTS_MODE_COMPLETE.md` - Full implementation guide
- `TEXT_TO_SPEECH_MODE_IMPLEMENTATION.md` - Technical details
- `TTS_MODE_UI_PREVIEW.md` - UI mockups
