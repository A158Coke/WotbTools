// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNativeReplayImport } from './useNativeReplayImport.js'

function stubNative(pending, consumeResult = true) {
  const listeners = []
  const methods = []
  let current = pending ?? null
  let cleared = false
  window.WotbNative = {
    postMessage: vi.fn((json) => {
      const msg = JSON.parse(json)
      methods.push(msg.method)
      listeners.forEach(cb => {
        let result
        if (msg.method === 'getPendingReplay') {
          result = cleared ? null : current
        } else if (msg.method === 'consumePendingReplay') {
          if (current != null && !cleared) {
            cleared = true
            current = null
            result = consumeResult
          } else {
            result = false
          }
        } else {
          result = null
        }
        cb({ data: JSON.stringify({ id: msg.id, result }) })
      })
    }),
    addEventListener: vi.fn((type, cb) => listeners.push(cb)),
    removeEventListener: vi.fn((type, cb) => {
      const i = listeners.indexOf(cb)
      if (i >= 0) listeners.splice(i, 1)
    }),
  }
  return {
    methods,
    setPending(p) { current = p; cleared = false },
  }
}

/** 模拟 Native shouldInterceptRequest 以 content:// 安全 URI 返回缓存文件字节。 */
function stubFetchBlob() {
  vi.stubGlobal('fetch', vi.fn(async (uri) => {
    if (uri === 'content://pending-replay') {
      return { ok: true, blob: async () => new Blob(['replay-bytes'], { type: 'application/octet-stream' }) }
    }
    return { ok: false, status: 404 }
  }))
}

