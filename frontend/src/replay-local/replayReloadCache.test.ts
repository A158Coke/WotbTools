// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RELOAD_PENDING_KEY, stageReplayForReload, takeReloadReplay } from './replayReloadCache.ts'

describe('replayReloadCache 一次性标记', () => {
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
    await expect(stageReplayForReload(new File(['replay'], 'battle.wotbreplay'))).rejects.toThrow('IndexedDB unavailable')
    expect(sessionStorage.getItem(RELOAD_PENDING_KEY)).toBeNull()
  })
})
