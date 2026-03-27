/**
 * Mock for Electron APIs used in tests.
 * This allows main process code to run without actual Electron runtime.
 */

import { EventEmitter } from 'node:events'

// Mock ipcMain
class IpcMainMock extends EventEmitter {
  channels = new Map<string, Set<(event: any, ...args: any[]) => void>>()

  on(channel: string, listener: (event: any, ...args: any[]) => void): this {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set())
    }
    this.channels.get(channel)!.add(listener)
    return super.on(channel, listener)
  }

  removeHandler(channel: string, listener: (event: any, ...args: any[]) => void): void {
    const listeners = this.channels.get(channel)
    if (listeners) {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.channels.delete(channel)
      }
    }
    this.removeListener(channel, listener)
  }

  // Simulate sending an event from renderer to main
  sendToMain(channel: string, event: any, ...args: any[]): void {
    const listeners = this.channels.get(channel)
    if (listeners) {
      for (const listener of listeners) {
        listener(event, ...args)
      }
    }
  }
}

// Mock WebContents
class WebContentsMock extends EventEmitter {
  send: (channel: string, ...args: any[]) => void = () => {}

  constructor() {
    super()
    this.send = vi.fn((channel: string, ...args: any[]) => {
      // Emit the event for testing
      this.emit('send', channel, ...args)
    })
  }
}

// Mock BrowserWindow
class BrowserWindowMock extends EventEmitter {
  webContents = new WebContentsMock()
  id = Math.floor(Math.random() * 100000)
  isDestroyed = false

  constructor(public options: any = {}) {
    super()
  }

  loadURL(url: string): Promise<void> {
    return Promise.resolve()
  }

  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener)
  }

  once(event: string, listener: (...args: any[]) => void): this {
    return super.once(event, listener)
  }

  removeListener(event: string, listener: (...args: any[]) => void): this {
    return super.removeListener(event, listener)
  }

  destroy(): void {
    this.isDestroyed = true
    this.emit('closed')
  }

  close(): void {
    this.destroy()
  }

  focus(): void {
    // Mock focus
  }

  blur(): void {
    // Mock blur
  }

  isMinimized(): boolean {
    return false
  }

  maximize(): void {
    // Mock maximize
  }

  unmaximize(): void {
    // Mock unmaximize
  }

  minimize(): void {
    // Mock minimize
  }

  restore(): void {
    // Mock restore
  }

  setBounds(bounds: any): void {
    // Mock setBounds
  }

  getSize(): [number, number] {
    return [800, 600]
  }

  setPosition(x: number, y: number): void {
    // Mock setPosition
  }

  getPosition(): [number, number] {
    return [100, 100]
  }

  setTitle(title: string): void {
    // Mock setTitle
  }
}

// Mock Tray
class TrayMock extends EventEmitter {
  constructor(public icon: any) {
    super()
  }

  setToolTip(toolTip: string): void {
    // Mock setToolTip
  }

  setContextMenu(menu: any): void {
    // Mock setContextMenu
  }

  displayBalloon(options: any): void {
    // Mock displayBalloon
  }

  destroy(): void {
    this.emit('click')
  }
}

// Mock app
class AppMock extends EventEmitter {
  isReady = () => true
  quit = vi.fn()
  exit = vi.fn()
  focus = vi.fn()
  getVersion = () => '0.9.0'
  getName = () => 'Lucent Chat'
  getAppPath = () => '/app/path'
  getPath = (name: string) => {
    const paths: Record<string, string> = {
      home: '/home/user',
      userData: '/home/user/.lucent',
      temp: '/tmp',
      downloads: '/home/user/Downloads',
    }
    return paths[name] || '/tmp'
  }
  setAppUserModelId = vi.fn()
  setAsDefaultProtocolClient = vi.fn()
  removeAsDefaultProtocolClient = vi.fn()
  isDefaultProtocolClient = () => false
  setLoginItemSettings = vi.fn()
  getLoginItemSettings = () => ({ openAtLogin: false })
  relaunch = vi.fn()
  isPackaged = false
  requestSingleInstanceLock = () => true
  hasSingleInstanceLock = () => true
  releaseSingleInstanceLock = vi.fn()
  commandLine = {
    hasSwitch: (name: string) => false,
    getSwitchValue: (name: string) => '',
  }
  on = vi.fn((event: string, listener: (...args: any[]) => void) => {
    return super.on(event, listener)
  })
  once = vi.fn((event: string, listener: (...args: any[]) => void) => {
    return super.once(event, listener)
  })
  whenReady = () => Promise.resolve()
}

// Mock nativeImage
const nativeImageMock = {
  createFromPath: (path: string) => ({ path }),
  createEmpty: () => ({}),
  createFromBuffer: (buffer: Buffer, size?: any) => ({ buffer }),
  createFromDataURL: (dataURL: string) => ({ dataURL }),
  toPNG: () => Buffer.from(''),
  toJPEG: (quality: number) => Buffer.from(''),
  toDataURL: () => 'data:image/png;base64,',
  getAspectRatio = () => 1,
  getSize = () => ({ width: 100, height: 100 }),
  isEmpty = () => false,
}

// Create mock instances
const mockApp = new AppMock()
const mockIpcMain = new IpcMainMock()

// Export mocks
export const mockElectron = {
  app: mockApp,
  BrowserWindow: BrowserWindowMock,
  ipcMain: mockIpcMain,
  Tray: TrayMock,
  nativeImage: nativeImageMock,
}

// Export for vi.mock usage
export default mockElectron
