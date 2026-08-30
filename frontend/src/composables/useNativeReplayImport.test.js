// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNativeReplayImport } from './useNativeReplayImport.js'

function stubNative(pending, consumeResult = true) {
  const listeners = []
  let current = pending ?? null
  let cleared = false
  window.WotbNative = {
    postMessage: vi.fn((json) => {
      const msg = JSON.parse(json)
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
    const onPendingFile = vi.fn()
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
    const onPendingFile = vi.fn()
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
    const onPendingFile = vi.fn()
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
    const onPendingFile = vi.fn()
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
    const onPendingFile = vi.fn()
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
})
