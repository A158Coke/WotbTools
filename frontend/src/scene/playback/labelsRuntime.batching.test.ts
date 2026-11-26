// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createLabelsRuntime } from './labelsRuntime.js'
import type { LabelsOverlay, LabelsRuntimeDeps } from './labelsRuntime.js'

function vehicle(eid: number, x: number) {
  const group = new THREE.Object3D()
  group.position.set(x, 0, -10)
  group.visible = true
  return {
    def: { eid, account_id: eid, nickname: `p${eid}`, tank_name: 'T', team: 1, max_hp: 100, coverage: [0, 100] },
    group,
    labelAnchor: new THREE.Vector3(),
    labelOccluded: false,
    lastKnownPose: null,
  }
}

function makeDeps(overlay: LabelsOverlay) {
  const vehicles = [vehicle(1, -1), vehicle(2, 1)]
  const deps: LabelsRuntimeDeps = {
    store: {
      labelsOn: true, lastKnownOn: false, killfeed: [], scoreFriend: 0, scoreEnemy: 0,
      friendlyTeam: 1, roster: { team1: [], team2: [], unknown: [] },
    } as never,
    getViewportSize: () => ({ x: 800, y: 600 }),
    getCamera: () => {
      const camera = new THREE.PerspectiveCamera()
      camera.position.set(0, 0, 0)
      camera.lookAt(0, 0, -1)
      return camera
    },
    getRaycaster: () => new THREE.Raycaster(),
    getData: () => ({ meta: { friendly_team: 1 }, kills: [] }) as never,
    getT: () => 10,
    getVehicles: () => vehicles as never,
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
    fxScale: () => 1,
    getLabelOverlay: () => overlay,
    canonicalVehicles: () => [],
    invalidate: vi.fn(),
  }
  return deps
}

describe('labelsRuntime 锚点批处理（R3）', () => {
  it('begin(逻辑舞台) → 逐车 setAnchor → end 单次 flush；舞台尺寸来自 getViewportSize', () => {
    const calls: unknown[] = []
    const overlay: LabelsOverlay = {
      setLabels: vi.fn(),
      setAnchor: vi.fn((eid: number) => calls.push(['anchor', eid])),
      beginAnchors: vi.fn((stage: { x: number; y: number }) => calls.push(['begin', { ...stage }])),
      endAnchors: vi.fn(() => calls.push(['end'])),
      clear: vi.fn(),
    }
    const rt = createLabelsRuntime(makeDeps(overlay))
    rt.updateLabels()
    expect(overlay.beginAnchors).toHaveBeenCalledWith({ x: 800, y: 600 })
    expect(overlay.setAnchor).toHaveBeenCalledTimes(2)
    expect(overlay.endAnchors).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([
      ['begin', { x: 800, y: 600 }],
      ['anchor', 1],
      ['anchor', 2],
      ['end'],
    ])
  })

  it('旧覆盖层桩没有 begin/end 时退回逐条 setAnchor（不破坏兼容）', () => {
    const overlay: LabelsOverlay = {
      setLabels: vi.fn(),
      setAnchor: vi.fn(),
      clear: vi.fn(),
    }
    const rt = createLabelsRuntime(makeDeps(overlay))
    rt.updateLabels()
    expect(overlay.setAnchor).toHaveBeenCalledTimes(2)
  })
})
