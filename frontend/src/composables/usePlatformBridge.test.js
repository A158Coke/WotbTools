// @vitest-environment happy-dom

import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  consumePendingReplay,
  getAuthClientSessionId,
  setAuthClientSessionId,
  getCapabilities,
  getNativeBridgeVersion,
  getPendingReplay,
  isLegacyNativeReplayContractCompatible,
  isAndroidApp,
  isNativeBridgeCompatible,
  supports,
  usePlatformBridge,
} from './usePlatformBridge.js'

/** 模拟 origin-scoped bridge：postMessage → native reply → 'message' 事件。 */
function stubNative(capabilities, pending, consumeResult = true) {
  const listeners = []
  const calls = []
  const results = {
    getCapabilities: capabilities,
    getBridgeVersion: 1,
    getPendingReplay: pending ?? null,
    consumePendingReplay: consumeResult,
    checkForUpdate: true,
    startUpdate: true,
  }
  window.WotbNative = {
    postMessage: vi.fn((json) => {
      const msg = JSON.parse(json)
      calls.push({ method: msg.method, params: msg.params })
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
  return { calls }
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
    stubNative(['replay-share', 'replay-open', 'app-update'], { name: 'a.wotbreplay', uri: 'https://wotbtools.com/__native/replay-pending', size: 1 })
    expect(isAndroidApp()).toBe(true)
    await expect(getCapabilities()).resolves.toEqual(['replay-share', 'replay-open', 'app-update'])
    await expect(supports('replay-share')).resolves.toBe(true)
    await expect(supports('does-not-exist')).resolves.toBe(false)
    await expect(getNativeBridgeVersion()).resolves.toBe(1)
    expect(isNativeBridgeCompatible(1)).toBe(true)
    expect(isNativeBridgeCompatible(2)).toBe(false)
    expect(isLegacyNativeReplayContractCompatible({
      bridgeVersion: null,
      capabilities: ['replay-open', 'replay-share'],
      pending: { uri: 'https://wotbtools.com/__native/replay-pending' },
    })).toBe(true)
    expect(isLegacyNativeReplayContractCompatible({
      bridgeVersion: null,
      capabilities: ['replay-open'],
      pending: { uri: 'https://wotbtools.com/__native/replay-pending' },
    })).toBe(false)
    expect(isLegacyNativeReplayContractCompatible({
      bridgeVersion: null,
      capabilities: ['replay-open', 'replay-share'],
      pending: { uri: 'content://legacy/replay' },
    })).toBe(false)
    await expect(getPendingReplay()).resolves.toEqual({ name: 'a.wotbreplay', uri: 'https://wotbtools.com/__native/replay-pending', size: 1 })
    await expect(consumePendingReplay()).resolves.toBe(true)
  })

  it('usePlatformBridge exposes the same surface', async () => {
    const p = usePlatformBridge()
    expect(p.isAndroidApp()).toBe(false)
    await expect(p.supports('app-update')).resolves.toBe(false)
  })

  it('consumePendingReplay 携带 expectedPendingId（identity-aware ACK 的 wire 边界）', async () => {
    const native = stubNative(['replay-share'], { pendingId: 'pid-1', name: 'a.wotbreplay', uri: 'https://wotbtools.com/__native/replay-pending', size: 1 })
    await expect(consumePendingReplay('pid-1')).resolves.toBe(true)
    expect(native.calls.at(-1)).toEqual({
      method: 'consumePendingReplay',
      params: { expectedPendingId: 'pid-1' },
    })
  })

  it('Native compare-and-clear 返回 false（identity 不匹配）时如实透传 false', async () => {
    stubNative(['replay-share'], { pendingId: 'pid-2', name: 'a.wotbreplay', uri: 'https://wotbtools.com/__native/replay-pending', size: 1 }, false)
    await expect(consumePendingReplay('pid-1')).resolves.toBe(false)
  })
  it('auth session RPC sends only a UUID and tolerates an older native bridge', async () => {
    const { calls } = stubNative([], null)
    expect(await getAuthClientSessionId()).toBeNull()
    expect(await setAuthClientSessionId('48ec107a-c954-489c-9919-ea6f6ac1317c')).toBe(false)
    expect(calls).toEqual([
      { method: 'getAuthClientSessionId', params: {} },
      { method: 'setAuthClientSessionId', params: { clientSessionId: '48ec107a-c954-489c-9919-ea6f6ac1317c' } },
    ])
  })

  it('round-trips the UUID session through the trusted-origin native RPC', async () => {
    stubNative([], null)
    let listener
    let nativeSessionId = '48ec107a-c954-489c-9919-ea6f6ac1317c'
    window.WotbNative.addEventListener = (_, callback) => { listener = callback }
    window.WotbNative.postMessage = json => {
      const message = JSON.parse(json)
      if (message.method === 'setAuthClientSessionId') nativeSessionId = message.params.clientSessionId
      const result = message.method === 'getAuthClientSessionId' ? nativeSessionId : true
      queueMicrotask(() => listener({ data: JSON.stringify({ id: message.id, result }) }))
    }
    expect(await getAuthClientSessionId()).toBe(nativeSessionId)
    const attempt = crypto.randomUUID()
    expect(await setAuthClientSessionId(attempt)).toBe(true)
    expect(await getAuthClientSessionId()).toBe(attempt)
  })

})
