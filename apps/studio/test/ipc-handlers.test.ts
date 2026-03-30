import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { pushEvent } from '../src/main/ipc-handlers.js'

test('pushEvent sends to a live renderer', () => {
  const sent: Array<{ channel: string; data: unknown }> = []
  const win = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel: string, data: unknown) => {
        sent.push({ channel, data })
      },
    },
  } as any

  pushEvent(win, 'event:test', { ok: true })

  assert.deepEqual(sent, [{ channel: 'event:test', data: { ok: true } }])
})

test('pushEvent ignores disposed renderer frames during shutdown', () => {
  const win = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: () => {
        throw new Error('Render frame was disposed before WebFrameMain could be accessed')
      },
    },
  } as any

  assert.doesNotThrow(() => pushEvent(win, 'event:test', { ok: true }))
})

test('pushEvent skips destroyed windows and webContents', () => {
  const events = new EventEmitter()
  let sendCount = 0
  const win = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: () => {
        sendCount += 1
        events.emit('sent')
      },
    },
  } as any

  pushEvent({ ...win, isDestroyed: () => true }, 'event:test', null)
  pushEvent({ ...win, webContents: { ...win.webContents, isDestroyed: () => true } }, 'event:test', null)

  assert.equal(sendCount, 0)
})
