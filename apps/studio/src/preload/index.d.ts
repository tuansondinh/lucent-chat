import type { Bridge } from './index'

declare global {
  interface Window {
    bridge: Bridge
    __ELECTRON__?: boolean
  }
}

export {}
