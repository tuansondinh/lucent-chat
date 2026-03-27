/**
 * voice-store — global zustand store for voice/audio state.
 *
 * Voice is app-global (not per-pane). The active pane receives voice input
 * and its responses are forwarded to TTS.
 */

import { create } from 'zustand'

interface VoiceState {
  // Sidecar availability
  available: boolean
  unavailableReason: string | null
  sidecarState: 'unavailable' | 'stopped' | 'starting' | 'ready' | 'error'
  port: number | null

  // Active state
  active: boolean           // voice mode on (mic capturing)
  micPermission: 'unknown' | 'granted' | 'denied'
  speaking: boolean         // VAD detected speech
  partialTranscript: string // preview of current utterance before accumulation
  ttsPlaying: boolean       // TTS audio currently playing
  ttsGen: number            // monotonic generation counter for stale-frame discard
  wsConnected: boolean      // WebSocket to audio service connected

  // Errors
  error: string | null

  // Actions
  setAvailable: (v: boolean, reason?: string | null) => void
  setSidecarState: (s: VoiceState['sidecarState']) => void
  setPort: (p: number | null) => void
  setActive: (v: boolean) => void
  setMicPermission: (p: VoiceState['micPermission']) => void
  setSpeaking: (v: boolean) => void
  setPartialTranscript: (t: string) => void
  setTtsPlaying: (v: boolean) => void
  nextTtsGen: () => number
  setWsConnected: (v: boolean) => void
  setError: (e: string | null) => void
  reset: () => void
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  available: false,
  unavailableReason: null,
  sidecarState: 'stopped',
  port: null,
  active: false,
  micPermission: 'unknown',
  speaking: false,
  partialTranscript: '',
  ttsPlaying: false,
  ttsGen: 0,
  wsConnected: false,
  error: null,

  setAvailable: (v, reason) => set({ available: v, unavailableReason: reason ?? null }),
  setSidecarState: (s) => set({ sidecarState: s }),
  setPort: (p) => set({ port: p }),
  setActive: (v) => set({ active: v, speaking: false, partialTranscript: '', error: null }),
  setMicPermission: (p) => set({ micPermission: p }),
  setSpeaking: (v) => set({ speaking: v }),
  setPartialTranscript: (t) => set({ partialTranscript: t }),
  setTtsPlaying: (v) => set({ ttsPlaying: v }),
  nextTtsGen: () => {
    const g = get().ttsGen + 1
    set({ ttsGen: g })
    return g
  },
  setWsConnected: (v) => set({ wsConnected: v }),
  setError: (e) => set({ error: e }),
  reset: () =>
    set({
      active: false,
      speaking: false,
      partialTranscript: '',
      ttsPlaying: false,
      wsConnected: false,
      error: null,
    }),
}))
