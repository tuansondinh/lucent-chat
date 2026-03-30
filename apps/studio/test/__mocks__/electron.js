import { EventEmitter } from 'node:events'

class IpcMainMock extends EventEmitter {
  constructor() {
    super()
    this.channels = new Map()
    this.handlers = new Map()
  }

  on(channel, listener) {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set())
    }
    this.channels.get(channel).add(listener)
    return super.on(channel, listener)
  }

  handle(channel, handler) {
    this.handlers.set(channel, handler)
  }

  async invoke(channel, ...args) {
    const handler = this.handlers.get(channel)
    if (!handler) {
      throw new Error(`No handler registered for channel: ${channel}`)
    }
    const mockEvent = { sender: { send: () => {} } }
    return handler(mockEvent, ...args)
  }

  removeHandler(channel, listener) {
    const listeners = this.channels.get(channel)
    if (listeners) {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.channels.delete(channel)
      }
    }
    this.removeListener(channel, listener)
  }

  removeAllListeners(channel) {
    if (channel) {
      this.channels.delete(channel)
      this.handlers.delete(channel)
    } else {
      this.channels.clear()
      this.handlers.clear()
    }
    return super.removeAllListeners(channel)
  }
}

class WebContentsMock extends EventEmitter {
  send(channel, ...args) {
    this.emit('send', channel, ...args)
  }

  setWindowOpenHandler() {
    return { action: 'deny' }
  }
}

class BrowserWindowMock extends EventEmitter {
  constructor(options = {}) {
    super()
    this.options = options
    this.webContents = new WebContentsMock()
    this.id = Math.floor(Math.random() * 100000)
    this.destroyed = false
  }

  async loadURL() {}
  async loadFile() {}
  destroy() {
    this.destroyed = true
    this.emit('closed')
  }
  close() {
    this.destroy()
  }
  focus() {}
  blur() {}
  show() {}
  hide() {}
  isDestroyed() {
    return this.destroyed
  }
  isMinimized() {
    return false
  }
  maximize() {}
  unmaximize() {}
  minimize() {}
  restore() {}
  setBounds() {}
  getBounds() {
    return { x: 100, y: 100, width: 800, height: 600 }
  }
  setSize() {}
  getSize() {
    return [800, 600]
  }
  setPosition() {}
  getPosition() {
    return [100, 100]
  }
  setTitle() {}
  setMinimumSize() {}
}

class AppMock extends EventEmitter {
  constructor() {
    super()
    this.isPackaged = false
    this.commandLine = {
      hasSwitch: () => false,
      getSwitchValue: () => '',
    }
  }

  isReady() {
    return true
  }
  quit() {}
  exit() {}
  focus() {}
  getVersion() {
    return '0.9.0'
  }
  getName() {
    return 'Lucent Code'
  }
  getAppPath() {
    return '/app/path'
  }
  getPath(name) {
    const paths = {
      home: '/home/user',
      userData: '/home/user/.lucent',
      temp: '/tmp',
      downloads: '/home/user/Downloads',
    }
    return paths[name] || '/tmp'
  }
  setAppUserModelId() {}
  setAsDefaultProtocolClient() {}
  removeAsDefaultProtocolClient() {}
  isDefaultProtocolClient() {
    return false
  }
  setLoginItemSettings() {}
  getLoginItemSettings() {
    return { openAtLogin: false }
  }
  relaunch() {}
  requestSingleInstanceLock() {
    return true
  }
  hasSingleInstanceLock() {
    return true
  }
  releaseSingleInstanceLock() {}
  whenReady() {
    return Promise.resolve()
  }
}

const mockApp = new AppMock()
const mockIpcMain = new IpcMainMock()

export const app = mockApp
export const ipcMain = mockIpcMain
export const BrowserWindow = BrowserWindowMock
export const shell = {
  openExternal: async () => {},
  openPath: async () => '',
  showItemInFolder: () => {},
  beep: () => {},
}
export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
  showMessageBox: async () => ({ response: 0 }),
  showErrorBox: () => {},
}

const mockElectron = {
  app: mockApp,
  BrowserWindow: BrowserWindowMock,
  ipcMain: mockIpcMain,
  shell,
  dialog,
}

export default mockElectron
