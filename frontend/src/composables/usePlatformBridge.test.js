// @vitest-environment happy-dom

import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  callBridge,
  consumePendingReplay,
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
function stubNative(capabilities, pending, consumeResult = true, bridgeVersion = 2) {
  const listeners = []
  const calls = []
  const results = {
    getCapabilities: capabilities,
    getBridgeVersion: bridgeVersion,
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
    vi.useRealTimers()
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
    await expect(getNativeBridgeVersion()).resolves.toBe(2)
    expect(isNativeBridgeCompatible(2)).toBe(true)
    expect(isNativeBridgeCompatible(1)).toBe(false)
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

  it('callBridge 是唯一 RPC transport：超时按 per-call 预算解析为 null，绝不挂起', async () => {
    vi.useFakeTimers()
    const methods = []
    window.WotbNative = {
      postMessage: vi.fn((json) => { methods.push(JSON.parse(json).method) }), // native 永不回复
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    let settled = ''
    const defaultBudget = callBridge('getBridgeVersion').then(value => {
      settled += 'default'
      return value
    })
    const authBudget = callBridge('authGetState', {}, { timeoutMs: 20_000 }).then(value => {
      settled += '|auth'
      return value
    })

    // 通用方法保持 5s 预算；native-auth 的长预算由调用方逐次传入。
    await vi.advanceTimersByTimeAsync(5_000)
    expect(settled).toBe('default')
    await vi.advanceTimersByTimeAsync(15_000)
    expect(settled).toBe('default|auth')

    await expect(defaultBudget).resolves.toBeNull()
    await expect(authBudget).resolves.toBeNull()
    expect(methods).toEqual(['getBridgeVersion', 'authGetState'])
  })

  it('callBridge 在没有 bridge（普通浏览器）时直接解析 null', async () => {
    await expect(callBridge('authGetState', {}, { timeoutMs: 20_000 })).resolves.toBeNull()
  })
})
