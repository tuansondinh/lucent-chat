/**
 * tokens — read CSS custom properties at runtime.
 * Single source of truth lives in styles/index.css @theme.
 * Use this when you need a raw hex value in JS (canvas, charts, SVGs).
 *
 * Usage:
 *   import { token } from '../lib/theme/tokens'
 *   const accent = token('--color-accent') // '#f06020'
 */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
