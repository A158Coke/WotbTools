// 名牌偏好改变车模 / 幽灵代理显隐：HIGH/ULTRA 动态反射必须显式强制刷新一次。
// 只 invalidate() 时，dirty frame 可能落在 intervalFrames=2 的跳过帧，水面保留旧倒影。
import { describe, expect, it, vi } from 'vitest'
import { createPlaybackApi } from './publicApi'

function fakeScene() {
  const labels = {
    classIconsVisible: vi.fn(() => false),
    setClassIcons: vi.fn(),
    setShowMarkerStatus: vi.fn(),
    setLabelPrefs: vi.fn(),
    updateLabels: vi.fn(),
  }
  const refresh = vi.fn()
  const invalidate = vi.fn()
  const S = {
    session: { loadData() {}, loadMapOnly() {} },
    store: { labelsOn: true, lastKnownOn: true },
    labels,
    vehicles: { getVehicles: () => [] },
    renderer: {},
    camera: {},
    requestWaterReflectionRefresh: refresh,
    invalidate,
  }
  return { S, labels, refresh, invalidate }
}

describe('setLabelPrefs reflection refresh', () => {
  it('同步名牌后强制刷新水面反射（不能只等 HIGH 档隔帧）', () => {
    const { S, labels, refresh } = fakeScene()
    const api = createPlaybackApi(S as never)
    api.setLabelPrefs({ classIcons: true, lastKnown: false })

    expect(labels.updateLabels).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(labels.updateLabels.mock.invocationCallOrder[0])
      .toBeLessThan(refresh.mock.invocationCallOrder[0])
  })

  it('关掉整层名牌同样改变代理显隐 → 也要刷新', () => {
    const { S, refresh } = fakeScene()
    const api = createPlaybackApi(S as never)
    api.setLabelPrefs({ enabled: false })
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe('settleCamera reflection refresh', () => {
  it('相机交互收口同时强制反射刷新并安排下一帧，二者各一次', () => {
    const { S, refresh, invalidate } = fakeScene()
    const api = createPlaybackApi(S as never)
    api.settleCamera()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(refresh.mock.invocationCallOrder[0])
      .toBeLessThan(invalidate.mock.invocationCallOrder[0])
  })
})
