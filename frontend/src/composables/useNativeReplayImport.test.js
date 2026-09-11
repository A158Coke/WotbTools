// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNativeReplayImport } from './useNativeReplayImport.js'

const PENDING_A = { pendingId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', name: 'a.wotbreplay', uri: 'https://wotbtools.com/__native/replay-pending', size: 5 }
const PENDING_B = { pendingId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', name: 'b.wotbreplay', uri: 'https://wotbtools.com/__native/replay-pending', size: 5 }

/**
 * Native 侧替身：`consumePendingReplay` 实现 **compare-and-clear**
 * （只有 expected pendingId 与当前 pending 完全一致才清理），与 Android 侧一致。
 */
function stubNative(pending, consumeResult = true, bridgeVersion = 1) {
  const listeners = []
  const methods = []
  const consumeRequests = []
  let current = pending ?? null
  let cleared = false
  window.WotbNative = {
    postMessage: vi.fn((json) => {
      const msg = JSON.parse(json)
      methods.push(msg.method)
      listeners.forEach(cb => {
        let result
        if (msg.method === 'getBridgeVersion') {
          result = bridgeVersion
        } else if (msg.method === 'getPendingReplay') {
          result = cleared ? null : current
        } else if (msg.method === 'consumePendingReplay') {
          consumeRequests.push(msg.params || {})
          const expected = msg.params?.expectedPendingId
          // identity 必须存在且与当前 pending 完全一致，否则绝不清理（绝不误清后来取代它的 replay）。
          if (current != null && !cleared && expected && current.pendingId === expected) {
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
    consumeRequests,
    getCurrent() { return cleared ? null : current },
    setPending(p) { current = p; cleared = false },
  }
}

/** 模拟 Native shouldInterceptRequest 以 synthetic HTTPS resource 返回缓存文件字节。 */
function stubFetchBlob() {
  vi.stubGlobal('fetch', vi.fn(async (uri) => {
    if (uri === 'https://wotbtools.com/__native/replay-pending') {
      return { ok: true, blob: async () => new Blob(['replay-bytes'], { type: 'application/octet-stream' }) }
    }
    return { ok: false, status: 404 }
  }))
}

describe('useNativeReplayImport', () => {

  it('fails safely when Native Bridge version is incompatible', async () => {
    stubNative(PENDING_A, true, 2)
    const onPendingFile = vi.fn(async () => true)
    const onReadError = vi.fn()
    const { consumePendingWhenReady } = useNativeReplayImport({
      isAuthenticated: () => true,
      onPendingFile,
      onReadError,
    })

    await expect(consumePendingWhenReady()).resolves.toBe(false)
    expect(onPendingFile).not.toHaveBeenCalled()
    expect(onReadError).toHaveBeenCalledWith('native-client-upgrade-required')
  })

  it.each(['http', 'network', 'body'])('retains pending on %s read failure and succeeds on retry', async (failure) => {
    const native = stubNative(PENDING_A)
    const onPendingFile = vi.fn(async () => true)
    const onReadError = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (failure === 'network') throw new Error('secret-file-name token secret')
      if (failure === 'body') return { ok: true, blob: async () => { throw new Error('secret-file-name') } }
      return { ok: false, status: 404 }
    }))
    const { consumePendingWhenReady } = useNativeReplayImport({ isAuthenticated: () => true, onPendingFile, onReadError })
    await expect(consumePendingWhenReady()).resolves.toBe(false)
    expect(onReadError).toHaveBeenCalledTimes(1)
    expect(onPendingFile).not.toHaveBeenCalled()
    expect(native.consumeRequests).toEqual([])
    expect(native.getCurrent()).toEqual(PENDING_A)
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret|aaaaaaaa|a\.wotbreplay/)
    stubFetchBlob()
    await expect(consumePendingWhenReady()).resolves.toBe(true)
    expect(native.consumeRequests).toEqual([{ expectedPendingId: PENDING_A.pendingId }])
  })

  it('drains the replacement when metadata A becomes stale before stream fetch', async () => {
    const native = stubNative(PENDING_A)
    const onPendingFile = vi.fn(async () => true)
    const onReadError = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      if (options.headers['X-Wotb-Pending-Id'] === PENDING_A.pendingId) {
        native.setPending(PENDING_B)
        window.wotbtoolsOnReplay()
        return { ok: false, status: 409 }
      }
      return { ok: true, blob: async () => new Blob(['bytes-B']) }
    }))
    const { consumePendingWhenReady } = useNativeReplayImport({ isAuthenticated: () => true, onPendingFile, onReadError })
    await expect(consumePendingWhenReady()).resolves.toBe(true)
    expect(onPendingFile).toHaveBeenCalledTimes(1)
    const [file, pending] = onPendingFile.mock.calls[0]
    expect(pending.pendingId).toBe(PENDING_B.pendingId)
    expect(await file.text()).toBe('bytes-B')
    expect(native.consumeRequests).toEqual([{ expectedPendingId: PENDING_B.pendingId }])
  })

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

  it('reads pending replay bytes via fetch(synthetic HTTPS resource) and injects a File into selection', async () => {
    stubNative(PENDING_A)
    stubFetchBlob()
    const onPendingFile = vi.fn(async () => true)
    const { consumePendingWhenReady } = useNativeReplayImport({
      isAuthenticated: () => true,
      onPendingFile,
    })
    const consumed = await consumePendingWhenReady()
    expect(consumed).toBe(true)
    expect(fetch).toHaveBeenCalledWith(PENDING_A.uri, { headers: { 'X-Wotb-Pending-Id': PENDING_A.pendingId }, cache: 'no-store' })
    expect(onPendingFile).toHaveBeenCalledTimes(1)
    const file = onPendingFile.mock.calls[0][0]
    expect(file.name).toBe('a.wotbreplay')
    // bytes actually flowed into the browser File (existing upload pipeline)
    expect(await file.text()).toBe('replay-bytes')
    // identity 一并交给业务（作为 processing create 的 operationId）
    expect(onPendingFile.mock.calls[0][1]).toMatchObject({ pendingId: PENDING_A.pendingId })
  })

  it('ACK 携带 exact pending identity（不是 URI）', async () => {
    const native = stubNative(PENDING_A)
    stubFetchBlob()
    const onPendingFile = vi.fn(async () => true)
    const { consumePendingWhenReady } = useNativeReplayImport({ isAuthenticated: () => true, onPendingFile })

    await expect(consumePendingWhenReady()).resolves.toBe(true)
    expect(native.consumeRequests).toEqual([{ expectedPendingId: PENDING_A.pendingId }])
    expect(native.getCurrent()).toBeNull()
  })

  it('missing identity：没有 pendingId 的 pending 绝不消费、绝不 ACK', async () => {
    const native = stubNative({ name: 'legacy.wotbreplay', uri: 'https://wotbtools.com/__native/replay-pending', size: 5 })
    stubFetchBlob()
    const onPendingFile = vi.fn(async () => true)
    const { consumePendingWhenReady } = useNativeReplayImport({ isAuthenticated: () => true, onPendingFile })

    await expect(consumePendingWhenReady()).resolves.toBe(false)
    expect(onPendingFile).not.toHaveBeenCalled()
    expect(native.methods).not.toContain('consumePendingReplay')
    expect(native.getCurrent()).not.toBeNull()
  })

  it('Blocker regression：A 处理中 B 到达（Native 只通知一次）→ A 完成后自动 drain B，无需第二次触发', async () => {
    const native = stubNative(PENDING_A)
    stubFetchBlob()
    let releaseA
    const gateA = new Promise((res) => { releaseA = res })
    const onPendingFile = vi.fn(async (file) => {
      if (file.name === 'a.wotbreplay') await gateA
      return true
    })
    const { consumePendingWhenReady, registerGlobalHandler } = useNativeReplayImport({
      isAuthenticated: () => true,
      onPendingFile,
    })
    registerGlobalHandler()

    const inflightA = consumePendingWhenReady()
    await vi.waitFor(() => expect(onPendingFile).toHaveBeenCalledTimes(1))

    // 处理 A 期间 Android 收到新 replay B（single slot latest-wins），Native 只调用一次全局通知
    native.setPending(PENDING_B)
    await expect(window.wotbtoolsOnReplay()).resolves.toBe(false) // inflight：coalesce，绝不丢弃

    releaseA()
    // 关键：此后没有任何第二次手工触发；A 结束后必须自动 drain 到 B
    await expect(inflightA).resolves.toBe(true)
    await vi.waitFor(() => expect(onPendingFile).toHaveBeenCalledTimes(2))

    expect(onPendingFile.mock.calls[0][0].name).toBe('a.wotbreplay')
    expect(onPendingFile.mock.calls[1][0].name).toBe('b.wotbreplay')
    expect(native.consumeRequests).toEqual([
      { expectedPendingId: PENDING_A.pendingId },
      { expectedPendingId: PENDING_B.pendingId },
    ])
    expect(native.getCurrent()).toBeNull()
  })

  it('deferred drain 在没有新 pending 时安全结束（不空转、不重复消费）', async () => {
    const native = stubNative(PENDING_A)
    stubFetchBlob()
    let release
    const gate = new Promise((res) => { release = res })
    const onPendingFile = vi.fn(async () => { await gate; return true })
    const { consumePendingWhenReady } = useNativeReplayImport({ isAuthenticated: () => true, onPendingFile })

    const first = consumePendingWhenReady()
    await vi.waitFor(() => expect(onPendingFile).toHaveBeenCalledTimes(1))
    // inflight 期间连发多次通知 → coalesce 成一次 rerun
    consumePendingWhenReady()
    consumePendingWhenReady()
    consumePendingWhenReady()
    release()

    await expect(first).resolves.toBe(true)
    expect(onPendingFile).toHaveBeenCalledTimes(1)
    expect(native.consumeRequests).toHaveLength(1)
  })

  it('does not consume pending replay before login (cross-auth retention)', async () => {
    stubNative(PENDING_A)
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
    stubNative(PENDING_A)
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
    const native = stubNative(PENDING_A)
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
    native.setPending(PENDING_B)
    await window.wotbtoolsOnReplay()
    expect(onPendingFile).toHaveBeenCalledTimes(1)
    expect(onPendingFile.mock.calls[0][0].name).toBe('b.wotbreplay')

    // 同一份 pending 不重复消费（exactly once）
    await window.wotbtoolsOnReplay()
    expect(onPendingFile).toHaveBeenCalledTimes(1)
  })

  it('未登录时绝不触碰 Native pending：不 get、不 consume、不导入', async () => {
    const native = stubNative(PENDING_A)
    stubFetchBlob()
    const onPendingFile = vi.fn(async () => true)
    const { consumePendingWhenReady } = useNativeReplayImport({ isAuthenticated: () => false, onPendingFile })

    await expect(consumePendingWhenReady()).resolves.toBe(false)
    expect(native.methods).toEqual([])
    expect(onPendingFile).not.toHaveBeenCalled()
  })

  it('业务受理成功后才 ACK Native：accepted 先于 consume，且只 consume 一次', async () => {
    const native = stubNative(PENDING_A)
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
    const native = stubNative(PENDING_A)
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
    const undefinedCase = stubNative(PENDING_A)
    stubFetchBlob()
    const noResult = useNativeReplayImport({
      isAuthenticated: () => true,
      onPendingFile: vi.fn(async () => undefined),
    })
    await expect(noResult.consumePendingWhenReady()).resolves.toBe(false)
    expect(undefinedCase.methods).not.toContain('consumePendingReplay')
  })

  it('onPendingFile 抛错时不 ACK Native，下一次仍可重试成功', async () => {
    const native = stubNative(PENDING_A)
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
    const native = stubNative(PENDING_A)
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
