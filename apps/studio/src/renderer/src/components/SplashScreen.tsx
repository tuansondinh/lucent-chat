/**
 * SplashScreen — full-screen branded intro shown for ~1 second on launch.
 *
 * Timeline:
 *   0ms       fade-in starts  (200ms)
 *   200ms     fully visible   (hold for 600ms)
 *   800ms     fade-out starts (200ms)
 *   1000ms    unmounted
 */

import { useEffect, useState } from 'react'

type Phase = 'in' | 'hold' | 'out' | 'done'

export function SplashScreen() {
  const [phase, setPhase] = useState<Phase>('in')

  useEffect(() => {
    // fade in → hold → fade out
    const t1 = setTimeout(() => setPhase('hold'), 200)
    const t2 = setTimeout(() => setPhase('out'),  800)
    const t3 = setTimeout(() => setPhase('done'), 1000)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [])

  if (phase === 'done') return null

  const opacity =
    phase === 'in'   ? 'opacity-0'
    : phase === 'hold' ? 'opacity-100'
    : 'opacity-0'

  return (
    <div
      className={`
        fixed inset-0 z-[99999] flex flex-col items-center justify-center
        bg-[#1a1d24] transition-opacity duration-200 ease-in-out
        ${opacity}
      `}
      aria-hidden="true"
    >
      {/* Glow ring */}
      <div className="relative flex items-center justify-center mb-7">
        <div className="absolute size-28 rounded-full bg-accent/10 blur-2xl" />
        <div className="absolute size-20 rounded-full bg-accent/15 blur-xl" />

        {/* Logo — geometric "LC" monogram */}
        <svg
          viewBox="0 0 72 72"
          className="relative size-[72px] drop-shadow-[0_0_18px_rgba(240,96,32,0.5)]"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Background square */}
          <rect width="72" height="72" rx="14" fill="#1e2330" />

          {/* "L" — vertical stroke + horizontal foot */}
          <rect x="16" y="16" width="6" height="34" rx="2" fill="#f06020" />
          <rect x="16" y="44" width="18" height="6" rx="2" fill="#f06020" />

          {/* "C" — open arc built from two rects + rounded cap trick */}
          <path
            d="M44 18 A18 18 0 0 0 44 54"
            stroke="#f06020"
            strokeWidth="6"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* App name */}
      <p className="text-[15px] font-semibold tracking-[0.18em] text-text-primary uppercase select-none">
        Lucent Code
      </p>

      {/* Subtle tagline */}
      <p className="mt-1.5 text-[11px] tracking-widest text-text-tertiary uppercase select-none">
        AI Coding Studio
      </p>

      {/* Loading dots */}
      <div className="mt-8 flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1 rounded-full bg-accent/60 animate-bounce"
            style={{ animationDelay: `${i * 120}ms`, animationDuration: '900ms' }}
          />
        ))}
      </div>
    </div>
  )
}
