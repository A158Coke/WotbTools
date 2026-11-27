// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RELOAD_PENDING_KEY, discardReloadReplay, stageReplayForReload, takeReloadReplay } from './replayReloadCache.ts'

function fakeIdb() {
  const data = new Map<string, unknown>()
  const state = { openFailures: 0, transactionFailures: 0 }
  const db = {
    close: vi.fn(),
    transaction: vi.fn(() => {
      if (state.transactionFailures > 0) {
        state.transactionFailures -= 1
        const tx: any = { error: new Error('IndexedDB transaction failed') }
        const store = { get: () => ({}), put: vi.fn(), delete: vi.fn() }
        tx.objectStore = () => store
        queueMicrotask(() => tx.onerror?.())
        return tx
      }
      const tx: any = { error: null }
      const store = {
        get: (key: string) => {
          const request: any = {}
          queueMicrotask(() => { request.result = data.get(key); request.onsuccess?.() })
          return request
        },
        put: (value: unknown, key: string) => {
          data.set(key, value)
          queueMicrotask(() => tx.oncomplete?.())
        },
        delete: (key: string) => {
          queueMicrotask(() => { data.delete(key); tx.oncomplete?.() })
        },
      }
      tx.objectStore = () => store
      return tx
    }),
  }
  const open = vi.fn(() => {
    const request: any = {}
    if (state.openFailures > 0) {
      state.openFailures -= 1
      queueMicrotask(() => { request.error = new Error('IndexedDB open failed'); request.onerror?.() })
    } else {
      queueMicrotask(() => { request.result = db; request.onsuccess?.() })
    }
    return request
  })
  return { indexedDB: { open }, open, data, state }
}

const fileA = new File(['a'], 'a.wotbreplay')
const fileB = new File(['b'], 'b.wotbreplay')

