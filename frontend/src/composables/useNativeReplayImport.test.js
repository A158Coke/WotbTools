// @vitest-environment happy-dom

import { describe, expect, it, vi, afterEach } from 'vitest'
import { useNativeReplayImport } from './useNativeReplayImport.js'

function stubNative(pending) {
  const listeners = []
  const results = { getPendingReplay: pending ?? null }
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

describe('useNativeReplayImport', () => {
  afterEach(() => {
    delete window.WotbNative
    delete window.wotbtoolsOnReplay
  })

  it('registers the global handler and is a no-op on a plain browser', async () => {
    const { consumePendingWhenReady } = useNativeReplayImport()
    expect(typeof window.wotbtoolsOnReplay).toBe('function')
    await expect(consumePendingWhenReady()).resolves.toBe(false)
  })

  it('clicks the first .wotbreplay file input when a native pending replay exists', async () => {
    stubNative({ name: 'a.wotbreplay', uri: 'content://x', size: 1 })
    const input = document.createElement('input')
    input.setAttribute('type', 'file')
    input.setAttribute('accept', '.wotbreplay')
    document.body.appendChild(input)
    const clickSpy = vi.spyOn(input, 'click')
    const { consumePendingWhenReady } = useNativeReplayImport()
    await consumePendingWhenReady()
    expect(clickSpy).toHaveBeenCalled()
    input.remove()
  })

  it('does not consume a pending replay before login (cross-auth retention)', async () => {
    stubNative({ name: 'a.wotbreplay', uri: 'content://x', size: 1 })
    const input = document.createElement('input')
    input.setAttribute('type', 'file')
    input.setAttribute('accept', '.wotbreplay')
    document.body.appendChild(input)
    const clickSpy = vi.spyOn(input, 'click')
    const { consumePendingWhenReady } = useNativeReplayImport()
    await consumePendingWhenReady({ authenticated: false })
    expect(clickSpy).not.toHaveBeenCalled()
    // 登录后就绪时可消费
    await consumePendingWhenReady({ authenticated: true })
    expect(clickSpy).toHaveBeenCalledTimes(1)
    // exactly-once：再次调用不重复点击
    await consumePendingWhenReady({ authenticated: true })
    expect(clickSpy).toHaveBeenCalledTimes(1)
    input.remove()
  })
})
