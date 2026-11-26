// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const cache = vi.hoisted(() => ({ take: vi.fn() }))
const demo = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../replay-local/replayReloadCache.js', () => ({ takeReloadReplay: cache.take }))
vi.mock('../replay-local/demo.js', () => ({ loadOfficialDemo: demo.load }))

import { restoreStagedReplay } from './useReplayReloadRestore.ts'

function deps(overrides = {}) {
  return {
    files: ref([]),
    updateFiles: vi.fn(),
    updateDemoFile: vi.fn(),
    analyze: vi.fn().mockResolvedValue({ completed: true }),
    onError: vi.fn(),
    ...overrides,
  }
}

describe('restoreStagedReplay', () => {
  beforeEach(() => {
    cache.take.mockReset()
    demo.load.mockReset()
  })

  it('没有待恢复标记：不触碰工作台状态', async () => {
    cache.take.mockResolvedValue(null)
    const d = deps()
    expect(await restoreStagedReplay(d)).toBe(false)
    expect(d.updateFiles).not.toHaveBeenCalled()
    expect(d.analyze).not.toHaveBeenCalled()
    expect(d.onError).not.toHaveBeenCalled()
  })

  it('已有选择：不覆盖用户本次页面重新选的文件', async () => {
    const d = deps({ files: ref([new File(['current'], 'current.wotbreplay')]) })
    expect(await restoreStagedReplay(d)).toBe(false)
    expect(cache.take).not.toHaveBeenCalled()
    expect(d.updateFiles).not.toHaveBeenCalled()
  })

  it('用户文件：放回工作台并重新解析', async () => {
    const file = new File(['replay'], 'battle.wotbreplay')
    cache.take.mockResolvedValue({ kind: 'file', file })
    const d = deps()
    expect(await restoreStagedReplay(d)).toBe(true)
    expect(d.updateFiles).toHaveBeenCalledWith([file])
    expect(d.updateDemoFile).not.toHaveBeenCalled()
    expect(d.analyze).toHaveBeenCalledTimes(1)
  })

  it('官方示例：重新下载校验后走 demo 选择路径', async () => {
    const file = new File(['demo'], 'official.wotbreplay')
    cache.take.mockResolvedValue({ kind: 'demo' })
    demo.load.mockResolvedValue(file)
    const d = deps()
    expect(await restoreStagedReplay(d)).toBe(true)
    expect(demo.load).toHaveBeenCalledTimes(1)
    expect(d.updateDemoFile).toHaveBeenCalledWith(file)
    expect(d.updateFiles).not.toHaveBeenCalled()
    expect(d.analyze).toHaveBeenCalledTimes(1)
  })

  it('取回暂存失败：提示一次且不解析', async () => {
    cache.take.mockRejectedValue(new Error('IndexedDB unavailable'))
    const d = deps()
    expect(await restoreStagedReplay(d)).toBe(false)
    expect(d.onError).toHaveBeenCalledTimes(1)
    expect(d.analyze).not.toHaveBeenCalled()
  })

  it('恢复或解析失败：交给工作台错误态，不抛到挂载链', async () => {
    const file = new File(['replay'], 'battle.wotbreplay')
    cache.take.mockResolvedValue({ kind: 'file', file })
    const d = deps({ analyze: vi.fn().mockRejectedValue(new Error('parse crashed')) })
    expect(await restoreStagedReplay(d)).toBe(false)
    expect(d.onError).toHaveBeenCalledTimes(1)
  })
})
