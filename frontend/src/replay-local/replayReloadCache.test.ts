// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RELOAD_PENDING_KEY, discardReloadReplay, stageReplayForReload, takeReloadReplay } from './replayReloadCache.ts'

/** 只实现缓存层用到的 IDB 面：open + 单 store 的 put/get/delete + 事务完成事件。 */
function fakeIdb() {
  const data = new Map<string, unknown>()
  const db = {
    close: vi.fn(),
    transaction: vi.fn(() => {
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
          // 与真实 IDB 请求队列一致：先让同一事务里的 get 读到旧值，再删除。
          queueMicrotask(() => { data.delete(key); tx.oncomplete?.() })
        },
      }
      tx.objectStore = () => store
      return tx
    }),
  }
  const open = vi.fn(() => {
    const request: any = {}
    queueMicrotask(() => { request.result = db; request.onsuccess?.() })
    return request
  })
  return { indexedDB: { open }, open, data }
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
      replay: { kind: 'files', files: [fileA, fileB], currentIndex: 1 },
    })
    expect(sessionStorage.getItem(RELOAD_PENDING_KEY)).toBeNull()
    await expect(takeReloadReplay()).resolves.toBeNull()
  })

  it('每次重载独立 id：两个标签页的记录并存，各自按自己的标记取回', async () => {
    vi.stubGlobal('indexedDB', fakeIdb().indexedDB)
    const first = await stageReplayForReload({ files: [fileA], currentIndex: 0 })
    const second = await stageReplayForReload({ files: [fileB], currentIndex: 0 })
    expect(first).not.toBe(second)
    sessionStorage.setItem(RELOAD_PENDING_KEY, first)
    await expect(takeReloadReplay()).resolves.toEqual({ id: first, replay: { kind: 'files', files: [fileA], currentIndex: 0 } })
  })

  it('discard 只清理本次 id，不影响其他标签页的待恢复记录', async () => {
    vi.stubGlobal('indexedDB', fakeIdb().indexedDB)
    const stale = await stageReplayForReload({ files: [fileA], currentIndex: 0 })
    const current = await stageReplayForReload({ files: [fileB], currentIndex: 0 })
    await discardReloadReplay(stale)
    expect(sessionStorage.getItem(RELOAD_PENDING_KEY)).toBe(current)
    await expect(takeReloadReplay()).resolves.toEqual({ id: current, replay: { kind: 'files', files: [fileB], currentIndex: 0 } })
  })

  it('越界场次收敛到批次内，避免恢复出不存在的选择', async () => {
    vi.stubGlobal('indexedDB', fakeIdb().indexedDB)
    await stageReplayForReload({ files: [fileA, fileB], currentIndex: 9 })
    const staged = await takeReloadReplay()
    expect(staged?.replay).toEqual({ kind: 'files', files: [fileA, fileB], currentIndex: 1 })
  })
})
