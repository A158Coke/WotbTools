// 标签运行时发布门控行为测试（#827 接替 sceneryMaterials.test.js 的 :1128 源码守卫）：
// 装填条求值 = publishLabels 的节流快照。两条不变量：
//   1. 关标签时整段不做（store.labelsOn 早退）；
//   2. 同一回放时刻 T 只求值/发布一次（时间戳门控；setLabelPrefs/invalidateLabels 失效重发）。
// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createLabelsRuntime } from './labelsRuntime.js'
import type { LabelsRuntimeDeps, LabelsOverlay } from './labelsRuntime.js'

function makeDeps(labelsOn: boolean, overrides: Partial<LabelsRuntimeDeps> = {}) {
  let t = 42
  const overlay: LabelsOverlay = {
    setLabels: vi.fn(),
    setAnchor: vi.fn(),
    clear: vi.fn(),
  }
  const deps: LabelsRuntimeDeps = {
    store: { labelsOn, killfeed: [], scoreFriend: 0, scoreEnemy: 0, friendlyTeam: 1, roster: { team1: [], team2: [], unknown: [] } } as never,
    container: document.createElement('div'),
    getCamera: () => new THREE.PerspectiveCamera(),
    getRaycaster: () => new THREE.Raycaster(),
    getData: () => ({ meta: { friendly_team: 1 }, kills: [] }) as never,
    getT: () => t,
    getVehicles: () => [] as never,
    getSessionGen: () => 0,
    getFollowEid: () => null,
    deathAt: () => false,
    hpAt: () => 100,
    visibleAt: () => true,
    visByEid: () => new Map(),
    scopedHiddenEid: () => 0,
    sampleHeight: () => 0,
    heightField: () => null,
    heightMeta: () => null,
    mapScenery: () => null,
    occlGrid: () => null,
    transients: { ghostOf: () => null, hasFlash: () => false },
    fxScale: () => 2,
    getLabelOverlay: () => overlay,
    canonicalVehicles: () => [],
    invalidate: vi.fn(),
    ...overrides,
  }
  return { deps, overlay, setT: (v: number) => { t = v } }
}

import * as THREE from 'three'

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe(':1128 装填条求值门控', () => {
  it('同一 T 只解析发布一次；setLabelPrefs 强制重发；节流窗过后新 T 重发', () => {
    let now = 0
    let t = 42
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now)
    try {
      const { deps, overlay, setT } = makeDeps(true)
      const rt = createLabelsRuntime(deps)
      rt.publishLabels(true)   // force 首发快照
      expect(overlay.setLabels).toHaveBeenCalledTimes(1)
      now = 10
      rt.publishLabels()       // 同 T：时间戳门控拦下（暂停/空转零成本）
      expect(overlay.setLabels).toHaveBeenCalledTimes(1)
      rt.setLabelPrefs()       // 名牌偏好变化：labelsTime=null + force 立即重发
      expect(overlay.setLabels).toHaveBeenCalledTimes(2)
      now = 150; setT(43)      // 节流窗（100ms）过后 + 新 T：恢复发布
      rt.publishLabels()
      expect(overlay.setLabels).toHaveBeenCalledTimes(3)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('关标签（store.labelsOn=false）整段早退：不解析、不发布', () => {
    const { deps, overlay } = makeDeps(false)
    const rt = createLabelsRuntime(deps)
    rt.publishLabels(true)
    rt.updateLabels()
    expect(overlay.setLabels).not.toHaveBeenCalled()
  })
})
