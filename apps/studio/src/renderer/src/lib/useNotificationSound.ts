/**
 * useNotificationSound — plays a subtle chime when the agent finishes responding.
 *
 * Synthesises the sound entirely via the Web Audio API (no external files).
 * The chime is a soft two-tone "done" sound: a quick high note followed by a
 * slightly lower one, with a gentle attack and exponential decay.
 */

import { useCallback, useEffect, useRef } from 'react'

export function useNotificationSound(enabled: boolean) {
  const audioCtxRef = useRef<AudioContext | null>(null)

  const getCtx = useCallback((): AudioContext => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext()
    }
    return audioCtxRef.current
  }, [])

  useEffect(() => {
    if (!enabled) return

    const resumeAudio = () => {
      const ctx = getCtx()
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {})
      }
    }

    const options: AddEventListenerOptions = { passive: true }
    window.addEventListener('pointerdown', resumeAudio, options)
    window.addEventListener('keydown', resumeAudio, options)

    return () => {
      window.removeEventListener('pointerdown', resumeAudio)
      window.removeEventListener('keydown', resumeAudio)
    }
  }, [enabled, getCtx])

  const playNote = useCallback(
    (ctx: AudioContext, frequency: number, startTime: number, duration: number, gain: number) => {
      const osc = ctx.createOscillator()
      const gainNode = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(frequency, startTime)

      // Soft attack + exponential decay
      gainNode.gain.setValueAtTime(0, startTime)
      gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.015)
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)

      osc.connect(gainNode)
      gainNode.connect(ctx.destination)

      osc.start(startTime)
      osc.stop(startTime + duration)
    },
    [],
  )

  const play = useCallback(async () => {
    if (!enabled) return
    try {
      const ctx = getCtx()
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }
      if (ctx.state !== 'running') return
      const now = ctx.currentTime

      // Two-tone chime: C6 -> A5 (subtle, pleasant "done" sound)
      playNote(ctx, 1046.5, now, 0.55, 0.18)        // C6
      playNote(ctx, 880.0, now + 0.12, 0.55, 0.14)  // A5
    } catch {
      // Silently fail — audio is non-critical
    }
  }, [enabled, getCtx, playNote])

  return { play }
}
