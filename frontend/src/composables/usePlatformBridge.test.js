// @vitest-environment happy-dom

import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  callBridge,
  beginUpdateDownload,
  checkForUpdate,
  consumePendingReplay,
  dismissOptionalUpdate,
  getCapabilities,
  getNativeBridgeVersion,
  getPendingReplay,
  getUpdateStatus,
  installUpdate,
  isAndroidApp,
  isNativeBridgeCompatible,
  supports,
  refreshUpdateStatus,
  startUpdate,
  usePlatformBridge,
} from './usePlatformBridge.js'

/** 模拟 origin-scoped bridge：postMessage → native reply → 'message' 事件。 */
function stubNative(capabilities, pending, consumeResult = true, bridgeVersion = 4, overrides = {}) {
  const listeners = []
  const calls = []
  const results = {
    getCapabilities: capabilities,
    getBridgeVersion: bridgeVersion,
    getPendingReplay: pending ?? null,
    consumePendingReplay: consumeResult,
    checkForUpdate: true,
    startUpdate: true,
    ...overrides,
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
    await expect(consumePendingReplay('pid-0')).resolves.toBe(false)
  })

  it('capability detection via injected bridge', async () => {
    stubNative(['replay-share', 'replay-open', 'app-update'], { pendingId: 'pid-0', name: 'a.wotbreplay', uri: 'http://127.0.0.1:21653/__native/replay-pending', size: 1 })
    expect(isAndroidApp()).toBe(true)
    await expect(getCapabilities()).resolves.toEqual(['replay-share', 'replay-open', 'app-update'])
    await expect(supports('replay-share')).resolves.toBe(true)
    await expect(supports('does-not-exist')).resolves.toBe(false)
    await expect(getNativeBridgeVersion()).resolves.toBe(4)
    expect(isNativeBridgeCompatible(4)).toBe(true)
    expect(isNativeBridgeCompatible(3)).toBe(false)
    expect(isNativeBridgeCompatible(1)).toBe(false)
    await expect(getPendingReplay()).resolves.toEqual({ pendingId: 'pid-0', name: 'a.wotbreplay', uri: 'http://127.0.0.1:21653/__native/replay-pending', size: 1 })
    await expect(consumePendingReplay('pid-0')).resolves.toBe(true)
  })

  it('usePlatformBridge exposes the same surface', async () => {
    const p = usePlatformBridge()
    expect(p.isAndroidApp()).toBe(false)
    await expect(p.supports('app-update')).resolves.toBe(false)
    expect(p.getUpdateStatus).toBe(getUpdateStatus)
    expect(p.refreshUpdateStatus).toBe(refreshUpdateStatus)
    expect(p.beginUpdateDownload).toBe(beginUpdateDownload)
    expect(p.installUpdate).toBe(installUpdate)
    expect(p.dismissOptionalUpdate).toBe(dismissOptionalUpdate)
  })

  it('保留旧更新 Boolean wire，新增动作只传 expected identity', async () => {
    const snapshot = { revision: 4, state: 'optional' }
    const native = stubNative(['app-update', 'app-update-status'], null, true, 3, {
      getUpdateStatus: snapshot,
      refreshUpdateStatus: snapshot,
      beginUpdateDownload: true,
      installUpdate: true,
      dismissOptionalUpdate: false,
    })
    await expect(checkForUpdate()).resolves.toBe(true)
    await expect(startUpdate()).resolves.toBe(true)
    await expect(getUpdateStatus()).resolves.toEqual(snapshot)
    await expect(refreshUpdateStatus()).resolves.toEqual(snapshot)
    await expect(beginUpdateDownload(3028000)).resolves.toBe(true)
    await expect(installUpdate('task-1')).resolves.toBe(true)
    await expect(dismissOptionalUpdate(3028000)).resolves.toBe(false)
    expect(native.calls).toEqual([
      { method: 'checkForUpdate', params: {} },
      { method: 'startUpdate', params: {} },
      { method: 'getUpdateStatus', params: {} },
      { method: 'refreshUpdateStatus', params: {} },
      { method: 'beginUpdateDownload', params: { expectedLatestVersionCode: 3028000 } },
      { method: 'installUpdate', params: { expectedTaskToken: 'task-1' } },
      { method: 'dismissOptionalUpdate', params: { expectedLatestVersionCode: 3028000 } },
    ])
  })

  it('无桥时新方法返回未知/拒绝，动作不把 truthy 非 Boolean 误判为成功', async () => {
    await expect(getUpdateStatus()).resolves.toBeNull()
    await expect(refreshUpdateStatus()).resolves.toBeNull()
    await expect(beginUpdateDownload(3028000)).resolves.toBe(false)
    await expect(installUpdate('task-1')).rejects.toThrow('Native bridge unavailable')
    await expect(dismissOptionalUpdate(3028000)).resolves.toBe(false)
    stubNative(['app-update-status'], null, true, 3, {
      beginUpdateDownload: 'true', installUpdate: 1, dismissOptionalUpdate: {},
    })
    await expect(beginUpdateDownload(3028000)).resolves.toBe(false)
    await expect(installUpdate('task-1')).resolves.toBeNull()
    await expect(dismissOptionalUpdate(3028000)).resolves.toBe(false)
  })

  it('refresh 独用 15s 预算，读取 snapshot 仍为默认 5s', async () => {
    vi.useFakeTimers()
    window.WotbNative = {
      postMessage: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }
    let readSettled = false
    let refreshSettled = false
    const read = getUpdateStatus().then(value => { readSettled = true; return value })
    const refresh = refreshUpdateStatus().then(value => { refreshSettled = true; return value })
    await vi.advanceTimersByTimeAsync(5000)
    expect(readSettled).toBe(true)
    expect(refreshSettled).toBe(false)
    await vi.advanceTimersByTimeAsync(9999)
    expect(refreshSettled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(read).resolves.toBeNull()
    await expect(refresh).resolves.toBeNull()
  })

  it('allows package selection up to 120 seconds and still times out', async () => {
    vi.useFakeTimers()
    window.WotbNative = { postMessage: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }
    let settled = false
    const result = beginUpdateDownload(4000000).then(value => { settled = true; return value })
    await vi.advanceTimersByTimeAsync(119_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe(false)
  })

  it('keeps an install request pending beyond five seconds and accepts a later native reply', async () => {
    vi.useFakeTimers()
    let listener
    let request
    window.WotbNative = {
      postMessage: vi.fn(json => { request = JSON.parse(json) }),
      addEventListener: vi.fn((type, cb) => { listener = cb }),
      removeEventListener: vi.fn(),
    }
    let settled = false
    const result = installUpdate('task-1').then(value => { settled = true; return value })
    await vi.advanceTimersByTimeAsync(6000)
    expect(settled).toBe(false)
    listener({ data: { id: request.id, result: true } })
    await expect(result).resolves.toBe(true)
    expect(window.WotbNative.postMessage).toHaveBeenCalledTimes(1)
  })

  it('reports an install deadline without asserting that Native cancelled it', async () => {
    vi.useFakeTimers()
    let listener
    let request
    window.WotbNative = {
      postMessage: vi.fn(json => { request = JSON.parse(json) }),
      addEventListener: vi.fn((type, cb) => { listener = cb }),
      removeEventListener: vi.fn(),
    }
    const onTimeout = vi.fn()
    let settled = false
    const result = installUpdate('task-1', onTimeout).then(value => { settled = true; return value })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(settled).toBe(false)
    expect(window.WotbNative.removeEventListener).not.toHaveBeenCalled()
    listener({ data: { id: request.id, result: true } })
    await expect(result).resolves.toBe(true)
    expect(window.WotbNative.removeEventListener).toHaveBeenCalledExactlyOnceWith('message', listener)
    expect(window.WotbNative.postMessage).toHaveBeenCalledTimes(1)
  })

  it.each([0, 120_000])('aborts only page install listeners at %sms without another Native request', async elapsed => {
    vi.useFakeTimers()
    const listeners = new Set()
    window.WotbNative = {
      postMessage: vi.fn(),
      addEventListener: vi.fn((_type, listener) => { listeners.add(listener) }),
      removeEventListener: vi.fn((_type, listener) => { listeners.delete(listener) }),
    }
    const onTimeout = vi.fn()
    const abort = new AbortController()
    const result = installUpdate('task-1', onTimeout, abort.signal)
    expect(listeners.size).toBe(1)
    await vi.advanceTimersByTimeAsync(elapsed)
    expect(listeners.size).toBe(1)
    abort.abort()
    await expect(result).resolves.toBeNull()
    expect(listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    const observed = onTimeout.mock.calls.length
    await vi.advanceTimersByTimeAsync(120_000)
    expect(onTimeout).toHaveBeenCalledTimes(observed)
    expect(window.WotbNative.postMessage).toHaveBeenCalledTimes(1)
  })

  it('removes the install deadline even when Native replies synchronously', async () => {
    vi.useFakeTimers()
    stubNative(['app-update-status'], null, true, 3, { installUpdate: true })
    const onTimeout = vi.fn()
    await expect(installUpdate('task-1', onTimeout)).resolves.toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('consumePendingReplay 携带 expectedPendingId（identity-aware ACK 的 wire 边界）', async () => {
    const native = stubNative(['replay-share'], { pendingId: 'pid-1', name: 'a.wotbreplay', uri: 'http://127.0.0.1:21653/__native/replay-pending', size: 1 })
    await expect(consumePendingReplay('pid-1')).resolves.toBe(true)
    expect(native.calls.at(-1)).toEqual({
      method: 'consumePendingReplay',
      params: { expectedPendingId: 'pid-1' },
    })
  })

  it('Native compare-and-clear 返回 false（identity 不匹配）时如实透传 false', async () => {
    stubNative(['replay-share'], { pendingId: 'pid-2', name: 'a.wotbreplay', uri: 'http://127.0.0.1:21653/__native/replay-pending', size: 1 }, false)
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
