import type { Bridge } from './index'

declare global {
  interface Window {
    bridge: Bridge
  }
}

export {}
