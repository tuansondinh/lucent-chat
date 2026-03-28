/**
 * Shared Tailwind class constants — single source of truth for recurring
 * UI patterns. Import and compose with cn() to add sizing/layout overrides.
 *
 * Usage:
 *   import { btn } from '../lib/theme'
 *   <button className={cn(btn.icon, 'w-7 h-7')}>
 */

/** Icon-only square button (no border). */
const icon =
  'flex items-center justify-center rounded-lg text-text-tertiary ' +
  'hover:text-accent hover:bg-accent/10 active:bg-accent/20 transition-colors'

/** Ghost text button — starts at secondary, goes orange on hover. */
const ghost =
  'text-text-secondary hover:text-accent hover:bg-accent/10 active:bg-accent/20 transition-colors'

/** Outlined cancel / neutral button. */
const outline =
  'rounded-lg border border-border text-text-secondary ' +
  'hover:text-accent hover:border-accent/50 active:bg-accent/10 transition-colors'

/** Primary action button (orange fill). */
const primary =
  'rounded-lg bg-accent/30 border border-accent/70 text-accent ' +
  'hover:bg-accent/45 active:bg-accent/60 transition-colors'

/** Destructive / danger button (red). */
const danger =
  'rounded-lg bg-red-600/20 border border-red-600/40 text-red-400 ' +
  'hover:bg-red-600/30 active:bg-red-600/40 transition-colors'

export const btn = { icon, ghost, outline, primary, danger }

/**
 * Chrome — shared styles for all structural bars (topbar, sidebar, bottom bars).
 * Change values here to retheme all chrome surfaces at once.
 */
export const chrome = {
  bar: 'bg-bg-primary',
  text: 'text-[11px] font-sans text-text-secondary tracking-wide',
}
