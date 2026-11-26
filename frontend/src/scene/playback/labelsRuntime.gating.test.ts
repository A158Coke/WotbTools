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
    getViewportSize: () => ({ x: 800, y: 600 }),
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
    transients: { ghostOf: () => undefined, hasFlash: () => false },
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
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now)
    try {
      const { deps, overlay, setT } = makeDeps(true)
      const rt = createLabelsRuntime(deps)
      rt.publishLabels(true)
      expect(overlay.setLabels).toHaveBeenCalledTimes(1)
      now = 10
      rt.publishLabels()
      expect(overlay.setLabels).toHaveBeenCalledTimes(1)
      rt.setLabelPrefs()
      expect(overlay.setLabels).toHaveBeenCalledTimes(2)
      now = 250
      rt.publishLabels()
      expect(overlay.setLabels).toHaveBeenCalledTimes(2)
      now = 400; setT(43)
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