describe('replayReloadCache 一次性恢复记录', () => {
  beforeEach(() => { sessionStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('没有待恢复标记时直接返回 null，不访问 IndexedDB', async () => {
    const open = vi.fn()
    vi.stubGlobal('indexedDB', { open })
    expect(await takeReloadReplay()).toBeNull()
    expect(open).not.toHaveBeenCalled()
  })

  it('IndexedDB 不可用时暂存失败且不留下待恢复标记（失败即中止重载）', async () => {
    vi.stubGlobal('indexedDB', undefined)
    await expect(stageReplayForReload({ files: [fileA], currentIndex: 0 })).rejects.toThrow('IndexedDB unavailable')
    expect(sessionStorage.getItem(RELOAD_PENDING_KEY)).toBeNull()
  })

  it('完整批次 + 当前场次原样取回；标记只消费一次', async () => {
    vi.stubGlobal('indexedDB', fakeIdb().indexedDB)
    const id = await stageReplayForReload({ files: [fileA, fileB], currentIndex: 1 })
    expect(sessionStorage.getItem(RELOAD_PENDING_KEY)).toBe(id)
    await expect(takeReloadReplay()).resolves.toEqual({
      id,
      replay: { kind: 'files', files: [fileA, fileB], currentIndex: 1, contactShadows: false },
    })
    expect(sessionStorage.getItem(RELOAD_PENDING_KEY)).toBeNull()
    await expect(takeReloadReplay()).resolves.toBeNull()
  })

  it('IndexedDB open 临时失败：保留标记，重试恢复原批次', async () => {
    const fake = fakeIdb()
    vi.stubGlobal('indexedDB', fake.indexedDB)
    const id = await stageReplayForReload({ files: [fileA, fileB], currentIndex: 1, contactShadows: true })
    fake.state.openFailures = 1
    await expect(takeReloadReplay()).rejects.toThrow('IndexedDB open failed')
    expect(sessionStorage.getItem(RELOAD_PENDING_KEY)).toBe(id)
    await expect(takeReloadReplay()).resolves.toEqual({
      id,
      replay: { kind: 'files', files: [fileA, fileB], currentIndex: 1, contactShadows: true },
    })
    expect(sessionStorage.getItem(RELOAD_PENDING_KEY)).toBeNull()
  })

  it('IndexedDB transaction 失败：保留标记，重试恢复原批次', async () => {
    const fake = fakeIdb()
    vi.stubGlobal('indexedDB', fake.indexedDB)
    const id = await stageReplayForReload({ files: [fileA, fileB], currentIndex: 0, contactShadows: false })
    fake.state.transactionFailures = 1
    await expect(takeReloadReplay()).rejects.toThrow('IndexedDB transaction failed')
    expect(sessionStorage.getItem(RELOAD_PENDING_KEY)).toBe(id)
    await expect(takeReloadReplay()).resolves.toEqual({
      id,
      replay: { kind: 'files', files: [fileA, fileB], currentIndex: 0, contactShadows: false },
    })
    expect(sessionStorage.getItem(RELOAD_PENDING_KEY)).toBeNull()
  })

  it('无效记录：确认读取成功后清理记录与标记，不返回选择', async () => {
    const fake = fakeIdb()
    vi.stubGlobal('indexedDB', fake.indexedDB)
    fake.data.set('broken', { replay: { kind: 'files', files: [], currentIndex: 0 } })
    sessionStorage.setItem(RELOAD_PENDING_KEY, 'broken')
    await expect(takeReloadReplay()).resolves.toBeNull()
    expect(fake.data.has('broken')).toBe(false)
    expect(sessionStorage.getItem(RELOAD_PENDING_KEY)).toBeNull()
  })

  it('每次重载独立 id：两个标签页的记录并存，各自按自己的标记取回', async () => {
    vi.stubGlobal('indexedDB', fakeIdb().indexedDB)
    const first = await stageReplayForReload({ files: [fileA], currentIndex: 0 })
    const second = await stageReplayForReload({ files: [fileB], currentIndex: 0 })
    expect(first).not.toBe(second)
    sessionStorage.setItem(RELOAD_PENDING_KEY, first)
    await expect(takeReloadReplay()).resolves.toEqual({ id: first, replay: { kind: 'files', files: [fileA], currentIndex: 0, contactShadows: false } })
  })

  it('discard 只清理本次 id，不影响其他标签页的待恢复记录', async () => {
    vi.stubGlobal('indexedDB', fakeIdb().indexedDB)
    const stale = await stageReplayForReload({ files: [fileA], currentIndex: 0 })
    const current = await stageReplayForReload({ files: [fileB], currentIndex: 0 })
    await discardReloadReplay(stale)
    expect(sessionStorage.getItem(RELOAD_PENDING_KEY)).toBe(current)
    await expect(takeReloadReplay()).resolves.toEqual({ id: current, replay: { kind: 'files', files: [fileB], currentIndex: 0, contactShadows: false } })
  })

  it('越界场次收敛到批次内，避免恢复出不存在的选择', async () => {
    vi.stubGlobal('indexedDB', fakeIdb().indexedDB)
    await stageReplayForReload({ files: [fileA, fileB], currentIndex: 9 })
    const staged = await takeReloadReplay()
    expect(staged?.replay).toEqual({ kind: 'files', files: [fileA, fileB], currentIndex: 1, contactShadows: false })
  })

  it('把本次接地阴影目标随 reloadId 一起暂存，供恢复时绑定 File', async () => {
    vi.stubGlobal('indexedDB', fakeIdb().indexedDB)
    const id = await stageReplayForReload({ files: [fileA], currentIndex: 0, contactShadows: true })
    await expect(takeReloadReplay()).resolves.toEqual({
      id,
      replay: { kind: 'files', files: [fileA], currentIndex: 0, contactShadows: true },
    })
  })

  it('旧记录没有 contactShadows 时按 OFF 迁移，不把缺失字段当成开启', async () => {
    const fake = fakeIdb()
    vi.stubGlobal('indexedDB', fake.indexedDB)
    fake.data.set('legacy', { replay: { kind: 'files', files: [fileA], currentIndex: 0 } })
    sessionStorage.setItem(RELOAD_PENDING_KEY, 'legacy')
    await expect(takeReloadReplay()).resolves.toEqual({
      id: 'legacy', replay: { kind: 'files', files: [fileA], currentIndex: 0, contactShadows: false },
    })
  })
})
