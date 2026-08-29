// @vitest-environment happy-dom

import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  consumePendingReplay,
  getCapabilities,
  getPendingReplay,
  isAndroidApp,
  supports,
  usePlatformBridge,
} from './usePlatformBridge.js'

/** 模拟 origin-scoped bridge：postMessage → native reply → 'message' 事件。 */
function stubNative(capabilities, pending) {
  const listeners = []
  const results = {
    getCapabilities: capabilities,
    getPendingReplay: pending ?? null,
    consumePendingReplay: true,
    checkForUpdate: true,
    startUpdate: true,
  }
  window.WotbNative = {
    postMessage: vi.fn((json) => {
      const msg = JSON.parse(json)
      listeners.forEach(cb =>
        cb({ data: JSON.stringify({ id: msg.id, result: results[msg.method] ?? null }) })
      )
    }),
    addEventListener: vi.fn((type, cb) => listeners.push(cb)),
    removeEventListener: vi.fn((type, cb) => {
      const i = listeners.indexOf(cb)
      if (i >= 0) listeners.splice(i, 1)
    }),
  }
}

describe('usePlatformBridge', () => {
  afterEach(() => {
    delete window.WotbNative
  })

  it('Web fallback when no native bridge (browser)', async () => {
    expect(isAndroidApp()).toBe(false)
    await expect(getCapabilities()).resolves.toEqual([])
    await expect(supports('replay-share')).resolves.toBe(false)
    await expect(getPendingReplay()).resolves.toBeNull()
    await expect(consumePendingReplay()).resolves.toBe(false)
  })

  it('capability detection via injected bridge', async () => {
    stubNative(['replay-share', 'replay-open', 'app-update'], { name: 'a.wotbreplay', uri: 'content://x', size: 1 })
    expect(isAndroidApp()).toBe(true)
    await expect(getCapabilities()).resolves.toEqual(['replay-share', 'replay-open', 'app-update'])
    await expect(supports('replay-share')).resolves.toBe(true)
    await expect(supports('does-not-exist')).resolves.toBe(false)
    await expect(getPendingReplay()).resolves.toEqual({ name: 'a.wotbreplay', uri: 'content://x', size: 1 })
    await expect(consumePendingReplay()).resolves.toBe(true)
  })

  it('usePlatformBridge exposes the same surface', async () => {
    const p = usePlatformBridge()
    expect(p.isAndroidApp()).toBe(false)
    await expect(p.supports('app-update')).resolves.toBe(false)
  })
})
