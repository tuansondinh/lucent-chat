/**
 * Mock for Electron APIs used in tests.
 * This allows main process code to run without actual Electron runtime.
 * Uses plain Node.js — no vi/vitest globals.
 */

import { EventEmitter } from 'node:events'

// Mock ipcMain
class IpcMainMock extends EventEmitter {
  channels = new Map<string, Set<(event: any, ...args: any[]) => void>>()
  handlers = new Map<string, (event: any, ...args: any[]) => any>()

  on(channel: string, listener: (event: any, ...args: any[]) => void): this {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set())
    }
    this.channels.get(channel)!.add(listener)
    return super.on(channel, listener)
  }

  handle(channel: string, handler: (event: any, ...args: any[]) => any): void {
    this.handlers.set(channel, handler)
  }

  async invoke(channel: string, ...args: any[]): Promise<any> {
    const handler = this.handlers.get(channel)
    if (!handler) {
      throw new Error(`No handler registered for channel: ${channel}`)
    }
    const mockEvent = { sender: { send: () => {} } }
    return handler(mockEvent, ...args)
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

  removeAllListeners(channel?: string): this {
    if (channel) {
      this.channels.delete(channel)
      this.handlers.delete(channel)
    } else {
      this.channels.clear()
      this.handlers.clear()
    }
    return super.removeAllListeners(channel)
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
  send(channel: string, ...args: any[]): void {
    this.emit('send', channel, ...args)
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

  loadURL(_url: string): Promise<void> {
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

  focus(): void {}

  blur(): void {}

  isMinimized(): boolean {
    return false
  }

  maximize(): void {}

  unmaximize(): void {}

  minimize(): void {}

  restore(): void {}

  setBounds(_bounds: any): void {}

  getSize(): [number, number] {
    return [800, 600]
  }

  setPosition(_x: number, _y: number): void {}

  getPosition(): [number, number] {
    return [100, 100]
  }

  setTitle(_title: string): void {}
}

// Mock Tray
class TrayMock extends EventEmitter {
  constructor(public icon: any) {
    super()
  }

  setToolTip(_toolTip: string): void {}

  setContextMenu(_menu: any): void {}

  displayBalloon(_options: any): void {}

  destroy(): void {
    this.emit('click')
  }
}

// Mock app
class AppMock extends EventEmitter {
  isReady = () => true
  quit = () => {}
  exit = () => {}
  focus = () => {}
  getVersion = () => '0.9.0'
  getName = () => 'Lucent Code'
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
  setAppUserModelId = () => {}
  setAsDefaultProtocolClient = () => {}
  removeAsDefaultProtocolClient = () => {}
  isDefaultProtocolClient = () => false
  setLoginItemSettings = () => {}
  getLoginItemSettings = () => ({ openAtLogin: false })
  relaunch = () => {}
  isPackaged = false
  requestSingleInstanceLock = () => true
  hasSingleInstanceLock = () => true
  releaseSingleInstanceLock = () => {}
  commandLine = {
    hasSwitch: (_name: string) => false,
    getSwitchValue: (_name: string) => '',
  }
  on = (event: string, listener: (...args: any[]) => void) => {
    return super.on(event, listener)
  }
  once = (event: string, listener: (...args: any[]) => void) => {
    return super.once(event, listener)
  }
  whenReady = () => Promise.resolve()
}

// Mock nativeImage
const nativeImageMock = {
  createFromPath: (_path: string) => ({ path: _path }),
  createEmpty: () => ({}),
  createFromBuffer: (buffer: Buffer, _size?: any) => ({ buffer }),
  createFromDataURL: (dataURL: string) => ({ dataURL }),
  toPNG: () => Buffer.from(''),
  toJPEG: (_quality: number) => Buffer.from(''),
  toDataURL: () => 'data:image/png;base64,',
  getAspectRatio: () => 1,
  getSize: () => ({ width: 100, height: 100 }),
  isEmpty: () => false,
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

// Named exports used by tests: import { ipcMain } from 'electron'
export const app = mockApp
export const ipcMain = mockIpcMain
export const BrowserWindow = BrowserWindowMock
export const shell = {
  openExternal: (_url: string) => Promise.resolve(),
  openPath: (_path: string) => Promise.resolve(''),
  showItemInFolder: (_path: string) => {},
  beep: () => {},
}
export const dialog = {
  showOpenDialog: (_options?: any) => Promise.resolve({ canceled: true, filePaths: [] }),
  showSaveDialog: (_options?: any) => Promise.resolve({ canceled: true, filePath: undefined }),
  showMessageBox: (_options?: any) => Promise.resolve({ response: 0 }),
  showErrorBox: (_title: string, _content: string) => {},
}

// Export for vi.mock usage
export default mockElectron