describe('useNativeReplayImport', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    delete window.WotbNative
    delete window.wotbtoolsOnReplay
    vi.unstubAllGlobals()
  })

  it('registers the global handler and is a no-op on a plain browser', async () => {
    const { consumePendingWhenReady } = useNativeReplayImport()
    expect(typeof window.wotbtoolsOnReplay).toBe('function')
    await expect(consumePendingWhenReady()).resolves.toBe(false)
  })

  it('reads pending replay bytes via fetch(content://uri) and injects a File into selection', async () => {
    stubNative({ name: 'a.wotbreplay', uri: 'content://pending-replay', size: 5 })
    stubFetchBlob()
    const onPendingFile = vi.fn(async () => true)
    const { consumePendingWhenReady } = useNativeReplayImport({
      isAuthenticated: () => true,
      onPendingFile,
    })
    const consumed = await consumePendingWhenReady()
    expect(consumed).toBe(true)
    expect(onPendingFile).toHaveBeenCalledTimes(1)
    const file = onPendingFile.mock.calls[0][0]
    expect(file.name).toBe('a.wotbreplay')
    // bytes actually flowed into the browser File (existing upload pipeline)
    expect(await file.text()).toBe('replay-bytes')
  })

  it('does not consume pending replay before login (cross-auth retention)', async () => {
    stubNative({ name: 'a.wotbreplay', uri: 'content://pending-replay', size: 5 })
    stubFetchBlob()
    const onPendingFile = vi.fn(async () => true)
    const { consumePendingWhenReady } = useNativeReplayImport({
      isAuthenticated: () => false,
      onPendingFile,
    })
    await consumePendingWhenReady()
    expect(onPendingFile).not.toHaveBeenCalled()
    // 登录后就绪时可消费
    const authed = useNativeReplayImport({ isAuthenticated: () => true, onPendingFile })
    await authed.consumePendingWhenReady()
    expect(onPendingFile).toHaveBeenCalledTimes(1)
  })

  it('exactly-once：同一会话只消费一次 pending', async () => {
    stubNative({ name: 'a.wotbreplay', uri: 'content://pending-replay', size: 5 })
    stubFetchBlob()
    const onPendingFile = vi.fn(async () => true)
    const { consumePendingWhenReady } = useNativeReplayImport({
      isAuthenticated: () => true,
      onPendingFile,
    })
    await consumePendingWhenReady()
    await consumePendingWhenReady()
    expect(onPendingFile).toHaveBeenCalledTimes(1)
  })

  it('window.wotbtoolsOnReplay 走实际登录态，不默认 authenticated=true', async () => {
    const native = stubNative({ name: 'a.wotbreplay', uri: 'content://pending-replay', size: 5 })
    stubFetchBlob()
    const onPendingFile = vi.fn(async () => true)
    const authed = vi.fn(() => false)
    const { registerGlobalHandler } = useNativeReplayImport({ isAuthenticated: authed, onPendingFile })
    registerGlobalHandler()
    await window.wotbtoolsOnReplay()
    expect(onPendingFile).not.toHaveBeenCalled()
    // 登录后由 Workspace 再次触发
    authed.mockReturnValue(true)
    await window.wotbtoolsOnReplay()
    expect(onPendingFile).toHaveBeenCalledTimes(1)
    native.setPending(null)
  })

  it('warm resume：首次无 pending 不清零 lifetime，稍后 Native 新增 pending 仍可消费 exactly once', async () => {
    const native = stubNative(null)
    stubFetchBlob()
    const onPendingFile = vi.fn(async () => true)
    const { consumePendingWhenReady, registerGlobalHandler } = useNativeReplayImport({
      isAuthenticated: () => true,
      onPendingFile,
    })
    registerGlobalHandler()

    // 第一次：无 pending → 不清零 eligible
    await consumePendingWhenReady()
    expect(onPendingFile).not.toHaveBeenCalled()

    // Native 后来（warm resume）产生新 pending
    native.setPending({ name: 'b.wotbreplay', uri: 'content://pending-replay', size: 5 })
    await window.wotbtoolsOnReplay()
    expect(onPendingFile).toHaveBeenCalledTimes(1)
    expect(onPendingFile.mock.calls[0][0].name).toBe('b.wotbreplay')

    // 同一份 pending 不重复消费（exactly once）
    await window.wotbtoolsOnReplay()
    expect(onPendingFile).toHaveBeenCalledTimes(1)
  })

  it('未登录时绝不触碰 Native pending：不 get、不 consume、不导入', async () => {
    const native = stubNative({ name: 'a.wotbreplay', uri: 'content://pending-replay', size: 5 })
    stubFetchBlob()
    const onPendingFile = vi.fn(async () => true)
    const { consumePendingWhenReady } = useNativeReplayImport({ isAuthenticated: () => false, onPendingFile })

    await expect(consumePendingWhenReady()).resolves.toBe(false)
    expect(native.methods).toEqual([])
    expect(onPendingFile).not.toHaveBeenCalled()
  })

  it('业务受理成功后才 ACK Native：accepted 先于 consume，且只 consume 一次', async () => {
    const native = stubNative({ name: 'a.wotbreplay', uri: 'content://pending-replay', size: 5 })
    stubFetchBlob()
    const order = []
    const basePost = window.WotbNative.postMessage
    window.WotbNative.postMessage = vi.fn((json) => {
      if (JSON.parse(json).method === 'consumePendingReplay') order.push('consume')
      return basePost(json)
    })
    const onPendingFile = vi.fn(async () => { order.push('accepted'); return true })
    const { consumePendingWhenReady } = useNativeReplayImport({ isAuthenticated: () => true, onPendingFile })

    await expect(consumePendingWhenReady()).resolves.toBe(true)
    expect(order).toEqual(['accepted', 'consume'])
    expect(native.methods.filter(m => m === 'consumePendingReplay')).toHaveLength(1)
  })

  it('业务未受理（false / undefined）时不 ACK Native，pending 保留可重试', async () => {
    const native = stubNative({ name: 'a.wotbreplay', uri: 'content://pending-replay', size: 5 })
    stubFetchBlob()
    const onPendingFile = vi.fn(async () => false)
    const { consumePendingWhenReady } = useNativeReplayImport({ isAuthenticated: () => true, onPendingFile })

    await expect(consumePendingWhenReady()).resolves.toBe(false)
    expect(native.methods).not.toContain('consumePendingReplay')

    // 重试：这次业务受理成功 → 才 ACK
    onPendingFile.mockImplementation(async () => true)
    await expect(consumePendingWhenReady()).resolves.toBe(true)
    expect(native.methods.filter(m => m === 'consumePendingReplay')).toHaveLength(1)

    // 受理失败也必须能被 undefined 返回值触发（不能把「没返回值」当成功）
    const undefinedCase = stubNative({ name: 'c.wotbreplay', uri: 'content://pending-replay', size: 5 })
    stubFetchBlob()
    const noResult = useNativeReplayImport({
      isAuthenticated: () => true,
      onPendingFile: vi.fn(async () => undefined),
    })
    await expect(noResult.consumePendingWhenReady()).resolves.toBe(false)
    expect(undefinedCase.methods).not.toContain('consumePendingReplay')
  })

  it('onPendingFile 抛错时不 ACK Native，下一次仍可重试成功', async () => {
    const native = stubNative({ name: 'a.wotbreplay', uri: 'content://pending-replay', size: 5 })
    stubFetchBlob()
    const onPendingFile = vi.fn(async () => { throw new Error('PROCESSING_CREATE_FAILED') })
    const { consumePendingWhenReady } = useNativeReplayImport({ isAuthenticated: () => true, onPendingFile })

    await expect(consumePendingWhenReady()).resolves.toBe(false)
    expect(native.methods).not.toContain('consumePendingReplay')

    onPendingFile.mockImplementation(async () => true)
    await expect(consumePendingWhenReady()).resolves.toBe(true)
    expect(onPendingFile).toHaveBeenCalledTimes(2)
    expect(native.methods.filter(m => m === 'consumePendingReplay')).toHaveLength(1)
  })

  it('重复全局回调（wotbtoolsOnReplay 连发）只触发一次 in-flight 受理', async () => {
    const native = stubNative({ name: 'a.wotbreplay', uri: 'content://pending-replay', size: 5 })
    stubFetchBlob()
    let release
    const gate = new Promise((res) => { release = res })
    const onPendingFile = vi.fn(async () => { await gate; return true })
    const { consumePendingWhenReady } = useNativeReplayImport({ isAuthenticated: () => true, onPendingFile })

    const first = consumePendingWhenReady()
    await vi.waitFor(() => expect(onPendingFile).toHaveBeenCalledTimes(1))
    const second = consumePendingWhenReady()
    await expect(second).resolves.toBe(false)
    release()
    await expect(first).resolves.toBe(true)
    expect(onPendingFile).toHaveBeenCalledTimes(1)
    expect(native.methods.filter(m => m === 'consumePendingReplay')).toHaveLength(1)
  })
})
