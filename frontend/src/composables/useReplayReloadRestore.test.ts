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
    files: ref<File[]>([]),
    selectionRevision: ref(0),
    updateFiles: vi.fn(),
    updateDemoFile: vi.fn(),
    selectBattleIndex: vi.fn(),
    analyze: vi.fn().mockResolvedValue({ completed: true }),
    onRestoring: vi.fn(),
    onRestored: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  }
}

const fileA = new File(['a'], 'a.wotbreplay')
const fileB = new File(['b'], 'b.wotbreplay')
const stagedFiles = {
  id: 'reload-1',
  replay: { kind: 'files', files: [fileA, fileB], currentIndex: 1, contactShadows: true },
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

  it('完整批次：恢复全部文件、指回原场次再重新解析，并交付绑定 File 的重播请求', async () => {
    cache.take.mockResolvedValue(stagedFiles)
    const d = deps()
    expect(await restoreStagedReplay(d)).toBe(true)
    expect(d.updateFiles).toHaveBeenCalledWith([fileA, fileB])
    expect(d.selectBattleIndex).toHaveBeenCalledWith(1)
    expect(d.onRestoring).toHaveBeenCalledWith(fileB, 'reload-1', true)
    expect(d.onRestoring.mock.invocationCallOrder[0])
      .toBeLessThan(d.analyze.mock.invocationCallOrder[0])
    expect(d.analyze).toHaveBeenCalledTimes(1)
    expect(d.onRestored).toHaveBeenCalledWith(fileB, 'reload-1')
  })

  it('等待存储期间用户已建立自己的选择：放弃恢复，不覆盖', async () => {
    const d = deps()
    cache.take.mockImplementation(async () => {
      d.files.value = [fileA]
      d.selectionRevision.value += 1
      return stagedFiles
    })
    expect(await restoreStagedReplay(d)).toBe(false)
    expect(d.updateFiles).not.toHaveBeenCalled()
    expect(d.onRestoring).not.toHaveBeenCalled()
    expect(d.onRestored).not.toHaveBeenCalled()
  })

  it('官方示例：重新下载校验后走 demo 选择路径', async () => {
    cache.take.mockResolvedValue({ id: 'reload-demo', replay: { kind: 'demo', contactShadows: false } })
    demo.load.mockResolvedValue(fileA)
    const d = deps()
    expect(await restoreStagedReplay(d)).toBe(true)
    expect(demo.load).toHaveBeenCalledTimes(1)
    expect(d.updateDemoFile).toHaveBeenCalledWith(fileA)
    expect(d.updateFiles).not.toHaveBeenCalled()
    expect(d.onRestoring).toHaveBeenCalledWith(fileA, 'reload-demo', false)
    expect(d.analyze).toHaveBeenCalledTimes(1)
    expect(d.onRestored).toHaveBeenCalledWith(fileA, 'reload-demo')
  })

  it('下载官方示例期间用户已选择别的回放：不再替换选择', async () => {
    cache.take.mockResolvedValue({ id: 'reload-demo', replay: { kind: 'demo', contactShadows: true } })
    const d = deps()
    demo.load.mockImplementation(async () => {
      d.files.value = [fileB]
      d.selectionRevision.value += 1
      return fileA
    })
    expect(await restoreStagedReplay(d)).toBe(false)
    expect(d.updateDemoFile).not.toHaveBeenCalled()
    expect(d.analyze).not.toHaveBeenCalled()
  })

  it('取回暂存失败：提示一次且不解析', async () => {
    cache.take.mockRejectedValue(new Error('IndexedDB unavailable'))
    const d = deps()
    expect(await restoreStagedReplay(d)).toBe(false)
    expect(d.onError).toHaveBeenCalledTimes(1)
    expect(d.analyze).not.toHaveBeenCalled()
  })

  it('恢复或解析失败：交给工作台错误态，不抛到挂载链', async () => {
    cache.take.mockResolvedValue(stagedFiles)
    const d = deps({ analyze: vi.fn().mockRejectedValue(new Error('parse crashed')) })
    expect(await restoreStagedReplay(d)).toBe(false)
    expect(d.onError).toHaveBeenCalledTimes(1)
    expect(d.onRestored).not.toHaveBeenCalled()
  })

  it('解析没有完成：恢复输入但不标记自动重播', async () => {
    cache.take.mockResolvedValue(stagedFiles)
    const d = deps({ analyze: vi.fn().mockResolvedValue({ completed: false, reason: 'ENGINE_UNAVAILABLE' }) })
    expect(await restoreStagedReplay(d)).toBe(true)
    expect(d.onRestored).not.toHaveBeenCalled()
  })
})
